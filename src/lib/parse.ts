// Parses README.md tables into the server list. Runs at build time (Node) and nowhere else.
// A Server IP cell may hold an HTML <details> block (IP in <summary>, alternate routes below it).

export type Avail = 1 | 0 | "l" | null;
export interface Route { ip: string; label: string }
export interface Server {
  type: "premium" | "cracked";
  ip: string;
  top: boolean;
  region: string;
  duels: Avail;
  ffa: Avail;
  sandbox: Avail;
  note: string;
  routes: Route[];
}

// A Server IP cell may hold an HTML <details> block (IP in <summary>, alternate routes below it).
// cellIp() returns just the hostname; cellTop() tells whether it carries the star.
function cellHead(x: string){
  const m = x.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
  return m ? m[1] : x.split(/<details|<br/i)[0];
}
function cellIp(x: string){
  const t = cellHead(x).replace(/<[^>]*>/g, " ").replace(/⭐/g, " ").replace(/[`*]/g, "");
  const m = t.match(/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/i);
  return m ? m[0] : t.trim();
}
const cellTop = (x: string) => cellHead(x).includes("⭐");
// Alternate routes live in the same row, in any cell, as a list separated by <br> (any bullet, "host - label" or "host: label").
// The server's own IP is skipped. Adding or removing a line in the README is all it takes.
const HOST = /[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d{2,5})?/i;
function rowRoutes(cells: string[], own: string): Route[]{
  const out: Route[] = [], seen = new Set([own.toLowerCase()]);
  cells.forEach((cell, i) => {
    if(i === 1 || (i >= 2 && i <= 4)) return;          // region + mode columns
    let t = cell.replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, "");
    if(i === 0 && t === cell) t = cell.split(/<br/i).slice(1).join("<br>"); // no <summary>: the IP is the first line
    for(const seg of t.split(/<br\s*\/?>|<\/?li>|<\/?p>/i)){
      const txt = seg.replace(/<[^>]*>/g, " ").replace(/&bull;|&middot;|&nbsp;/g, " ").replace(/[`*]/g, "").replace(/^[\s•·▪◦‣\-–—]+/, "").trim();
      if(!txt || /^alternat/i.test(txt)) continue;
      const m = txt.match(HOST); if(!m) continue;
      const host = m[0].toLowerCase(); if(seen.has(host)) continue;
      seen.add(host);
      let label = txt.slice(m.index + m[0].length).replace(/^[\s:\-–—|]+/, "").trim();
      if(/^\(.*\)$/.test(label)) label = label.slice(1, -1).trim();
      out.push({ip: host, label});
    }
  });
  return out;
}
export function parse(md: string): Server[]{
  const out: Server[] = [];
  let type: Server["type"] | null = null;
  const val = (x: string): Avail => x.includes("✅") ? 1 : x.includes("❌") ? 0 : x.includes("❔") ? "l" : null;
  for(const line of md.split(/\r?\n/)){
    const h = line.match(/^#{1,6}\s+(.*)/);
    if(h){
      const t = h[1].toLowerCase();
      type = t.includes("cracked") ? "cracked" : t.includes("premium") ? "premium" : null;
      continue;
    }
    if(!type || !line.trim().startsWith("|")) continue;
    const c = line.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim());
    if(c.length < 5 || /^[-:\s]+$/.test(c[0]) || /^server ip$/i.test(c[0])) continue;
    const flag = (c[1].match(/[\u{1F1E6}-\u{1F1FF}]{2}/u) || [""])[0];
    const region = flag ? [...flag].map(ch => String.fromCharCode(ch.codePointAt(0) - 127397)).join("") : "??";
    out.push({
      type,
      ip: cellIp(c[0]),
      top: cellTop(c[0]),
      region,
      duels: val(c[2]), ffa: val(c[3]), sandbox: val(c[4]),
      note: (c[5] || "").split(/<details|<br/i)[0].replace(/<[^>]*>/g, "").trim(),
      routes: rowRoutes(c, cellIp(c[0]))
    });
  }
  return out;
}
