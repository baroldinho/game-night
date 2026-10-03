// The master spreadsheet: one row per game on a "Games" tab and one row per
// expansion on an "Expansions" tab. The same layout is used for downloading
// the collection and for uploading an edited copy.

export const TAGS = ["Strategy", "Party", "Family", "Thematic", "Co-op", "Bluffing", "Campaign", "Deduction", "Word & trivia", "Dexterity"];
export const COLS = ["ID", "Name", "Status", "BGG ID", "Players min", "Players max", "Best with", "Time min", "Time max", "Age", "BGG weight", "Complexity",
  ...TAGS, "Adults only", "Summary", "Teach 1", "Teach 2", "Teach 3", "Teach 4", "Similar 1", "Similar 2", "Similar 3", "Suggested now",
  "Shelf", "Picture link", "Teaching confidence", "Check note"];

let lib = null;
async function xlsx() { if (!lib) lib = await import("./xlsx-bundle.js"); return lib; }

export const slugify = (s) => String(s).toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const norm = (s) => String(s ?? "").trim().toLowerCase();
const text = (v) => (v === undefined || v === null ? "" : String(v).trim());
const yes = (v) => /^(y|yes|true|1|x|✓)$/i.test(text(v));
const num = (v) => { const n = Number(text(v)); return Number.isFinite(n) ? n : NaN; };

export async function download(games, priv, suggest) {
  const X = await xlsx();
  const byId = Object.fromEntries(games.map((g) => [g.id, g]));
  const rows = games.map((g) => {
    const r = {
      "ID": g.id, "Name": g.name, "Status": g.status === "Pre-order" ? "Pre-order" : "Owned", "BGG ID": g.bggId || "",
      "Players min": g.players[0], "Players max": g.players[1], "Best with": (g.best || []).join(", "),
      "Time min": g.time[0], "Time max": g.time[1], "Age": g.age, "BGG weight": g.weight || "", "Complexity": g.complexity,
      "Adults only": g.adults ? "Yes" : "No", "Summary": g.summary || "",
      "Suggested now": suggest(g).map((o) => o.name).join(" · "),
      "Shelf": g.shelf || "", "Picture link": g.cover || "",
      "Teaching confidence": g.teachConfidence ?? "", "Check note": (priv[g.id] || {}).check || "",
    };
    TAGS.forEach((t) => { r[t] = (g.tags || []).includes(t) ? "Yes" : ""; });
    [0, 1, 2, 3].forEach((i) => { r[`Teach ${i + 1}`] = (g.teach || [])[i] || ""; });
    [0, 1, 2].forEach((i) => { const s = byId[(g.similar || [])[i]]; r[`Similar ${i + 1}`] = s ? s.name : ""; });
    return r;
  });
  const exp = [];
  games.forEach((g) => (g.expansions || []).forEach((e) => exp.push({ Game: g.name, Expansion: e.name, Note: e.note || "" })));
  const wb = X.utils.book_new();
  const ws = X.utils.json_to_sheet(rows, { header: COLS });
  ws["!cols"] = COLS.map((c) => ({ wch: { Name: 30, Summary: 60, "Teach 1": 45, "Teach 2": 45, "Teach 3": 45, "Suggested now": 40, "Check note": 40 }[c] || 10 }));
  X.utils.book_append_sheet(wb, ws, "Games");
  const es = X.utils.json_to_sheet(exp, { header: ["Game", "Expansion", "Note"] });
  es["!cols"] = [{ wch: 40 }, { wch: 30 }, { wch: 80 }];
  X.utils.book_append_sheet(wb, es, "Expansions");
  X.writeFile(wb, `Game Night master list ${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Reads an uploaded workbook. Returns { games, checks, errors, warnings }:
// games are full public records keyed by id, checks are the private check notes.
export async function parse(file) {
  const X = await xlsx();
  const wb = X.read(await file.arrayBuffer(), { type: "array" });
  const errors = [], warnings = [];
  const gs = wb.Sheets.Games;
  if (!gs) return { errors: ["There's no Games tab in that file."], warnings, games: [], checks: {} };
  const raw = X.utils.sheet_to_json(gs, { defval: "" });
  if (raw.length && !("Name" in raw[0])) errors.push("The Games tab is missing its Name column. Keep the header row as it was.");
  const games = [], checks = {}, confidence = {}, ids = new Set(), simNames = {};
  raw.forEach((r, i) => {
    const line = i + 2;
    const name = text(r.Name);
    if (!name) { if (Object.values(r).some((v) => text(v))) warnings.push(`Row ${line} has no name, so it was skipped.`); return; }
    let id = text(r.ID) || slugify(name);
    if (ids.has(id)) { if (text(r.ID)) { errors.push(`Row ${line}: the ID "${id}" is used twice.`); return; } let n = 2; while (ids.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
    ids.add(id);
    const pmin = num(r["Players min"]), pmax = num(r["Players max"]), tmin = num(r["Time min"]), tmax = num(r["Time max"]);
    const cx = num(r.Complexity), age = num(r.Age);
    const bad = (label) => errors.push(`Row ${line} (${name}): ${label}`);
    if (!(pmin >= 1) || !(pmax >= pmin)) bad("players need a min and a max, e.g. 2 and 4.");
    if (!(tmax >= 1)) bad("time needs at least a Time max in minutes.");
    if (![1, 2, 3, 4, 5].includes(cx)) bad("complexity must be 1 to 5.");
    const g = {
      id, name, status: norm(r.Status).startsWith("pre") ? "Pre-order" : "Owned",
      bggId: num(r["BGG ID"]) > 0 ? num(r["BGG ID"]) : null,
      players: [pmin, pmax], best: text(r["Best with"]).split(/[^0-9]+/).map(Number).filter((x) => x > 0),
      time: [tmin > 0 ? tmin : tmax, tmax], age: age > 0 ? age : 0,
      weight: num(r["BGG weight"]) > 0 ? num(r["BGG weight"]) : 0, complexity: cx,
      tags: TAGS.filter((t) => yes(r[t])), adults: yes(r["Adults only"]),
      summary: text(r.Summary), teach: [1, 2, 3, 4].map((n) => text(r[`Teach ${n}`])).filter(Boolean),
      expansions: [], similar: [], shelf: text(r.Shelf), cover: text(r["Picture link"]),
    };
    simNames[id] = [1, 2, 3].map((n) => text(r[`Similar ${n}`])).filter(Boolean);
    const tc = text(r["Teaching confidence"]);
    if (tc !== "") { const v = num(tc); if ([0, 1, 2, 3, 4, 5].includes(v)) confidence[id] = v; else bad("teaching confidence must be 0 to 5."); }
    checks[id] = text(r["Check note"]);
    games.push(g);
  });
  const byName = Object.fromEntries(games.map((g) => [norm(g.name), g]));
  games.forEach((g) => {
    g.similar = simNames[g.id].map((n) => { const o = byName[norm(n)]; if (!o) warnings.push(`${g.name}: couldn't find "${n}" for Similar, so it was left out.`); return o && o.id !== g.id ? o.id : null; }).filter(Boolean);
    if (confidence[g.id] !== undefined) g.teachConfidence = confidence[g.id];
  });
  const es = wb.Sheets.Expansions;
  if (es) {
    X.utils.sheet_to_json(es, { defval: "" }).forEach((r, i) => {
      const game = text(r.Game), name = text(r.Expansion);
      if (!game && !name) return;
      const g = byName[norm(game)];
      if (!g) { warnings.push(`Expansions row ${i + 2}: no game called "${game}", so it was left out.`); return; }
      if (!name) return;
      g.expansions.push({ name, note: text(r.Note) });
    });
  }
  return { games, checks, errors, warnings };
}
