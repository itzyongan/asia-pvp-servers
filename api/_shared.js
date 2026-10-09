// Helpers shared by the Vercel functions (files starting with "_" are not turned into endpoints).
const net = require("node:net");
const dns = require("node:dns/promises");

const README_URL = "https://raw.githubusercontent.com/itzyongan/asia-pvp-servers/main/README.md";
const UA = "asia-pvp-servers (https://github.com/itzyongan/asia-pvp-servers)";
const LIST_TTL = 10 * 60 * 1000;
let listCache = {t: 0, ips: []};

// Same table parsing as the website: rows under a "Premium" or "Cracked" heading.
function parseIps(md){
  const ips = [];
  let inTable = false;
  for(const line of md.split(/\r?\n/)){
    const h = line.match(/^#{1,6}\s+(.*)/);
    if(h){ const t = h[1].toLowerCase(); inTable = t.includes("cracked") || t.includes("premium"); continue; }
    if(!inTable || !line.trim().startsWith("|")) continue;
    const c = line.trim().replace(/^\||\|$/g, "").split("|").map(x => x.trim());
    if(c.length < 5 || /^[-:\s]+$/.test(c[0]) || /^server ip$/i.test(c[0])) continue;
    const ip = c[0].replace(/⭐/g, "").replace(/[`*]/g, "").trim().toLowerCase();
    if(ip && !ips.includes(ip)) ips.push(ip);
  }
  return ips;
}
async function listedServers(){
  if(listCache.ips.length && Date.now() - listCache.t < LIST_TTL) return listCache.ips;
  const r = await fetch(README_URL);
  if(!r.ok) throw new Error("server list unavailable");
  const ips = parseIps(await r.text());
  if(!ips.length) throw new Error("server list empty");
  listCache = {t: Date.now(), ips};
  return ips;
}

async function getJson(url, ms){
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try{
    const r = await fetch(url, {signal: ctl.signal, headers: {"User-Agent": UA, accept: "application/json"}});
    if(!r.ok) throw new Error("http " + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

// ---- Minecraft status protocol: ask the server itself (this is how the game's server list works) ----
const varint = n => { const b = []; do{ let t = n & 0x7f; n >>>= 7; if(n) t |= 0x80; b.push(t); }while(n); return Buffer.from(b); };
const mcString = s => { const b = Buffer.from(s, "utf8"); return Buffer.concat([varint(b.length), b]); };
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const packet = (id, ...parts) => { const body = Buffer.concat([varint(id), ...parts]); return Buffer.concat([varint(body.length), body]); };

class Reader {
  constructor(socket){
    this.buf = Buffer.alloc(0); this.waiting = null; this.failed = null;
    socket.on("data", d => { this.buf = Buffer.concat([this.buf, d]); this.wake(); });
    socket.on("error", e => { this.failed = e; this.wake(); });
    socket.on("close", () => { this.failed = this.failed || new Error("connection closed"); this.wake(); });
  }
  wake(){ const w = this.waiting; this.waiting = null; if(w) w(); }
  tryParse(){
    let n = 0, shift = 0, i = 0;
    for(;; i++){
      if(i >= this.buf.length) return null;
      if(i >= 5) throw new Error("bad packet length");
      const b = this.buf[i]; n |= (b & 0x7f) << shift; shift += 7;
      if(!(b & 0x80)){ i++; break; }
    }
    if(this.buf.length < i + n) return null;
    const body = this.buf.subarray(i, i + n);
    this.buf = this.buf.subarray(i + n);
    let id = 0, s = 0, j = 0;
    for(;; j++){ const b = body[j]; id |= (b & 0x7f) << s; s += 7; if(!(b & 0x80)){ j++; break; } }
    return {id, data: body.subarray(j)};
  }
  async packet(){
    for(;;){
      const p = this.tryParse();
      if(p) return p;
      if(this.failed) throw this.failed;
      await new Promise(res => { this.waiting = res; });
    }
  }
}

// Returns the server's status JSON (players, version, favicon ...).
async function slpStatus(name, address, port, timeoutMs = 4000, protocol = 767){
  const socket = net.connect({host: address, port});
  const reader = new Reader(socket);
  const timer = setTimeout(() => socket.destroy(new Error("timed out")), timeoutMs);
  try{
    await new Promise((res, rej) => { socket.once("connect", res); socket.once("error", rej); });
    socket.write(Buffer.concat([packet(0, varint(protocol), mcString(name), u16(port), varint(1)), packet(0)]));
    const p = await reader.packet();
    if(p.id !== 0) throw new Error("unexpected reply");
    let len = 0, shift = 0, i = 0;
    for(;; i++){ const b = p.data[i]; len |= (b & 0x7f) << shift; shift += 7; if(!(b & 0x80)){ i++; break; } }
    return JSON.parse(p.data.subarray(i, i + len).toString("utf8"));
  } finally { clearTimeout(timer); socket.destroy(); }
}

// Like the game, follow the SRV record if there is one.
async function resolveTarget(name){
  try{
    const recs = await dns.resolveSrv(`_minecraft._tcp.${name}`);
    if(recs.length){ recs.sort((a, b) => a.priority - b.priority || b.weight - a.weight); return {host: recs[0].name, port: recs[0].port}; }
  }catch{}
  return {host: name, port: 25565};
}

module.exports = {listedServers, getJson, slpStatus, resolveTarget, dns, parseIps};
