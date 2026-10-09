// GET /api/status -> every listed server's status in one response.
// Vercel's edge cache keeps the answer for 20 seconds and serves an older copy instantly (while refreshing it)
// for up to a day, so visitors almost never wait for the servers to be checked. The page notices an old copy
// (it carries its build time) and asks again a few seconds later for the fresh one.
const {listedServers, getJson} = require("./_shared");

const DEADLINE_MS = 3800; // a build never waits longer than this for slow servers; the page looks up any that are missing
const isIcon = v => typeof v === "string" && v.startsWith("data:image/");

function pack(online, d){
  return {
    online, players: d?.players?.online ?? 0,
    version: online ? (String(d.version?.name_clean ?? (typeof d.version?.name === "string" ? d.version.name : "") ?? "").slice(0, 40) || null) : null,
    motd: online && typeof d.motd?.clean === "string" ? d.motd.clean.slice(0, 140) : null,
    icon: online && isIcon(d.icon),                    // the page loads the picture itself (api/icon)
    addr: d?.ip_address || null, port: d?.srv_record?.port || d?.port || null
  };
}

async function checkOne(ip){
  const q = encodeURIComponent(ip);
  const first = await getJson(`https://api.mcstatus.io/v2/status/java/${q}?query=false&timeout=2`, 3000).catch(() => null);
  if(first?.online) return pack(true, first);
  const second = await getJson(`https://api.mcsrvstat.us/3/${q}`, 2500).catch(() => null); // second opinion before calling it offline
  if(second?.online){
    return {online: true, players: second.players?.online ?? 0,
      version: typeof second.version === "string" ? second.version.slice(0, 40) : null,
      motd: Array.isArray(second.motd?.clean) ? second.motd.clean.join(" ").slice(0, 140) : null,
      icon: isIcon(second.icon), addr: second.ip || null, port: second.port || null};
  }
  if(!first && second) return pack(false, null);
  return first ? pack(false, first) : null; // null: nobody could tell
}

module.exports = async (req, res) => {
  try{
    const ips = await listedServers();
    const late = new Promise(res => setTimeout(() => res(undefined), DEADLINE_MS));
    const results = await Promise.all(ips.map(ip => Promise.race([checkOne(ip), late])));   // all servers at once, none holds the others up
    const s = {};
    ips.forEach((ip, i) => { if(results[i]) s[ip] = results[i]; });
    res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=86400");
    res.status(200).json({t: Date.now(), s});
  }catch(e){
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json({ok: false, error: String((e && e.message) || e)});
  }
};
module.exports._checkOne = checkOne; // exposed for testing
