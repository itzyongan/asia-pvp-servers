// GET /api/icon?name=<server> -> the server's own icon as an image (404 if it has none).
// Three sources are tried at the same time and the first real icon wins:
//   1. mcstatus.io   2. mcsrvstat.us   3. the Minecraft server itself (the same way the game's server list reads it)
// Vercel's edge cache keeps the picture for a day, so each icon is only looked up once.
const {listedServers, getJson, slpStatus, resolveTarget, dns} = require("./_shared");

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
async function fromServer(name){
  const t = await resolveTarget(name);
  const {address} = await dns.lookup(t.host);
  return (await slpStatus(name, address, t.port, 4000)).favicon;
}
async function findIcon(name){
  const q = encodeURIComponent(name);
  return firstValid([
    getJson(`https://api.mcstatus.io/v2/status/java/${q}?query=false&timeout=3`, 5000).then(d => d.icon),
    getJson(`https://api.mcsrvstat.us/3/${q}`, 5000).then(d => d.icon),
    fromServer(name)
  ]);
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
