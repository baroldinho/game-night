import * as store from "./store.js";
import { HOST_NAME, MAX_YES, MAX_NO } from "./config.js";

// ------------------------------------------------------------------ state
const S = {
  games: [], byId: {}, source: "starter", gamesLoaded: false,
  user: store.getUser(), authProblem: "",
  night: null, nightLoaded: false,
  myBallot: null, draft: { yes: [], no: [] }, draftDirty: false, saveState: "",
  name: readLocal("gn-name"), editingName: false,
  ballots: [],
  priv: {}, privLoaded: false, shortlists: {},
  filters: { q: "", players: 0, best: false, time: 0, cx: [], tags: [], hideAdults: false },
  filtersOpen: false,
  builder: { selected: new Set(), forNight: null, ready: false },
  printMode: "all",
  editing: null,
  pendingRender: false,
};

const FILTER_TAGS = ["Strategy", "Co-op", "Party", "Deduction", "Bluffing", "Word & trivia", "Dexterity", "Family", "Thematic", "Campaign", "Two-player", "Quick"];
const MANUAL_TAGS = FILTER_TAGS.slice(0, 10);
const $app = document.getElementById("app");
const $print = document.getElementById("print-root");

function readLocal(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
function writeLocal(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

// ------------------------------------------------------------------ helpers
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const span = (a, b) => (a === b ? `${a}` : `${a}–${b}`);
const playersText = (g) => `${span(g.players[0], g.players[1])} player${g.players[1] > 1 ? "s" : ""}`;
const timeText = (g) => `${span(g.time[0], g.time[1])} min`;
function bestText(g) {
  const b = (g.best || []).slice().sort((x, y) => x - y);
  if (!b.length) return "";
  const consecutive = b.every((v, i) => i === 0 || v === b[i - 1] + 1);
  return consecutive && b.length > 1 ? `${b[0]}–${b[b.length - 1]}` : b.join(", ");
}
const think = (n) => `<span class="think" role="img" aria-label="Complexity ${n} of 5">${"🤔".repeat(n)}</span>`;
const isTwo = (g) => g.players[1] === 2;
const isQuick = (g) => g.time[1] <= 30;
const gameTags = (g) => [...(g.tags || []), ...(isTwo(g) ? ["Two-player"] : []), ...(isQuick(g) ? ["Quick"] : [])];
const sortName = (n) => n.replace(/^(the|a)\s+/i, "").toLowerCase();
const byName = (a, b) => sortName(a.name).localeCompare(sortName(b.name));
const isOwner = () => !!S.user.isOwner;
const nightOpen = () => S.night && S.night.status === "open";
const onShortlist = (id) => S.night && S.night.mode === "shortlist" && (S.night.shortlist || []).includes(id);
const votable = (id) => S.night && (S.night.mode === "all" || (S.night.shortlist || []).includes(id));

function toast(msg) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function setGames(list, source) {
  S.games = list.slice().sort(byName);
  S.byId = Object.fromEntries(S.games.map((g) => [g.id, g]));
  S.source = source; S.gamesLoaded = true;
}

function matches(g, f) {
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!g.name.toLowerCase().includes(q) && !(g.summary || "").toLowerCase().includes(q)) return false;
  }
  if (f.players) {
    const n = f.players;
    const fits = n >= 8 ? g.players[1] >= 8 : g.players[0] <= n && g.players[1] >= n;
    if (!fits) return false;
    if (f.best && !(g.best || []).some((b) => (n >= 8 ? b >= 8 : b === n))) return false;
  }
  if (f.time && g.time[1] > f.time) return false;
  if (f.cx.length && !f.cx.includes(g.complexity)) return false;
  if (f.tags.length) { const t = gameTags(g); if (!f.tags.every((x) => t.includes(x))) return false; }
  if (f.hideAdults && g.adults) return false;
  return true;
}
const filtered = (list = S.games) => list.filter((g) => matches(g, S.filters));
const activeFilterCount = () => {
  const f = S.filters;
  return (f.players ? 1 : 0) + (f.time ? 1 : 0) + f.cx.length + f.tags.length + (f.hideAdults ? 1 : 0);
};

function similar(g) {
  return S.games.filter((o) => o.id !== g.id).map((o) => {
    const shared = (o.tags || []).filter((t) => (g.tags || []).includes(t)).length;
    const overlap = o.players[0] <= g.players[1] && o.players[1] >= g.players[0] ? 1 : 0;
    return { o, shared, score: shared * 3 - Math.abs(o.complexity - g.complexity) * 2 + overlap };
  }).filter((x) => x.shared > 0).sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.o);
}

// ------------------------------------------------------------------ subscriptions
let unsubNight = null, unsubMine = null, unsubAll = null, subsKey = "", lastUid = null, lastOwner = false;

function startNightWatch() {
  if (unsubNight) unsubNight();
  unsubNight = store.watchCurrentNight((n) => {
    const changed = (n && n.id) !== (S.night && S.night.id);
    S.night = n; S.nightLoaded = true;
    if (changed) { S.draft = { yes: [], no: [] }; S.draftDirty = false; S.myBallot = null; S.ballots = []; }
    refreshSubs(); refresh();
  });
}

function refreshSubs() {
  const nid = S.night ? S.night.id : "";
  const key = `${nid}|${S.user.uid}|${S.user.isOwner}`;
  if (key === subsKey) return;
  subsKey = key;
  if (unsubMine) { unsubMine(); unsubMine = null; }
  if (unsubAll) { unsubAll(); unsubAll = null; }
  if (nid && S.user.uid) {
    unsubMine = store.watchMyBallot(nid, (b) => {
      S.myBallot = b;
      if (!S.draftDirty) S.draft = b ? { yes: [...(b.yes || [])], no: [...(b.no || [])] } : { yes: [], no: [] };
      if (b && b.name && !S.name) { S.name = b.name; writeLocal("gn-name", b.name); }
      refresh();
    });
  }
  if (nid && S.user.isOwner) unsubAll = store.watchBallots(nid, (list) => { S.ballots = list; refresh(); });
}

async function loadOwnerData() {
  try {
    const [priv, lists] = await Promise.all([store.loadPrivate(), store.loadShortlists()]);
    S.priv = priv; S.shortlists = lists; S.privLoaded = true;
  } catch (e) { S.privLoaded = true; }
  refresh();
}

store.onUser((u, problem) => {
  S.user = u; S.authProblem = problem || "";
  if ((u.uid && u.uid !== lastUid) || (!u.uid && problem && lastUid !== "none")) {
    lastUid = u.uid || "none";
    startNightWatch();
  }
  if (u.isOwner && !lastOwner) { lastOwner = true; loadOwnerData(); }
  if (!u.isOwner && lastOwner) { lastOwner = false; S.priv = {}; S.privLoaded = false; }
  refreshSubs(); refresh();
});
setTimeout(() => { if (!S.nightLoaded) { S.nightLoaded = true; refresh(); } }, 5000);

store.loadGames().then(({ games, source }) => { setGames(games, source); refresh(); })
  .catch(() => { $app.innerHTML = `<div class="wrap"><p class="notice warn">The collection couldn't load. Check your connection and reload the page.</p></div>`; });

// ------------------------------------------------------------------ rendering
function refresh() {
  const a = document.activeElement;
  if (a && $app.contains(a) && a.matches("input, textarea, select")) { S.pendingRender = true; return; }
  render();
}
$app.addEventListener("focusout", () => setTimeout(() => {
  const a = document.activeElement;
  if (S.pendingRender && !(a && $app.contains(a) && a.matches("input, textarea, select"))) { S.pendingRender = false; render(); }
}, 50));

function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, query] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  return { parts, params: new URLSearchParams(query || "") };
}

function render() {
  S.pendingRender = false;
  if (!S.gamesLoaded) { $app.innerHTML = `<p class="loading">Loading the collection…</p>`; return; }
  const { parts, params } = route();
  let body;
  const view = parts[0] || "";
  if (view === "") {
    if (!S.nightLoaded) { $app.innerHTML = `<p class="loading">Checking for a game night…</p>`; return; }
    body = S.night ? viewVote() : viewCollection(params);
  } else if (view === "all") body = viewCollection(params);
  else if (view === "game" && S.byId[parts[1]]) body = viewGame(S.byId[parts[1]], params);
  else if (view === "vote") body = viewVote();
  else if (view === "host" && parts[1] === "shortlist") body = viewBuilder();
  else if (view === "host") body = viewHost();
  else if (view === "print") body = viewPrint();
  else body = `<h1>Page not found</h1><p><a href="#/all">Go to the collection</a></p>`;
  $app.innerHTML = `<div class="wrap">${masthead(view)}${body}${footer()}</div>`;
  if (view !== "print") $print.innerHTML = "";
}

const spark = `<svg class="spark" viewBox="0 0 3 3" aria-hidden="true"><path fill="currentColor" d="M1 0h1v3H1zM0 1h3v1H0z"/></svg>`;
function masthead(view) {
  const cur = (v) => (view === v ? ' aria-current="page"' : "");
  return `<header class="masthead">
    <a class="wordmark" href="#/">${spark}GAME NIGHT</a>
    <nav aria-label="Main">
      <a href="#/all"${cur("all")}>Collection</a>
      ${S.night ? `<a href="#/vote"${cur("vote") || (view === "" ? ' aria-current="page"' : "")}>Vote</a>` : ""}
      ${isOwner() ? `<a href="#/host"${cur("host")}>Host</a>` : ""}
    </nav>
  </header>`;
}
function footer() {
  return `<footer class="site"><span>${S.games.length} games in ${esc(HOST_NAME)}'s collection</span>
    <a href="#/host">${isOwner() ? "Host tools" : "Host sign-in"}</a></footer>`;
}

// ---------- filters
function filtersBlock() {
  const f = S.filters;
  const chip = (action, v, on, label) => `<button type="button" class="chip" data-action="${action}" data-v="${esc(v)}" aria-pressed="${on}">${label}</button>`;
  const players = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => chip("f-players", n, f.players === n, n === 0 ? "Any" : n === 8 ? "8+" : n)).join("");
  const times = [[0, "Any"], [30, "30 min"], [60, "1 hour"], [90, "90 min"], [120, "2 hours"]].map(([v, l]) => chip("f-time", v, f.time === v, l)).join("");
  const cx = [1, 2, 3, 4, 5].map((n) => chip("f-cx", n, f.cx.includes(n), "🤔".repeat(n))).join("");
  const tags = FILTER_TAGS.map((t) => chip("f-tag", t, f.tags.includes(t), esc(t))).join("");
  const n = activeFilterCount();
  return `<label class="search"><span class="sr-only" hidden>Search</span>
      <input type="search" data-input="q" value="${esc(f.q)}" placeholder="Search games" aria-label="Search games" autocomplete="off"></label>
    <details class="filters"${S.filtersOpen ? " open" : ""}>
      <summary><span>Filters${n ? ` (${n})` : ""}</span><span class="muted">${S.filtersOpen ? "Hide" : "Show"}</span></summary>
      <div class="filter-body">
        <div class="filter-label">How many are playing?</div><div class="chips">${players}</div>
        ${f.players ? `<label class="check"><input type="checkbox" data-action="f-best" ${f.best ? "checked" : ""}> Only games that are best at ${f.players === 8 ? "8+" : f.players}</label>` : ""}
        <div class="filter-label">Time available</div><div class="chips">${times}</div>
        <div class="filter-label">Complexity</div><div class="chips">${cx}</div>
        <div class="filter-label">Type of game</div><div class="chips">${tags}</div>
        <label class="check"><input type="checkbox" data-action="f-adults" ${f.hideAdults ? "checked" : ""}> Hide adults-only games</label>
        ${n || f.q ? `<div class="btn-row"><button type="button" class="btn quiet" data-action="f-clear">Clear filters</button></div>` : ""}
      </div>
    </details>`;
}

function factsLine(g) {
  return `<span class="facts"><span>${playersText(g)}</span><span>${timeText(g)}</span>${think(g.complexity)}</span>`;
}
function gameRow(g) {
  const badges = `${onShortlist(g.id) ? '<span class="badge tonight">On tonight\'s list</span>' : ""}${g.adults ? '<span class="badge adults">Adults</span>' : ""}${isOwner() && S.priv[g.id] && S.priv[g.id].check ? '<span class="badge check">Check</span>' : ""}`;
  return `<li><a class="row" href="#/game/${esc(g.id)}"><span class="row-name">${esc(g.name)}${badges}</span>${factsLine(g)}</a></li>`;
}

// ---------- collection
let resultsFn = null;
function viewCollection(params) {
  resultsFn = () => {
    const list = filtered();
    return `<div class="toolbar"><span class="muted">${list.length === S.games.length ? `All ${list.length} games` : `${list.length} of ${S.games.length} games`}</span>
      <button type="button" class="btn ghost" data-action="pick" ${list.length ? "" : "disabled"}>Pick one for us</button></div>
      ${list.length ? `<ul class="list">${list.map(gameRow).join("")}</ul>` : `<p class="empty">Nothing matches those filters. Try removing one.</p>`}`;
  };
  return `${S.night ? `<div class="notice">${nightOpen() ? `Game night is on. <a href="#/vote">Cast your votes</a>.` : `Voting has closed. ${esc(HOST_NAME)} will announce the winner.`}</div>` : ""}
    <h1>The collection</h1>
    ${filtersBlock()}
    <div id="results">${resultsFn()}</div>`;
}

// ---------- game page
function voteButtons(g) {
  const closed = !nightOpen();
  const y = S.draft.yes.includes(g.id), n = S.draft.no.includes(g.id);
  return `<div class="vote-btns">
    <button type="button" class="vote yes" data-action="vote-yes" data-id="${esc(g.id)}" aria-pressed="${y}" ${closed ? "disabled" : ""}>${y ? "Yes ✓" : "Yes"}</button>
    <button type="button" class="vote no" data-action="vote-no" data-id="${esc(g.id)}" aria-pressed="${n}" ${closed ? "disabled" : ""}>${n ? "No ✓" : "No"}</button>
  </div>`;
}

function viewGame(g, params) {
  const picked = params.get("picked");
  const best = bestText(g);
  const sim = similar(g);
  const q = encodeURIComponent(g.name);
  const editing = isOwner() && S.editing === g.id;
  const canVote = S.night && votable(g.id);
  return `<a class="back" href="#/all">Back to the collection</a>
    ${picked ? `<div class="picked"><strong>Picked for you</strong> from ${esc(picked)} matching games. <button type="button" class="btn ghost" data-action="pick">Pick again</button></div>` : ""}
    <h1>${esc(g.name)}${g.adults ? '<span class="badge adults">Adults</span>' : ""}</h1>
    ${onShortlist(g.id) ? `<p><span class="badge tonight" style="margin-left:0">On tonight's list</span></p>` : ""}
    <dl class="factgrid">
      <div><dt>Players</dt><dd>${span(g.players[0], g.players[1])}</dd></div>
      ${best ? `<div><dt>Best with</dt><dd>${best}</dd></div>` : ""}
      <div><dt>Time</dt><dd>${timeText(g)}</dd></div>
      <div><dt>Age</dt><dd>${g.age}+</dd></div>
      <div><dt>Complexity</dt><dd>${think(g.complexity)}</dd></div>
    </dl>
    ${canVote ? `<div class="panel"><strong>${nightOpen() ? "Vote on this game for tonight" : "Voting has closed"}</strong>${nameLine(true)}${voteButtons(g)}<p class="small muted" style="margin:8px 0 0">${voteCountText()}</p></div>` : ""}
    ${editing ? editForm(g) : `
      ${g.summary ? `<p class="lead">${esc(g.summary)}</p>` : ""}
      <div class="taglist">${gameTags(g).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      ${(g.teach || []).length ? `<h2>How to play in a minute</h2><ol class="teach">${g.teach.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : ""}
      ${(g.expansions || []).length ? `<h2>Expansions in the box</h2><ul>${g.expansions.map((x) => `<li><strong>${esc(x.name)}</strong>${x.note ? ` — ${esc(x.note)}` : ""}</li>`).join("")}</ul>` : ""}
      ${g.shelf ? `<h2>Where it lives</h2><p>${esc(g.shelf)}</p>` : ""}
      ${g.packPhoto ? `<h2>Putting it away</h2><p class="muted small">Pack it back like this:</p><img src="${esc(g.packPhoto)}" alt="How ${esc(g.name)} packs into its box" loading="lazy">` : ""}
      ${sim.length ? `<h2>If you like this, try</h2><ul class="list">${sim.map(gameRow).join("")}</ul>` : ""}
      <h2>Learn more</h2>
      <ul>
        <li><a href="https://boardgamegeek.com/geeksearch.php?action=search&amp;objecttype=boardgame&amp;q=${q}" target="_blank" rel="noopener">Find it on BoardGameGeek</a></li>
        <li><a href="https://www.youtube.com/results?search_query=${encodeURIComponent("how to play " + g.name)}" target="_blank" rel="noopener">How-to-play videos</a></li>
      </ul>
      ${isOwner() ? `<div class="btn-row"><button type="button" class="btn quiet" data-action="edit" data-id="${esc(g.id)}">Edit this game</button></div>` : ""}`}
    ${isOwner() ? privatePanel(g) : ""}`;
}

function editForm(g) {
  const tagBoxes = MANUAL_TAGS.map((t) => `<label class="check"><input type="checkbox" name="tag" value="${esc(t)}" ${(g.tags || []).includes(t) ? "checked" : ""}> ${esc(t)}</label>`).join("");
  const exp = (g.expansions || []).map((x) => `${x.name}${x.note ? `: ${x.note}` : ""}`).join("\n");
  return `<form id="edit-form" class="panel owner" onsubmit="return false">
    <h2>Edit ${esc(g.name)}</h2>
    ${S.source !== "live" ? `<p class="notice warn">Import the starter list on the Host page before editing, or your change will be the only game in the database.</p>` : ""}
    <label for="e-name">Name</label><input id="e-name" type="text" name="name" value="${esc(g.name)}">
    <label for="e-summary">Summary</label><textarea id="e-summary" name="summary">${esc(g.summary)}</textarea>
    <label for="e-teach">How to play in a minute (one point per line)</label><textarea id="e-teach" name="teach">${esc((g.teach || []).join("\n"))}</textarea>
    <div class="grid2">
      <div><label for="e-pmin">Fewest players</label><input id="e-pmin" type="number" name="pmin" min="1" value="${g.players[0]}"></div>
      <div><label for="e-pmax">Most players</label><input id="e-pmax" type="number" name="pmax" min="1" value="${g.players[1]}"></div>
      <div><label for="e-tmin">Shortest time (min)</label><input id="e-tmin" type="number" name="tmin" min="1" value="${g.time[0]}"></div>
      <div><label for="e-tmax">Longest time (min)</label><input id="e-tmax" type="number" name="tmax" min="1" value="${g.time[1]}"></div>
      <div><label for="e-best">Best with (e.g. 3, 4)</label><input id="e-best" type="text" name="best" value="${esc((g.best || []).join(", "))}"></div>
      <div><label for="e-age">Minimum age</label><input id="e-age" type="number" name="age" min="0" value="${g.age}"></div>
    </div>
    <label for="e-cx">Complexity</label>
    <select id="e-cx" name="complexity">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${g.complexity === n ? "selected" : ""}>${"🤔".repeat(n)} (${n})</option>`).join("")}</select>
    <div class="filter-label">Type of game</div>${tagBoxes}
    <label class="check"><input type="checkbox" name="adults" ${g.adults ? "checked" : ""}> Adults only</label>
    <label for="e-exp">Expansions (one per line, "Name: note")</label><textarea id="e-exp" name="expansions">${esc(exp)}</textarea>
    <label for="e-shelf">Where it lives (shelf)</label><input id="e-shelf" type="text" name="shelf" value="${esc(g.shelf || "")}">
    <div class="btn-row"><button type="button" class="btn" data-action="edit-save" data-id="${esc(g.id)}">Save changes</button>
      <button type="button" class="btn quiet" data-action="edit-cancel">Cancel</button></div>
  </form>`;
}

function privatePanel(g) {
  if (!S.privLoaded) return `<div class="panel owner"><p class="muted">Loading your notes…</p></div>`;
  const p = S.priv[g.id] || {};
  const sleeves = (p.sleeves || []).filter((s) => s.card || s.count || s.sleeve || s.status);
  return `<section class="panel owner" aria-labelledby="priv-h">
    <h2 id="priv-h">Only you can see this</h2>
    ${p.check ? `<p class="notice warn"><strong>To check:</strong> ${esc(p.check)}</p>` : ""}
    <p><strong>Last played:</strong> ${p.lastPlayed ? esc(p.lastPlayed) : "not recorded"}${p.plays ? ` (${p.plays} play${p.plays > 1 ? "s" : ""} recorded)` : ""}</p>
    <div class="btn-row"><button type="button" class="btn" data-action="played" data-id="${esc(g.id)}">Mark as played today</button></div>
    <p><strong>Custom insert:</strong> ${esc(p.insert || "not recorded")}${p.pieces ? `<br><strong>Custom pieces:</strong> ${esc(p.pieces)}` : ""}</p>
    ${sleeves.length ? `<h3>Cards and sleeves</h3><div class="table-wrap"><table><thead><tr><th>Cards</th><th>Size</th><th class="num">Count</th><th>Sleeve</th><th>Status</th></tr></thead><tbody>
      ${sleeves.map((s) => `<tr><td>${esc(s.part)}</td><td>${esc(s.card)}</td><td class="num">${s.count ?? ""}</td><td>${esc(s.sleeve)}${s.sleeveSize ? `<br><span class="muted small">${esc(s.sleeveSize)}</span>` : ""}</td><td>${esc(s.status)}</td></tr>`).join("")}
    </tbody></table></div>` : ""}
    <label for="p-notes">Your notes</label><textarea id="p-notes" data-id="${esc(g.id)}">${esc(p.notes || "")}</textarea>
    <div class="btn-row"><button type="button" class="btn quiet" data-action="notes-save" data-id="${esc(g.id)}">Save notes</button></div>
  </section>`;
}

// ---------- voting
function voteCountText() {
  if (!nightOpen()) return `Voting has closed. ${esc(HOST_NAME)} will announce the winner.`;
  const s = S.saveState === "saving" ? "Saving…" : S.saveState === "saved" ? "Saved." : S.saveState === "error" ? "Couldn't save. Try again." : "";
  return `Yes ${S.draft.yes.length} of ${MAX_YES}, No ${S.draft.no.length} of ${MAX_NO}. ${s}`;
}
function nameLine(compact) {
  if (!S.name || S.editingName) {
    return `<div class="name-box"><label for="voter-name">Your first name</label>
      <div class="btn-row" style="margin-top:4px"><input id="voter-name" type="text" maxlength="30" autocomplete="given-name" value="${esc(S.name)}" style="flex:1;min-width:160px">
      <button type="button" class="btn" data-action="name-save">Save name</button></div>
      ${compact ? "" : `<p class="small muted">So ${esc(HOST_NAME)} can see who has voted. Nobody else sees your votes.</p>`}</div>`;
  }
  return `<p class="small" style="margin:6px 0 0">Voting as <strong>${esc(S.name)}</strong>. <button type="button" class="btn ghost" style="min-height:32px;padding:2px 8px" data-action="name-edit">Change</button></p>`;
}

function viewVote() {
  if (!S.nightLoaded) return `<p class="loading">Checking for a game night…</p>`;
  if (!S.night) return `<h1>No game night right now</h1><p>Voting opens when ${esc(HOST_NAME)} starts a game night. In the meantime, <a href="#/all">browse the collection</a>.</p>`;
  const n = S.night;
  const open = nightOpen();
  const games = n.mode === "all" ? filtered() : (n.shortlist || []).map((id) => S.byId[id]).filter(Boolean).sort(byName);
  resultsFn = () => {
    const list = n.mode === "all" ? filtered() : games;
    if (!list.length) return `<p class="empty">${n.mode === "all" ? "Nothing matches those filters." : "The shortlist is empty."}</p>`;
    return `<ul class="list">${list.map((g) => `<li class="vote-item"><a class="row-name" href="#/game/${esc(g.id)}">${esc(g.name)}</a>${factsLine(g)}
      ${g.summary ? `<p class="snippet">${esc(g.summary.split(/(?<=\.)\s/)[0])}</p>` : ""}${voteButtons(g)}</li>`).join("")}</ul>`;
  };
  const yesFull = S.draft.yes.length >= MAX_YES, noFull = S.draft.no.length >= MAX_NO;
  return `<h1>${n.mode === "all" ? "Vote for tonight's game" : "Tonight's shortlist"}</h1>
    <p>Give a Yes to up to ${MAX_YES} games you'd like to play and a No to ${MAX_NO === 1 ? "one game" : `up to ${MAX_NO} games`} you'd rather not. Only ${esc(HOST_NAME)} sees the totals.</p>
    ${S.authProblem ? `<p class="notice warn">${esc(S.authProblem)}</p>` : ""}
    ${open ? nameLine(false) : `<p class="notice">Voting has closed. ${esc(HOST_NAME)} will announce the winner.</p>`}
    ${open ? `<div class="counter" aria-live="polite"><span class="count yes${yesFull ? " full" : ""}">YES ${S.draft.yes.length}/${MAX_YES}</span><span class="count no${noFull ? " full" : ""}">NO ${S.draft.no.length}/${MAX_NO}</span><span class="small muted">${S.saveState === "saving" ? "Saving…" : S.saveState === "saved" ? "Saved" : S.saveState === "error" ? "Couldn't save" : ""}</span></div>` : ""}
    ${n.mode === "all" ? filtersBlock() : ""}
    <div id="results">${resultsFn()}</div>
    <p style="margin-top:20px"><a href="#/all">Browse the whole collection</a></p>`;
}

let saveTimer = null;
function toggleVote(id, kind) {
  if (!nightOpen()) return;
  if (!S.user.uid) { toast(S.authProblem || "Still connecting. Try again in a moment."); return; }
  if (!S.name) { toast("Add your first name first."); const i = document.getElementById("voter-name"); if (i) i.focus(); return; }
  const d = { yes: [...S.draft.yes], no: [...S.draft.no] };
  const mine = d[kind], other = kind === "yes" ? d.no : d.yes, max = kind === "yes" ? MAX_YES : MAX_NO;
  if (mine.includes(id)) mine.splice(mine.indexOf(id), 1);
  else {
    if (mine.length >= max) {
      if (max === 1) mine.splice(0, 1);
      else { toast(`You've used all ${max} ${kind === "yes" ? "Yes" : "No"} votes. Tap one to take it back.`); return; }
    }
    mine.push(id);
    if (other.includes(id)) other.splice(other.indexOf(id), 1);
  }
  S.draft = d; S.draftDirty = true; S.saveState = "saving";
  render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await store.saveBallot(S.night.id, { name: S.name, yes: S.draft.yes, no: S.draft.no });
      S.saveState = "saved"; S.draftDirty = false;
    } catch (e) {
      S.saveState = "error";
      toast(nightOpen() ? "Couldn't save your vote. Check your connection." : "Voting has closed.");
    }
    refresh();
  }, 400);
}

// ---------- host
function tally() {
  const counts = {};
  const add = (id) => (counts[id] = counts[id] || { yes: 0, no: 0 });
  if (S.night && S.night.mode === "shortlist") (S.night.shortlist || []).forEach(add);
  S.ballots.forEach((b) => { (b.yes || []).forEach((id) => add(id).yes++); (b.no || []).forEach((id) => add(id).no++); });
  return Object.entries(counts).map(([id, c]) => ({ id, ...c, name: S.byId[id] ? S.byId[id].name : id }))
    .sort((a, b) => b.yes - a.yes || a.no - b.no || sortName(a.name).localeCompare(sortName(b.name)));
}

function viewHost() {
  const u = S.user;
  if (!u.uid || u.isAnonymous) {
    return `<h1>Host sign-in</h1><p>Sign in with the Google account that owns this site to run game nights and edit the collection.</p>
      <div class="btn-row"><button type="button" class="btn" data-action="signin">Sign in with Google</button></div>
      <p class="small muted">Guests don't need to sign in to browse or vote.</p>`;
  }
  if (!u.isOwner) {
    return `<h1>Not the host account</h1><p>You're signed in as ${esc(u.email || u.name)}, which isn't the owner of this site.</p>
      <div class="btn-row"><button type="button" class="btn quiet" data-action="signout">Sign out</button></div>`;
  }
  const n = S.night;
  let night;
  if (!n) {
    night = `<p>No game night is running.</p>
      <div class="btn-row"><a class="btn" href="#/host/shortlist">Start with a shortlist</a>
      <button type="button" class="btn quiet" data-action="night-all">Let everyone vote on anything</button></div>`;
  } else {
    const rows = tally();
    const played = n.played || [];
    const voters = S.ballots.map((b) => b.name || "Someone").sort((a, b) => a.localeCompare(b));
    night = `<p>${n.status === "open" ? "Voting is <strong>open</strong>" : "Voting is <strong>closed</strong>"}: ${n.mode === "all" ? "everyone can vote on the whole collection" : `${(n.shortlist || []).length} games on the shortlist`}.</p>
      <p>${voters.length ? `${voters.length} ${voters.length === 1 ? "person has" : "people have"} voted: ${voters.map(esc).join(", ")}.` : "Nobody has voted yet."}</p>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Game</th><th class="num">Yes</th><th class="num">No</th><th></th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td><a href="#/game/${esc(r.id)}">${esc(r.name)}</a></td><td class="num">${r.yes}</td><td class="num">${r.no}</td>
          <td class="num">${played.includes(r.id) ? `<span class="muted small">Played</span>` : `<button type="button" class="btn ghost" style="min-height:36px;padding:4px 10px" data-action="night-played" data-id="${esc(r.id)}">Mark as played</button>`}</td></tr>`).join("")}
      </tbody></table></div>` : ""}
      <div class="btn-row">
        ${n.status === "open" ? `<button type="button" class="btn" data-action="night-close">Close voting</button>` : `<button type="button" class="btn quiet" data-action="night-reopen">Reopen voting</button>`}
        ${n.mode === "shortlist" ? `<a class="btn quiet" href="#/host/shortlist">Edit the shortlist</a>` : ""}
        <button type="button" class="btn danger" data-action="night-end">Finish game night</button>
      </div>`;
  }
  const checks = S.games.filter((g) => S.priv[g.id] && S.priv[g.id].check);
  const leastPlayed = S.games.slice().sort((a, b) => ((S.priv[a.id] || {}).lastPlayed || "").localeCompare((S.priv[b.id] || {}).lastPlayed || "")).slice(0, 8);
  const hasPrivate = Object.keys(S.priv).some((k) => !k.startsWith("_"));
  return `<h1>Host tools</h1>
    <p class="small muted">Signed in as ${esc(u.email || u.name)}. <button type="button" class="btn ghost" style="min-height:32px;padding:2px 8px" data-action="signout">Sign out</button></p>
    <section class="panel owner"><h2>Game night</h2>${night}</section>
    <section class="panel"><h2>Collection data</h2>
      ${S.source === "live" ? `<p>The site is reading ${S.games.length} games from your database.</p>` : `<p class="notice warn">The site is showing the starter list. Import it so your edits are saved.</p>`}
      <div class="btn-row"><button type="button" class="btn ${S.source === "live" ? "quiet" : ""}" data-action="import-games">${S.source === "live" ? "Re-import the starter list" : "Import the starter list"}</button></div>
      <p class="small muted">Re-importing overwrites summaries and details you've edited.</p>
      <h3>Your private notes</h3>
      <p>${hasPrivate ? "Loaded: sleeves, inserts and last played are showing on each game page." : "Not imported yet. Choose the private-notes.json file Claude sent you."}</p>
      <label for="priv-file">Import private notes</label><input id="priv-file" type="file" accept="application/json,.json" data-change="import-private">
    </section>
    <section class="panel"><h2>Summary sheets</h2><p>A5 sheets for laminating, made from the details on this site.</p>
      <div class="btn-row"><a class="btn quiet" href="#/print">Make summary sheets</a></div></section>
    ${checks.length ? `<section class="panel"><h2>Games to check (${checks.length})</h2><p class="small muted">These summaries came from memory or I wasn't sure of the rules. Check them against the box and edit.</p>
      <ul>${checks.map((g) => `<li><a href="#/game/${esc(g.id)}">${esc(g.name)}</a> <span class="muted small">${esc(S.priv[g.id].check)}</span></li>`).join("")}</ul></section>` : ""}
    ${hasPrivate ? `<section class="panel"><h2>Longest since played</h2><ul>${leastPlayed.map((g) => `<li><a href="#/game/${esc(g.id)}">${esc(g.name)}</a> <span class="muted small">${(S.priv[g.id] || {}).lastPlayed || "never recorded"}</span></li>`).join("")}</ul></section>` : ""}`;
}

// ---------- shortlist builder
function viewBuilder() {
  if (!isOwner()) return viewHost();
  const n = S.night;
  const forNight = n && n.mode === "shortlist" ? n.id : null;
  if (!S.builder.ready || S.builder.forNight !== forNight) {
    S.builder = { selected: new Set(forNight ? n.shortlist || [] : []), forNight, ready: true };
  }
  const sel = S.builder.selected;
  const lists = Object.keys(S.shortlists).sort();
  resultsFn = () => {
    const list = filtered();
    return `<div class="toolbar"><span class="muted">${list.length} shown, ${sel.size} chosen</span>
        <span><button type="button" class="btn ghost" data-action="b-all">Choose all shown</button> <button type="button" class="btn ghost" data-action="b-none">Clear</button></span></div>
      <ul class="list">${list.map((g) => `<li><label class="check row" style="margin:0"><input type="checkbox" data-action="b-toggle" data-id="${esc(g.id)}" ${sel.has(g.id) ? "checked" : ""}>
        <span><span class="row-name">${esc(g.name)}</span>${factsLine(g)}</span></label></li>`).join("")}</ul>`;
  };
  const chosen = [...sel].map((id) => S.byId[id]).filter(Boolean).sort(byName);
  return `<a class="back" href="#/host">Back to host tools</a>
    <h1>${forNight ? "Edit tonight's shortlist" : "Build tonight's shortlist"}</h1>
    <section class="panel"><h2>Saved lists</h2>
      ${lists.length ? `<div class="btn-row"><select id="b-load" aria-label="Saved list">${lists.map((l) => `<option>${esc(l)}</option>`).join("")}</select>
        <button type="button" class="btn quiet" data-action="b-load">Load</button><button type="button" class="btn ghost" data-action="b-delete">Delete</button></div>` : `<p class="muted small">No saved lists yet. Save one below to reuse it, e.g. "Holiday bag".</p>`}
      <div class="btn-row"><input id="b-name" type="text" placeholder="Name this list" aria-label="List name" style="flex:1;min-width:160px">
        <button type="button" class="btn quiet" data-action="b-save" ${sel.size ? "" : "disabled"}>Save list</button></div>
    </section>
    <p><strong>Chosen (${chosen.length}):</strong> ${chosen.length ? chosen.map((g) => esc(g.name)).join(", ") : "none yet"}</p>
    <div class="btn-row"><button type="button" class="btn" data-action="b-go" ${sel.size ? "" : "disabled"}>${forNight ? "Update the shortlist" : `Open voting on ${sel.size} game${sel.size === 1 ? "" : "s"}`}</button></div>
    ${filtersBlock()}
    <div id="results">${resultsFn()}</div>`;
}

// ---------- print sheets
function sheet(g) {
  const best = bestText(g);
  return `<article class="sheet">
    <div class="sheet-brand">GAME NIGHT</div>
    <h1>${esc(g.name)}</h1>
    <div class="sheet-facts"><span>${playersText(g)}</span>${best ? `<span>Best with ${best}</span>` : ""}<span>${timeText(g)}</span><span>Age ${g.age}+</span><span>Complexity ${"🤔".repeat(g.complexity)}</span></div>
    ${g.summary ? `<p>${esc(g.summary)}</p>` : ""}
    ${(g.teach || []).length ? `<h2>How to play in a minute</h2><ol>${g.teach.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : ""}
    ${(g.expansions || []).length ? `<h2>Expansions in the box</h2><ul>${g.expansions.map((x) => `<li><strong>${esc(x.name)}</strong>${x.note ? ` — ${esc(x.note)}` : ""}</li>`).join("")}</ul>` : ""}
    ${g.shelf ? `<p class="sheet-foot">Lives on: ${esc(g.shelf)}</p>` : ""}
  </article>`;
}
function viewPrint() {
  const list = S.printMode === "filtered" ? filtered() : S.games;
  $print.innerHTML = list.map(sheet).join("");
  resultsFn = null;
  return `<a class="back" href="#/host">Back to host tools</a>
    <h1>Summary sheets</h1>
    <p>One A5 sheet per game. In your browser's print dialog choose A5 paper (or A4 with "2 pages per sheet") and turn off headers and footers.</p>
    <div class="chips" role="group" aria-label="Which games">
      <button type="button" class="chip" data-action="print-mode" data-v="all" aria-pressed="${S.printMode === "all"}">All ${S.games.length} games</button>
      <button type="button" class="chip" data-action="print-mode" data-v="filtered" aria-pressed="${S.printMode === "filtered"}">Only games matching the filters</button>
    </div>
    ${S.printMode === "filtered" ? filtersBlock() : ""}
    <div class="btn-row"><button type="button" class="btn" data-action="print" ${list.length ? "" : "disabled"}>Print ${list.length} sheet${list.length === 1 ? "" : "s"}</button></div>
    <h2>Preview</h2>
    <div class="preview-sheets">${list.slice(0, 3).map(sheet).join("")}</div>
    ${list.length > 3 ? `<p class="muted">Showing the first 3 of ${list.length}.</p>` : ""}`;
}

// ------------------------------------------------------------------ events
function setFilter(fn) { fn(S.filters); render(); }
const actions = {
  "f-players": (el) => setFilter((f) => { f.players = Number(el.dataset.v); if (!f.players) f.best = false; }),
  "f-best": (el) => setFilter((f) => { f.best = el.checked; }),
  "f-time": (el) => setFilter((f) => { f.time = Number(el.dataset.v); }),
  "f-cx": (el) => setFilter((f) => { const n = Number(el.dataset.v); f.cx = f.cx.includes(n) ? f.cx.filter((x) => x !== n) : [...f.cx, n]; }),
  "f-tag": (el) => setFilter((f) => { const t = el.dataset.v; f.tags = f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t]; }),
  "f-adults": (el) => setFilter((f) => { f.hideAdults = el.checked; }),
  "f-clear": () => setFilter((f) => { Object.assign(f, { q: "", players: 0, best: false, time: 0, cx: [], tags: [], hideAdults: false }); }),
  pick: () => {
    const list = filtered();
    if (!list.length) return;
    const g = list[Math.floor(Math.random() * list.length)];
    location.hash = `#/game/${g.id}?picked=${list.length}&r=${Date.now() % 100000}`;
  },
  "vote-yes": (el) => toggleVote(el.dataset.id, "yes"),
  "vote-no": (el) => toggleVote(el.dataset.id, "no"),
  "name-save": async () => {
    const i = document.getElementById("voter-name");
    const v = (i ? i.value : "").trim().slice(0, 30);
    if (!v) { toast("Type your first name."); return; }
    S.name = v; S.editingName = false; writeLocal("gn-name", v);
    if (S.night && nightOpen() && S.user.uid && (S.draft.yes.length || S.draft.no.length || S.myBallot)) {
      try { await store.saveBallot(S.night.id, { name: v, yes: S.draft.yes, no: S.draft.no }); } catch (e) { /* shown on next vote */ }
    }
    render();
  },
  "name-edit": () => { S.editingName = true; render(); const i = document.getElementById("voter-name"); if (i) i.focus(); },
  signin: async () => {
    try { await store.signInOwner(); } catch (e) {
      toast(e && e.code === "auth/unauthorized-domain" ? "This web address isn't authorised in Firebase yet (Authentication → Settings → Authorized domains)." : "Sign-in didn't complete. Try again.");
    }
  },
  signout: async () => { await store.signOutOwner(); location.hash = "#/"; },
  edit: (el) => { S.editing = el.dataset.id; render(); },
  "edit-cancel": () => { S.editing = null; render(); },
  "edit-save": async (el) => {
    const id = el.dataset.id, f = document.getElementById("edit-form");
    const val = (n) => f.elements[n].value;
    const num = (n, d) => { const x = parseInt(val(n), 10); return Number.isFinite(x) ? x : d; };
    const g = S.byId[id];
    const pmin = num("pmin", g.players[0]), pmax = Math.max(pmin, num("pmax", g.players[1]));
    const tmin = num("tmin", g.time[0]), tmax = Math.max(tmin, num("tmax", g.time[1]));
    const fields = {
      name: val("name").trim() || g.name,
      summary: val("summary").trim(),
      teach: val("teach").split("\n").map((s) => s.trim()).filter(Boolean),
      players: [pmin, pmax], time: [tmin, tmax],
      best: val("best").split(/[^0-9]+/).map(Number).filter((x) => x > 0),
      age: num("age", g.age),
      complexity: Number(val("complexity")),
      tags: [...f.querySelectorAll('input[name="tag"]:checked')].map((x) => x.value),
      adults: f.elements.adults.checked,
      expansions: val("expansions").split("\n").map((s) => s.trim()).filter(Boolean).map((line) => {
        const i = line.indexOf(":");
        return i > 0 ? { name: line.slice(0, i).trim(), note: line.slice(i + 1).trim() } : { name: line, note: "" };
      }),
      shelf: val("shelf").trim(),
    };
    try {
      await store.saveGame(id, fields);
      Object.assign(g, fields); setGames(S.games, S.source);
      S.editing = null; toast("Changes saved."); render();
    } catch (e) { toast("Couldn't save. Check you're signed in as the host."); }
  },
  played: async (el) => {
    const id = el.dataset.id;
    try {
      const day = await store.markPlayed(id);
      const p = S.priv[id] = S.priv[id] || {};
      p.lastPlayed = day; p.plays = (p.plays || 0) + 1;
      toast("Marked as played today."); render();
    } catch (e) { toast("Couldn't save. Check you're signed in as the host."); }
  },
  "notes-save": async (el) => {
    const id = el.dataset.id, t = document.getElementById("p-notes");
    try { await store.savePrivate(id, { notes: t.value }); (S.priv[id] = S.priv[id] || {}).notes = t.value; toast("Notes saved."); }
    catch (e) { toast("Couldn't save notes."); }
  },
  "night-all": async () => {
    try { await store.startNight({ mode: "all", shortlist: [] }); toast("Voting is open on the whole collection."); }
    catch (e) { toast("Couldn't start the game night. Check the database rules are published."); }
  },
  "night-close": async () => { await store.updateNight(S.night.id, { status: "closed" }); toast("Voting closed."); },
  "night-reopen": async () => { await store.updateNight(S.night.id, { status: "open" }); toast("Voting reopened."); },
  "night-end": async () => {
    if (!confirm("Finish this game night? Guests will go back to the collection.")) return;
    await store.endNight(); S.builder.ready = false; toast("Game night finished.");
  },
  "night-played": async (el) => {
    const id = el.dataset.id;
    try {
      const day = await store.markPlayed(id);
      const p = S.priv[id] = S.priv[id] || {}; p.lastPlayed = day; p.plays = (p.plays || 0) + 1;
      await store.updateNight(S.night.id, { played: [...(S.night.played || []), id] });
      toast(`${S.byId[id] ? S.byId[id].name : "Game"} marked as played.`);
    } catch (e) { toast("Couldn't save. Try again."); }
  },
  "import-games": async () => {
    if (S.source === "live" && !confirm("Re-import the starter list? This overwrites summaries and details you've edited.")) return;
    try {
      const games = await store.loadStarterGames();
      await store.importGames(games);
      const r = await store.loadGames(); setGames(r.games, r.source);
      toast(`Imported ${games.length} games.`); render();
    } catch (e) { toast("Import failed. Check the database rules are published and you're signed in as the host."); }
  },
  "b-toggle": (el) => { const s = S.builder.selected; el.checked ? s.add(el.dataset.id) : s.delete(el.dataset.id); render(); },
  "b-all": () => { filtered().forEach((g) => S.builder.selected.add(g.id)); render(); },
  "b-none": () => { S.builder.selected.clear(); render(); },
  "b-load": () => { const n = document.getElementById("b-load").value; S.builder.selected = new Set(S.shortlists[n] || []); render(); },
  "b-delete": async () => {
    const n = document.getElementById("b-load").value;
    if (!confirm(`Delete the saved list "${n}"?`)) return;
    const lists = { ...S.shortlists }; delete lists[n];
    await store.saveShortlists(lists); S.shortlists = lists; render();
  },
  "b-save": async () => {
    const name = document.getElementById("b-name").value.trim();
    if (!name) { toast("Give the list a name first."); return; }
    const lists = { ...S.shortlists, [name]: [...S.builder.selected] };
    try { await store.saveShortlists(lists); S.shortlists = lists; toast(`Saved "${name}".`); render(); }
    catch (e) { toast("Couldn't save the list."); }
  },
  "b-go": async () => {
    const ids = [...S.builder.selected];
    try {
      if (S.builder.forNight) { await store.updateNight(S.builder.forNight, { shortlist: ids }); toast("Shortlist updated."); }
      else { await store.startNight({ mode: "shortlist", shortlist: ids }); toast("Voting is open."); }
      S.builder.ready = false; location.hash = "#/host";
    } catch (e) { toast("Couldn't save. Check the database rules are published."); }
  },
  "print-mode": (el) => { S.printMode = el.dataset.v; render(); },
  print: () => { window.print(); },
};

$app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || !$app.contains(el)) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  if (el.tagName === "BUTTON") e.preventDefault();
  fn(el, e);
});
$app.addEventListener("input", (e) => {
  if (e.target.dataset.input === "q") {
    S.filters.q = e.target.value;
    const r = document.getElementById("results");
    if (r && resultsFn) r.innerHTML = resultsFn();
  }
});
$app.addEventListener("change", async (e) => {
  if (e.target.dataset.change !== "import-private") return;
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data.private !== "object") throw new Error("bad file");
    await store.importPrivate(data.private);
    S.priv = await store.loadPrivate();
    toast(`Imported private notes for ${Object.keys(data.private).length} games.`); render();
  } catch (err) { toast("That file couldn't be imported. Choose private-notes.json."); }
});
$app.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "voter-name") { e.preventDefault(); actions["name-save"](); }
});
$app.addEventListener("toggle", (e) => {
  if (e.target.matches && e.target.matches("details.filters")) {
    S.filtersOpen = e.target.open;
    const hint = e.target.querySelector("summary .muted");
    if (hint) hint.textContent = S.filtersOpen ? "Hide" : "Show";
  }
}, true);
window.addEventListener("hashchange", () => { S.editing = null; render(); window.scrollTo(0, 0); });
