// Vercel serverless function: measures a Minecraft server's ping the way the game does.
// It connects, asks for the server status, then sends a Minecraft "ping" and times the "pong".
// Used for servers behind Cloudflare, which the Cloudflare Worker can't reach.
//
// GET /api/ping?name=<server>  ->  {ok, connect, ping}   (milliseconds)
//   connect = time to open the TCP connection (to the nearest proxy or Cloudflare edge)
//   ping    = time for a Minecraft ping/pong, which also travels on to the real server
// The page uses (ping - connect) as the proxy-to-server part of the round trip.
//
// Only servers listed in the repo README can be tested.
const net = require("node:net");
const dns = require("node:dns/promises");

const README_URL = "https://raw.githubusercontent.com/itzyongan/asia-pvp-servers/main/README.md";
const SAMPLES = 3, TIMEOUT_MS = 2500, LIST_TTL = 10 * 60 * 1000;
let listCache = {t: 0, ips: []};

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
  listCache = {t: Date.now(), ips: parseIps(await r.text())};
  return listCache.ips;
}

// ---- Minecraft status protocol ----
const varint = n => { const b = []; do{ let t = n & 0x7f; n >>>= 7; if(n) t |= 0x80; b.push(t); }while(n); return Buffer.from(b); };
const mcString = s => { const b = Buffer.from(s, "utf8"); return Buffer.concat([varint(b.length), b]); };
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const packet = (id, ...parts) => { const body = Buffer.concat([varint(id), ...parts]); return Buffer.concat([varint(body.length), body]); };

// Collects incoming bytes and hands back whole packets.
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

async function sampleOnce(address, port, name){
  const t0 = performance.now();
  const socket = net.connect({host: address, port});
  socket.setNoDelay(true);
  const reader = new Reader(socket);
  const timer = setTimeout(() => socket.destroy(new Error("timed out")), TIMEOUT_MS);
  try{
    await new Promise((res, rej) => { socket.once("connect", res); socket.once("error", rej); });
    const connect = performance.now() - t0;
    socket.write(Buffer.concat([packet(0, varint(767), mcString(name), u16(port), varint(1)), packet(0)])); // handshake + status request
    const status = await reader.packet();
    if(status.id !== 0) throw new Error("unexpected reply");
    const payload = Buffer.alloc(8); payload.writeBigInt64BE(BigInt(Date.now()));
    const t1 = performance.now();
    socket.write(packet(1, payload));                                                                       // ping
    const pong = await reader.packet();
    if(pong.id !== 1) throw new Error("unexpected reply");
    return {connect, ping: performance.now() - t1};
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

async function measure(name, target){
  const {address} = await dns.lookup(target.host);   // look the address up first so DNS isn't part of the timing
  const out = [];
  for(let i = 0; i < SAMPLES; i++){
    try{ out.push(await sampleOnce(address, target.port, name)); }
    catch(e){ if(!out.length) throw e; break; }
  }
  return {connect: Math.min(...out.map(x => x.connect)), ping: Math.min(...out.map(x => x.ping))}; // fastest of each: delays only add time
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const name = String((req.query && req.query.name) || "").trim().toLowerCase();
  try{
    if(!(await listedServers()).includes(name)) return res.status(404).json({ok: false, error: "unknown server"});
    const target = await resolveTarget(name);
    if(target.port < 1 || target.port > 65535 || target.port === 25) return res.status(400).json({ok: false, error: "port not allowed"});
    const m = await measure(name, target);
    const round = x => Math.round(x * 10) / 10;
    return res.status(200).json({ok: true, connect: round(m.connect), ping: round(m.ping)});
  }catch(e){
    return res.status(502).json({ok: false, error: String((e && e.message) || e)});
  }
};
module.exports._measure = measure; // exposed for testing
