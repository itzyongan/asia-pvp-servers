// GET /api/icon?name=<server> -> the server's own icon as an image (404 if it has none).
// Sources are tried in tiers, and inside a tier all at the same time (the first real icon wins):
//   1. the server itself: mcstatus.io, mcsrvstat.us, and a direct status query (as two different game versions)
//   2. the same four for the network's main address (as.example.com -> example.com), since a network usually shares one icon
//   3. the public icon services (mcstatus.io, mcsrvstat.us, mc-api.net), ignoring their "no icon" placeholder pictures
// Vercel's edge cache keeps the picture for a day, so each icon is only looked up once.
const {listedServers, getJson, slpStatus, resolveTarget, dns} = require("./_shared");

const BUDGET_MS = 8500; // stay under Vercel's default 10 second limit
const isIcon = v => typeof v === "string" && /^data:image\/[a-z0-9.+-]+;base64,/i.test(v);

// First source that returns a real icon; null when none does.
function firstValid(tasks){
  return new Promise(resolve => {
    let left = tasks.length;
    if(!left) return resolve(null);
    for(const t of tasks){
      t.then(v => { if(isIcon(v)) resolve(v); }).catch(() => {}).finally(() => { if(--left === 0) resolve(null); });
    }
  });
}
async function fromServer(name, protocol){
  const t = await resolveTarget(name);
  const {address} = await dns.lookup(t.host);
  return (await slpStatus(name, address, t.port, 2500, protocol)).favicon;
}
function ownSources(name){
  const q = encodeURIComponent(name);
  return [
    getJson(`https://api.mcstatus.io/v2/status/java/${q}?query=false&timeout=3`, 3000).then(d => d.icon),
    getJson(`https://api.mcsrvstat.us/3/${q}`, 3000).then(d => d.icon),
    fromServer(name, 767),
    fromServer(name, 776)   // some servers only answer fully for newer game versions
  ];
}

// The public icon services answer with a stand-in picture for servers they know nothing about, so a picture only counts
// when it differs from that stand-in (learned once, by asking for a server that can't exist).
const standIns = new Map();
async function getBytes(url, ms){
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try{
    const r = await fetch(url, {signal: ctl.signal});
    if(!r.ok) throw new Error("http " + r.status);
    const type = (r.headers.get("content-type") || "").split(";")[0];
    if(!/^image\//i.test(type)) throw new Error("not an image");
    return {type, bytes: Buffer.from(await r.arrayBuffer())};
  } finally { clearTimeout(timer); }
}
const SERVICES = [
  n => `https://api.mcstatus.io/v2/icon/${encodeURIComponent(n)}`,
  n => `https://api.mcsrvstat.us/icon/${encodeURIComponent(n)}`,
  n => `https://eu.mc-api.net/v3/server/favicon/${encodeURIComponent(n)}`
];
async function fromService(template, name){
  const real = await getBytes(template(name), 3000);
  if(!standIns.has(template)) standIns.set(template, getBytes(template("no-such-server.invalid"), 3000).catch(() => null));
  const stand = await standIns.get(template);
  if(stand && stand.bytes.equals(real.bytes)) throw new Error("placeholder");
  return `data:${real.type};base64,${real.bytes.toString("base64")}`;
}

// "as.example.com" -> "example.com"; null when there is nothing sensible to fall back to.
const parentOf = name => { const p = name.split("."); return p.length >= 3 ? p.slice(1).join(".") : null; };

async function findIcon(name){
  const t0 = Date.now(), left = () => BUDGET_MS - (Date.now() - t0);
  const parent = parentOf(name);
  const tiers = [
    () => ownSources(name),
    () => parent ? ownSources(parent) : [],
    () => [...SERVICES.map(t => fromService(t, name)), ...(parent ? SERVICES.map(t => fromService(t, parent)) : [])]
  ];
  for(const tier of tiers){
    if(left() < 1500) break;
    const hit = await Promise.race([firstValid(tier()), new Promise(res => setTimeout(() => res(null), left()))]);
    if(hit) return hit;
  }
  return null;
}

module.exports = async (req, res) => {
  const name = String((req.query && req.query.name) || "").trim().toLowerCase();
  try{
    if(!(await listedServers()).includes(name)) return res.status(404).end("unknown server");
    const icon = await findIcon(name);
    if(!icon){
      res.setHeader("Cache-Control", "public, s-maxage=600");
      return res.status(404).end("no icon");
    }
    const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(icon);
    res.setHeader("Content-Type", m[1]);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).send(Buffer.from(m[2], "base64"));
  }catch(e){
    res.setHeader("Cache-Control", "no-store");
    res.status(502).end(String((e && e.message) || e));
  }
};
module.exports._findIcon = findIcon; // exposed for testing
