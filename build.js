const fs = require("fs");

const README = fs.readFileSync("README.md", "utf8");
const INDEX = fs.readFileSync("index.html", "utf8");

const REGION_CODES = {
  "🇸🇬": "SG",
  "🇰🇷": "KR",
  "🇮🇳": "IN"
};

function value(cell) {
  const v = cell.trim();
  if (v === "✅") return 1;
  if (v === "❌") return 0;
  if (v === "❔") return "l";
  return null;
}

function parseServers(type, section) {
  const rows = section.split(/\r?\n/);
  return rows
    .filter(line => /^\|.*\|$/.test(line))
    .filter(line => !/^\|\s*Server IP\b/i.test(line))
    .filter(line => !/^\|\s*-+\s*\|/.test(line))
    .map(line => {
      const cells = line.split("|").slice(1, -1).map(s => s.trim());
      if (cells.length < 6) return null;

      let ip = cells[0];
      const top = ip.startsWith("⭐");
      ip = ip.replace(/^⭐\s*/, "");

      const region = REGION_CODES[cells[1]];
      if (!ip || !region) return null;

      return [
        type,
        ip,
        region,
        value(cells[2]),
        value(cells[3]),
        value(cells[4]),
        cells[5] || "",
        ...(top ? [1] : [])
      ];
    })
    .filter(Boolean);
}

function sectionBetween(start, end) {
  const a = README.indexOf(start);
  if (a === -1) return "";
  const b = end ? README.indexOf(end, a) : README.length;
  return README.slice(a, b === -1 ? README.length : b);
}

const premium = parseServers(
  "premium",
  sectionBetween("## 💎 Premium Servers", "## 🔓 Cracked Servers")
);

const cracked = parseServers(
  "cracked",
  sectionBetween("## 🔓 Cracked Servers", "---")
);

const servers = [...premium, ...cracked];

if (!servers.length) {
  throw new Error("No servers were parsed from README.md; refusing to overwrite index.html.");
}

const replacement =
  "const S = " +
  JSON.stringify(servers, null, 2) +
  ".map(a=>({type:a[0],ip:a[1],region:a[2],duels:a[3],ffa:a[4],sandbox:a[5],note:a[6],top:!!a[7]}));";

const pattern = /const S = \[[\s\S]*?\n\]\.map\(a=>\(\{type:a\[0\][\s\S]*?top:!!a\[7\]\}\)\);/;
if (!pattern.test(INDEX)) {
  throw new Error("Could not find the server data block in index.html; refusing to overwrite the design.");
}

const output = INDEX.replace(pattern, replacement);
fs.writeFileSync("index.html", output);

console.log(`Updated ${servers.length} servers from README.md while preserving index.html design.`);
