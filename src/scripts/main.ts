import type { Server } from "../lib/parse";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const $$ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelectorAll<T>(s);

/* ---------- State ---------- */
// Live status from the last visit (up to 1 hour old) is shown dimmed for an instant first paint.
// Every page load re-checks every server, and each row brightens once its fresh numbers arrive.
const CACHE_KEY = "as-status-v8", MAX_AGE = 60 * 60 * 1000;
const fresh = new Set<string>();   // servers whose numbers were refreshed during this page load
const flash: Record<string, {text: string; until: number}> = {};          // per-server button label ("Copied!") kept in data so a row redraw can't wipe it
const routeStatus: Record<string, any> = {};    // alternate-route host -> {t, busy, r}
let S: Server[] = [];      // the server list
let dlgIp: string | null = null;          // server shown in the pop-up

function readStore(key){
  try{ return JSON.parse(localStorage.getItem(key) || "null"); }catch{ return null; }
}
function writeStore(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch{}
}
function loadCache(){
  const c = readStore(CACHE_KEY);
  return c && Date.now() - c.t < MAX_AGE ? c.d : {};
}
function saveCache(){
  const d = Object.fromEntries(Object.entries(state.status).filter(([, v]) => !v.unknown));
  writeStore(CACHE_KEY, {t: Date.now(), d});
}
const state: {mode: string; q: string; region: string; sort: string; status: Record<string, any>} =
  {mode: "all", q: "", region: "all", sort: "default", status: loadCache()};

/* ---------- Shareable filters in the address bar ---------- */
const MODES = ["duels", "ffa", "sandbox"];
function syncUrl(){
  const p = new URLSearchParams();
  if(state.mode !== "all") p.set("mode", state.mode);
  if(state.region !== "all") p.set("region", state.region);
  if(state.sort !== "default") p.set("sort", state.sort);
  if(state.q.trim()) p.set("q", state.q.trim());
  const qs = p.toString();
  try{ history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash); }catch{}
}
function readUrl(){
  const p = new URLSearchParams(location.search);
  if(MODES.includes(p.get("mode"))) state.mode = p.get("mode");
  if(p.get("region") && S.some(s => s.region === p.get("region"))) state.region = p.get("region");
  if(p.get("sort") === "players") state.sort = "players";
  state.q = (p.get("q") || "").slice(0, 60);
  $$(".tab").forEach(t => t.setAttribute("aria-pressed", String(t.dataset.mode === state.mode)));
  $<HTMLSelectElement>("#region").value = state.region;
  $<HTMLSelectElement>("#sort").value = state.sort;
  $<HTMLInputElement>("#q").value = state.q;
}

/* ---------- Small helpers ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const flagOf = code => code.length === 2 && code !== "??" ? [...code].map(c => String.fromCodePoint(c.charCodeAt(0) + 127397)).join("") : "🌏";
const regionNames = (() => { try{ return new Intl.DisplayNames(["en"], {type: "region"}); }catch{ return null; } })();
const nameCache: Record<string, string> = {};
const nameOf = code => nameCache[code] ??= (() => { try{ return regionNames.of(code); }catch{ return code; } })();
const hue = ip => Math.abs([...ip].reduce((h, c) => h * 31 + c.charCodeAt(0) | 0, 7)) % 360;
const letterOf = ip => ip.replace(/^(as|play)\./, "")[0].toUpperCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const chip = (label, v) => {
  const cls = v === 1 ? "y" : v === "l" ? "l" : v === 0 ? "n" : "u";
  const text = v === 1 ? "available" : v === "l" ? "limited" : v === 0 ? "unavailable" : "unverified";
  return `<span class="chip ${cls}" title="${label}: ${text}">${label}${v === "l" ? " (limited)" : ""}${v === null ? " ?" : ""}</span>`;
};

// The server's own icon comes with its status lookup (a data: image); without one the letter tile is shown.
function iconHtml(st, ip, lazy){
  const letter = letterOf(ip);
  if(!st?.icon) return esc(letter);
  return `<img src="${esc(st.icon)}" alt="" width="64" height="64"${lazy ? ' loading="lazy"' : ""} decoding="async" data-l="${esc(letter)}" onerror="this.replaceWith(this.dataset.l)">`;
}

// One status badge for rows, the pop-up header and alternate routes.
// st: undefined = still checking, {unknown} = both services failed, else {online, players}.
function statusBadge(st: any, {ip, online}: {ip?: string; online?: string} = {}){
  let dot = "", text;
  if(!st) text = "Checking";
  else if(st.unknown) text = "Status unavailable";
  else if(st.online){ dot = " on"; text = online ?? `${st.players} online`; }
  else { dot = " off"; text = "Offline"; }
  const stale = st && !st.unknown && ip && !fresh.has(ip) ? " stale" : "";
  return `<span class="status${stale}"><span class="dot${dot}"></span>${text}</span>`;
}

/* ---------- Rendering ---------- */
function rowInner(s){
  const st = state.status[s.ip];
  const fl = flash[s.ip], label = fl && fl.until > Date.now() ? fl.text : "Copy IP";
  return `
    <div class="icon" style="background:hsl(${hue(s.ip)} 35% 32%)" aria-hidden="true">${iconHtml(st, s.ip, true)}</div>
    <div>
      <button class="ip" data-ip="${esc(s.ip)}" aria-label="Show info for ${esc(s.ip)}">${s.top ? '<span class="star" title="Top pick">★</span>' : ""}${esc(s.ip)}</button>
      <div class="meta"><span>${flagOf(s.region)} ${esc(nameOf(s.region))}</span>${statusBadge(st, {ip: s.ip})}${s.note ? `<span>${esc(s.note)}</span>` : ""}</div>
    </div>
    <div class="modes">${chip("Duels", s.duels)}${chip("FFA", s.ffa)}${chip("Sandbox", s.sandbox)}</div>
    <button class="btn copy" data-ip="${esc(s.ip)}">${label}</button>
  `;
}
const row = s => `<li class="srv" data-ip="${esc(s.ip)}">${rowInner(s)}</li>`;

// Default order: top picks first, otherwise README order.
const byTop = (a, b) => b.top - a.top;
// Players order ignores stars: most online first, offline/unknown last, inside each section.
// Ties keep README order because sorting is stable.
function byPlayers(a, b){
  const pa = state.status[a.ip], pb = state.status[b.ip];
  return (pb?.online ? pb.players : -1) - (pa?.online ? pa.players : -1);
}

// Redraw while keeping the row under the sticky bar at the same place on screen.
function keepAnchor(fn){
  const barH = $(".bar")?.offsetHeight || 0;
  const a = [...$$(".srv")].find(r => r.getBoundingClientRect().bottom > barH);
  const ip = a?.dataset.ip, top = a?.getBoundingClientRect().top;
  fn();
  if(!ip) return;
  const n = $(`.srv[data-ip="${CSS.escape(ip)}"]`);
  if(n) scrollBy({top: n.getBoundingClientRect().top - top, behavior: "instant"});
}

function render(){
  syncUrl();
  const q = state.q.trim().toLowerCase();
  const matches = S.filter(s =>
    (state.mode === "all" || s[state.mode] === 1 || s[state.mode] === "l") &&
    (state.region === "all" || s.region === state.region) &&
    (!q || s.ip.toLowerCase().includes(q)));
  const group = (type, title, sub) => {
    const items = matches.filter(s => s.type === type).sort(state.sort === "players" ? byPlayers : byTop);
    return items.length ? `<h2>${title}</h2><p class="sub">${sub}</p><ul class="list">${items.map(row).join("")}</ul>` : "";
  };
  $("#out").innerHTML =
    group("premium", "Premium servers", "Require a paid Minecraft account.") +
    group("cracked", "Cracked servers", "Also open to non-premium accounts.") ||
    `<div class="empty">No servers match your filters. Clear the search or pick another mode.</div>`;
}

// Hero stats, region filter, and the ItemList structured data all follow the loaded list.
function setup(){
  const regions = [...new Set(S.map(s => s.region))];
  $<HTMLSelectElement>("#region").innerHTML = '<option value="all">All regions</option>' +
    regions.map(r => `<option value="${r}">${flagOf(r)} ${esc(nameOf(r))}</option>`).join("");
  $("#stats").innerHTML =
    `<span><b>${S.length}</b> servers</span><span><b>${S.filter(s => s.top).length}</b> top picks</span>` +
    `<span><b>${regions.length}</b> regions</span><span id="online"></span>`;
}
function showOnline(){
  const on = S.filter(s => state.status[s.ip]?.online);
  if(on.length) $("#online").innerHTML = `<b>${on.reduce((n, s) => n + state.status[s.ip].players, 0)}</b> players online now`;
}

/* ---------- Copy to clipboard ---------- */
async function copyText(text){
  try{ await navigator.clipboard.writeText(text); return true; }catch{}
  try{ // fallback for older browsers
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  }catch{ return false; }
}
async function copyIp(ip, btn){
  const ok = await copyText(ip);
  flash[ip] = {text: ok ? "Copied!" : "Couldn't copy", until: Date.now() + 1400};
  const set = t => {
    const b = btn.isConnected ? btn : $(`.srv[data-ip="${CSS.escape(ip)}"] .copy`);
    if(b) b.textContent = t;
  };
  set(flash[ip].text);
  setTimeout(() => { if(Date.now() >= flash[ip].until) set("Copy IP"); }, 1450);
}

/* ---------- Live status ---------- */
// Primary source: mcstatus.io (fast). If it fails, or says "offline", mcsrvstat.us double-checks.
async function getJson(url, ms){
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try{
    const r = await fetch(url, {signal: ctl.signal});
    if(!r.ok) throw new Error("http " + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}
const num = v => Number.isFinite(v) ? v : 0;
const dataIcon = i => typeof i === "string" && i.startsWith("data:image/") ? i : null;
const SOURCES = [
  ip => getJson(`https://api.mcstatus.io/v2/status/java/${encodeURIComponent(ip)}?query=false&timeout=4`, 7000),
  ip => getJson(`https://api.mcsrvstat.us/3/${encodeURIComponent(ip)}`, 9000)
];
const toStatus = d => ({online: !!d.online, players: num(d.players?.online), icon: dataIcon(d.icon)});

// First "online" answer wins; otherwise the first answer we got; null if every service failed.
async function lookup(ip){
  let first = null;
  for(const source of SOURCES){
    try{
      const r = toStatus(await source(ip));
      if(r.online) return r;
      first ??= r;
    }catch{}
  }
  return first;
}

async function refresh(s){
  const r = await lookup(s.ip);
  if(r){
    fresh.add(s.ip);
    state.status[s.ip] = r;
  }else if(!state.status[s.ip] || state.status[s.ip].unknown){
    state.status[s.ip] = {unknown: true};
  }
  // Redraw from the CURRENT list: if the README refresh replaced the saved list while this lookup
  // was running, `s` is an outdated copy (e.g. missing a newly added star).
  const cur = S.find(x => x.ip === s.ip);
  const li = $(`.srv[data-ip="${CSS.escape(s.ip)}"]`);
  if(li && cur) li.innerHTML = rowInner(cur);
  if(dlgIp === s.ip) renderInfo();
}
async function runPool(list, n){
  const queue = [...list];
  await Promise.all(Array.from({length: n}, async () => { while(queue.length) await refresh(queue.shift()); }));
}
async function checkAll(){
  await runPool(S, 6); // every server is checked directly; each row updates as its answer arrives
  const failed = S.filter(s => !fresh.has(s.ip));
  if(failed.length){ await new Promise(r => setTimeout(r, 2500)); await runPool(failed, 2); } // one gentle retry
  saveCache();
  showOnline();
  if(state.sort === "players") keepAnchor(render); // re-order once the fresh counts are in
}

/* ---------- Server pop-up ---------- */
const dlg = $<HTMLDialogElement>("#dlg");

// Alternate routes come from the README rows (see rowRoutes). Their status is checked each time the pop-up opens.
async function checkRoutes(s){
  const hosts = (s.routes || []).map(r => r.ip).filter(h => !(routeStatus[h]?.t > Date.now() - 60000));
  hosts.forEach(h => { routeStatus[h] = {...routeStatus[h], t: Date.now(), busy: true}; });
  if(dlgIp === s.ip) renderInfo();
  await Promise.all(hosts.map(async h => {
    routeStatus[h] = {t: Date.now(), r: await lookup(h)}; // host or host:port
    if(dlgIp === s.ip) renderInfo();
  }));
}
function routeBadge(host){
  const x = routeStatus[host];
  const st = !x || x.busy ? undefined : x.r || {unknown: true};
  return statusBadge(st, {online: "Online"});
}

function renderInfo(){
  const s = S.find(x => x.ip === dlgIp); if(!s) return;
  const st = state.status[s.ip], enc = encodeURIComponent(s.ip);
  const icon = $("#dlg-icon");
  icon.style.background = `hsl(${hue(s.ip)} 35% 32%)`;
  icon.innerHTML = iconHtml(st, s.ip, false);
  $("#dlg-title").textContent = s.ip;
  $("#dlg-sub").innerHTML = `<span>${flagOf(s.region)} ${esc(nameOf(s.region))}</span>` +
    statusBadge(st, {ip: s.ip, online: st?.online ? `Online · ${plural(st.players, "player")}` : undefined});
  $<HTMLAnchorElement>("#dlg-ext").href = `https://mcsrvstat.us/server/${enc}`;
  $<HTMLAnchorElement>("#dlg-nmc").href = `https://namemc.com/server/${enc}`;
  $<HTMLAnchorElement>("#dlg-geo").href = `https://ipgeolocation.io/what-is-my-ip/${enc}`;

  const routes = s.routes || [];
  const routesHtml = routes.length
    ? `<div class="kv">${routes.map(x => `<div class="kr rt"><b><button type="button" class="dbgbtn" data-act="copyroute" data-ip="${esc(x.ip)}" title="Copy">${esc(x.ip)}</button></b><span>${esc(x.label)}</span><small>${routeBadge(x.ip)}</small></div>`).join("")}</div>`
    : `<p class="dnote">No alternate routes listed for this server.</p>`;

  const box = $("#dlg-body"), scroll = box.scrollTop;
  box.innerHTML = `<div><div class="dsec"><span>Alternate Routing</span></div>${routesHtml}</div>`;
  box.scrollTop = scroll;
}
function openInfo(ip){
  const s = S.find(x => x.ip === ip); if(!s) return;
  dlgIp = ip;
  $("#dlg-copy").textContent = "Copy IP";
  renderInfo();
  if(!dlg.open) dlg.showModal();
  checkRoutes(s);
}

/* ---------- Events ---------- */
$("#tabs").addEventListener("click", e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(".tab"); if(!b) return;
  state.mode = b.dataset.mode;
  $$(".tab").forEach(t => t.setAttribute("aria-pressed", String(t === b)));
  render();
});
let qTimer;
$<HTMLInputElement>("#q").addEventListener("input", e => {
  clearTimeout(qTimer);
  const v = (e.target as HTMLInputElement).value;
  qTimer = setTimeout(() => { state.q = v; render(); }, 120);
});
$<HTMLSelectElement>("#region").addEventListener("change", e => { state.region = (e.target as HTMLInputElement).value; render(); });
$<HTMLSelectElement>("#sort").addEventListener("change", e => { state.sort = (e.target as HTMLInputElement).value; render(); });
$("#browse").addEventListener("click", e => { e.preventDefault(); $("#servers").scrollIntoView({block: "start"}); });

// Click a server box to open its pop-up. The Copy IP button still copies directly.
$("#out").addEventListener("click", e => {
  const card = (e.target as HTMLElement).closest<HTMLElement>(".srv"); if(!card) return;
  const ip = card.dataset.ip, btn = (e.target as HTMLElement).closest(".copy");
  if(btn){ copyIp(ip, btn); return; }
  const sel = getSelection(); // don't open while the visitor is selecting text
  if(String(sel).trim() && sel.anchorNode && card.contains(sel.anchorNode)) return;
  openInfo(ip);
});
$("#dlg-body").addEventListener("click", async e => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act=copyroute]"); if(!b) return;
  const host = b.dataset.ip;
  b.textContent = (await copyText(host)) ? "Copied!" : "Couldn't copy";
  setTimeout(() => { b.textContent = host; }, 1200);
});
$("#dlg-close").addEventListener("click", () => dlg.close());
$("#dlg-copy").addEventListener("click", e => dlgIp && copyIp(dlgIp, e.currentTarget));
dlg.addEventListener("click", e => { if(e.target === dlg) dlg.close(); }); // click on the backdrop
dlg.addEventListener("close", () => { dlgIp = null; });

/* ---------- Start ---------- */
// The server list is parsed from README.md at build time and embedded in the page.
let checks: Promise<void> = Promise.resolve();
function applyList(data: Server[]){
  S = data;
  setup();
  readUrl();
  render();
  showOnline();
  checks = checks.then(checkAll);
}
applyList(JSON.parse($("#servers-data").textContent || "[]"));
