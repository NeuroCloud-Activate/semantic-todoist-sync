"use strict";
// Precision-first duplicate gate (Task 10). Ported from the scored e-precise gate.js / strict-judge.js arms.
const CALIBRATED_EMBEDDING_MODELS = ["embeddinggemma-2"];
const DEFAULT_COSINE_MIN = 0.96; // measured 0-wrong cut-off for embeddinggemma-2

const STRICT_JUDGE_PROMPT =
  "You judge whether two todo tasks describe the SAME single action on the SAME object for the SAME people, " +
  "so that completing one would make the other pointless. Precision matters far more than recall: " +
  "when in doubt, answer \"not-duplicate\".\n" +
  "For each pair answer \"duplicate\", \"unsure\" or \"not-duplicate\".\n" +
  "Answer \"duplicate\" ONLY when both tasks describe the SAME single action on the SAME object for the SAME people.\n" +
  "Explicitly NOT duplicates:\n" +
  "- a task and its own subtask, or a parent task and its child;\n" +
  "- different steps of one thread or workflow (ask vs confirm vs send vs review vs schedule vs pay vs file);\n" +
  "- the same kind of action for different people, objects, accounts, or dates;\n" +
  "- a follow-up/reminder task vs the task it follows up on;\n" +
  "- a recurring series vs a one-off instance, or two tasks in different projects with different scopes.\n" +
  "Give confidence 0-1: 1.0 only when the two tasks unmistakably describe an identical action.";

// Mirrors main.js canonicalTaskMatchTitle.
function canon(v) {
  return String(v == null ? "" : v).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/%%\[oid::\s*[^\]]+\]%%/gi, " ")
    .replace(/#[\w/-]+/g, " ")
    .replace(/[:;][a-z_]+/gi, " ")
    .replace(/\b(?:due|deadline|priority|section|project)[:=]\s*\S+/gi, " ")
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, " ")
    .replace(/[^a-z0-9]+/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
const words = (s) => { const c = canon(s); return c ? c.split(" ") : []; };
const same = (ia, ib, na, nb) => (ia != null && String(ia) !== "" && ib != null && String(ib) !== "" ? String(ia) === String(ib) : String(na || "").trim().toLowerCase() === String(nb || "").trim().toLowerCase());
const sameProject = (a, b) => same(a.projectId, b.projectId, a.projectName, b.projectName);
const sameSection = (a, b) => same(a.sectionId, b.sectionId, a.sectionName || a.section, b.sectionName || b.section);
const parentOf = (t) => (t.parentId != null && String(t.parentId) !== "" ? String(t.parentId) : "");
function dueOf(t) {
  const d = t.dueDate || (t.due && typeof t.due === "object" ? t.due.date || t.due.string : t.due) || t.due_date || "";
  return d ? "d:" + String(d).slice(0, 10) : "";
}
// Real tasks carry boolean `isRecurring`; a `due` object is the fallback. Anything else is unknown (null).
function recurringOf(t) {
  if (t.isRecurring == null && !t.due && !t.dueDate && !t.due_date) return false; // no due at all = one-off
  if (typeof t.isRecurring === "boolean") return t.isRecurring;
  const due = t.due;
  if (due && typeof due === "object") {
    if (typeof due.isRecurring === "boolean") return due.isRecurring;
    if (typeof due.is_recurring === "boolean") return due.is_recurring;
  }
  return null;
}

// -> null when the pair may go on to the judge, else the reason it is rejected.
function ruleGate(a, b) {
  const ida = a.id == null ? "" : String(a.id), idb = b.id == null ? "" : String(b.id), pa = parentOf(a), pb = parentOf(b);
  if ((idb && pa === idb) || (ida && pb === ida)) return "parent-child";
  if (pa && pb && pa !== pb) return "sibling-subtasks-of-different-parents";
  const ta = canon(a.content), tb = canon(b.content);
  if (!sameProject(a, b) && ta !== tb) return "different-projects";
  const ra = recurringOf(a), rb = recurringOf(b);
  if (ra === null || rb === null) return "recurring-unknown"; // precision first: unknown means do not suggest
  if (ra !== rb) return "recurring-mismatch";
  if (words(a.content).length <= 3 || words(b.content).length <= 3) {
    const full = ta !== "" && ta === tb && sameProject(a, b) && sameSection(a, b)
      && dueOf(a) === dueOf(b) && pa === pb;
    if (!full) return "short-title";
  }
  return null;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  if (a.length !== b.length) return 0;
  const n = a.length;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// vectors: { [taskId]: number[] }. Tasks without a vector are listed in `missing`, never skipped silently.
function dedupeCandidates(tasks, vectors, { cosineMin = DEFAULT_COSINE_MIN } = {}) {
  const v = vectors || {};
  const missing = tasks.filter((t) => !v[String(t.id)]).map((t) => String(t.id));
  const have = tasks.filter((t) => v[String(t.id)]);
  const pairs = [];
  for (let i = 0; i < have.length; i++) {
    for (let j = i + 1; j < have.length; j++) {
      const a = have[i], b = have[j];
      if (String(a.id) === String(b.id)) continue;
      const c = cosine(v[String(a.id)], v[String(b.id)]);
      if (c < cosineMin || ruleGate(a, b)) continue;
      pairs.push({ pairId: `${a.id}:${b.id}`, aId: String(a.id), bId: String(b.id), cosine: c });
    }
  }
  return { pairs, missing };
}

// judgments: one {verdict, confidence} per judge run; every one must say duplicate at >= minConfidence.
function confirmPair(judgments, { minConfidence = 0.8 } = {}) {
  return Array.isArray(judgments) && judgments.length > 0
    && judgments.every((j) => j && j.verdict === "duplicate" && typeof j.confidence === "number" && j.confidence >= minConfidence);
}

const DUPLICATE_BOX_MIN = 0.90;
const NEAR_IDENTICAL_MIN = 0.98;
const STRICT_VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["duplicate", "unsure", "not-duplicate"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" },
  },
  required: ["verdict", "confidence", "reason"],
  additionalProperties: false,
};// Missing/failed/timeout results box too (precision comes from the user's answer); verdict only, confidence ignored.
const boxesOnVerdict = (result) => !(result && result.verdict === "not-duplicate");

// Generic key-token veto: a number/code, ALL-CAPS program or capitalised person name in one title only.
function keyTokenSets(content) {
  const text = String(content == null ? "" : content), nums = new Set(), progs = new Set(), names = new Set(), all = new Set();
  let prevEnd = 0, first = true;
  for (const m of text.matchAll(/[A-Za-z0-9][A-Za-z0-9']*/g)) {
    const raw = m[0].replace(/['’]s$/i, "").replace(/'+$/, "");
    const lower = raw.toLowerCase(), sentenceStart = first || /[.!?]\s*$/.test(text.slice(prevEnd, m.index));
    all.add(lower);
    if (/\d/.test(raw)) nums.add(lower);
    else if (/^[A-Z]{2,}$/.test(raw)) progs.add(lower);
    else if (!sentenceStart && /^[A-Z][a-z]{2,}$/.test(raw)) names.add(lower);
    first = false; prevEnd = m.index + m[0].length;
  }
  return { nums, progs, names, all };
}
function vetoKeyTokens(a, b) {
  const ka = keyTokenSets(a && a.content), kb = keyTokenSets(b && b.content);
  const only = (k, o, key, other) => [...k[key]].filter((w) => !o[other].has(w)).length;
  // Numbers: one-sided token vetoes. Codes and names: only a substitution (one-sided on BOTH titles); an added or omitted one is not a different object.
  if (only(ka, kb, "nums", "nums") || only(kb, ka, "nums", "nums")) return "differs on number/code/date";
  if (only(ka, kb, "progs", "progs") && only(kb, ka, "progs", "progs")) return "differs on program code";
  const na = only(ka, kb, "names", "all"), nb = only(kb, ka, "names", "all");
  if ((na && nb) || na > 1 || nb > 1) return "differs on person name"; // two or more named people in one title only is a different audience
  return null;
}

// candidates: [{ task, vec }] (plan-task shape). Highest score wins; ties keep first.
function bestDuplicateCandidate(task, vec, candidates, { min = DUPLICATE_BOX_MIN } = {}) {
  if (!Array.isArray(vec)) return null;
  const asGate = (t) => ({ ...t, dueDate: t.dueDate || t.due_date || "" });
  const ours = { ...asGate(task), isRecurring: typeof task.isRecurring === "boolean" ? task.isRecurring : false }, // a new plan task has no recurrence flag: one-off
   idOf = (t) => (t.id == null ? "" : String(t.id)), oidOf = (t) => (t.oid == null ? "" : String(t.oid));
  let best = null;
  for (const c of candidates || []) {
    const t = c && c.task;
    if (!t || !Array.isArray(c.vec) || c.vec.length !== vec.length) continue;
    if ((idOf(t) && idOf(t) === idOf(task)) || (oidOf(t) && oidOf(t) === oidOf(task))) continue;
    if (ruleGate(ours, asGate(t)) || vetoKeyTokens(task, t)) continue;
    const score = cosine(vec, c.vec);
    if (score >= min && (!best || score > best.score)) best = { candidate: t, score };
  }
  if (!best) return null;
  const t = best.candidate;
  const nearIdentical = best.score >= NEAR_IDENTICAL_MIN && sameProject(task, t) && sameSection(task, t) && parentOf(task) === parentOf(t);
  return { candidate: t, score: best.score, nearIdentical };
}

const SOURCE_HEADER = /^\s*(\*\*)?(sources?|source list|context notes?|email source)(\*\*)?\s*:/i;
const headerKind = (l) => { const m = SOURCE_HEADER.exec(l); return m ? (/context/i.test(m[2]) ? "context" : /email/i.test(m[2]) ? "email" : "sources") : ""; };
const flat = (s) => String(s || "").replace(/\s+/g, " ").trim();
const datePart = (s) => String(s || "").slice(0, 10);
const PREFIX = /^(\s*)(?:(\d+)([.)])|([-*+]))\s+/;
// Normalised target of a note entry: link target or text, without number/bullet, .md or URL-encoding.
function entryKey(line) {
  let t = line.replace(PREFIX, "").trim();
  const m = /\]\(([^)]+)\)/.exec(t) || /\[\[([^\]|]+)/.exec(t);
  if (m) t = m[1];
  try { t = decodeURIComponent(t); } catch { /* keep raw */ }
  return t.trim().replace(/\.md$/i, "").toLowerCase();
}
// Entries of one section body: note kinds are one per line, email entries are From/Subject/... groups.
function sectionEntries(kind, lines) {
  const out = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    if (kind !== "email") { out.push([l]); continue; }
    const cur = out[out.length - 1], key = /^\s*(from|subject)\s*:/i.exec(l);
    if (!cur || (key && cur.some((x) => new RegExp("^\\s*" + key[1] + "\\s*:", "i").test(x)))) out.push([l]);
    else cur.push(l);
  }
  return out;
}
const emailKey = (g) => {
  const f = (n) => (g.map((l) => new RegExp("^\\s*" + n + "\\s*:\\s*(.*)$", "i").exec(l)).find(Boolean) || [, ""])[1].trim().toLowerCase();
  return "email:" + f("subject") + "|" + f("from");
};
const keyOf = (kind, g) => (kind === "email" ? emailKey(g) : entryKey(g[0]));
function parseDescription(description) {
  const lines = String(description || "").split(/\r?\n/), i = lines.findIndex((l) => SOURCE_HEADER.test(l));
  const summary = (i < 0 ? lines : lines.slice(0, i)).join("\n").trim(), sections = [];
  if (i >= 0) for (const l of lines.slice(i)) {
    const kind = headerKind(l);
    if (kind) sections.push({ kind, lines: [l], body: [] }); else { const s = sections[sections.length - 1]; s.lines.push(l); s.body.push(l); }
  }
  return { summary, sections };
}
function mergeSources(a, b) {
  const seen = new Set();
  for (const s of a.sections) for (const g of sectionEntries(s.kind, s.body)) seen.add(s.kind === "email" ? keyOf("email", g) : keyOf("note", g));
  const out = a.sections.map((s) => ({ ...s, lines: [...s.lines] })), fresh = [];
  for (const s of b.sections) {
    const add = sectionEntries(s.kind, s.body).filter((g) => { const k = keyOf(s.kind, g); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!add.length) continue;
    const tgt = out.find((x) => x.kind === s.kind) || fresh.find((x) => x.kind === s.kind);
    if (!tgt) { fresh.push({ kind: s.kind, lines: [s.lines[0], ...renumber(s.kind, add, 1)] }); continue; }
    let last = tgt.lines.length - 1;
    while (last > 0 && !tgt.lines[last].trim()) last--;
    const prev = tgt.lines.slice(1, last + 1).reverse().find((l) => PREFIX.test(l)), pm = prev && PREFIX.exec(prev);
    const lines = s.kind === "email" || !pm ? add.flat() : add.map((g, n) => (pm[2] ? `${pm[1]}${+pm[2] + n + 1}${pm[3]} ` : `${pm[1]}${pm[4]} `) + g[0].replace(PREFIX, ""));
    tgt.lines.splice(last + 1, 0, ...lines);
  }
  return [out.map((s) => s.lines.join("\n")).join("\n").trimEnd(), ...fresh.map((s) => s.lines.join("\n"))].filter(Boolean).join("\n\n");
}
function renumber(kind, add, from) {
  if (kind === "email") return add.flat();
  return add.map((g, n) => { const m = PREFIX.exec(g[0]); return m && m[2] ? `${m[1]}${from + n}${m[3]} ${g[0].replace(PREFIX, "")}` : g[0]; });
}
// Reason = first sentence, original case; no split after short abbreviations.
const ABBR = /(?:^|[\s(])(?:Dr|Mr|Mrs|Ms|St|e\.g|i\.e)\.$/;
function firstSentence(text) {
  const re = /[.!?]+\s+(?=[A-Z])/g;
  let m;
  while ((m = re.exec(text))) if (!ABBR.test(text.slice(0, m.index + m[0].trimEnd().length))) return text.slice(0, m.index + m[0].trimEnd().length);
  return text;
}
// shortcut: wording is a deterministic template (no AI call), upgrade when users want richer explanations.
function mergeDuplicateIntoExisting(existing, incoming, { sourceName = "", today } = {}) {
  const ex = existing || {}, inc = incoming || {};
  const labels = [...(ex.labels || [])];
  for (const l of inc.labels || []) if (!labels.some((x) => String(x).toLowerCase() === String(l).toLowerCase())) labels.push(l);
  const changes = [], pri = (p) => `P${5 - p}`;
  const pick = (label, key) => {
    const was = ex[key] || "", now = inc[key] || "";
    if (now && datePart(now) !== datePart(was)) { changes.push({ field: label, from: datePart(was), to: datePart(now) }); return now; }
    return was;
  };
  const due_date = pick("due date", "due_date"), deadline_date = pick("deadline", "deadline_date");
  let priority = ex.priority;
  if (inc.priority > 1 && inc.priority !== ex.priority) {
    changes.push({ field: "priority", from: pri(ex.priority || 1), to: pri(inc.priority) });
    priority = inc.priority;
  }
  const a = parseDescription(ex.description), b = parseDescription(inc.description);
  let sentence;
  if (changes.length) {
    const parts = changes.map((c) => {
      if (c.field === "priority") return `priority ${inc.priority > (ex.priority || 1) ? "rose" : "dropped"} from ${c.from} to ${c.to}`;
      const f = c.field === "due date" ? "the due date" : c.field;
      return c.from ? `${f} moved from ${c.from} to ${c.to}` : `${f} set to ${c.to}`;
    });
    const text = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
    let reason = firstSentence(flat(b.summary)).replace(/\s*(?:\(\d+\)|\[\d+\]|\[\^\d+\])/g, "").replace(/(\*\*|__|[*`])/g, "").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
    if (reason.length > 100) reason = reason.slice(0, 100).replace(/\s+\S*$/, "").trimEnd() + "…";
    const src = flat(sourceName) || (reason ? "the new task" : "");
    sentence = `On ${today} ${text}${src ? `, per ${src}` : ""}${reason ? `: "${reason}"` : ""}.`;
  }
  const paragraphs = [a.summary], fa = flat(a.summary), fb = flat(b.summary);
  if (fb && !flat(ex.description).includes(fb)) {
    if (fa && fb.startsWith(fa) && (/\W$/.test(fa) || /^\s/.test(fb.slice(fa.length)))) paragraphs.push(fb.slice(fa.length).trim());
    else paragraphs.push(b.summary);
  }
  if (sentence) paragraphs.push(sentence);
  const block = mergeSources(a, b);
  const description = [...paragraphs.filter(Boolean), block].filter(Boolean).join("\n\n");
  return { content: ex.content, description, labels, priority, due_date, deadline_date, changes, sentence };
}
module.exports = { vetoKeyTokens, bestDuplicateCandidate, boxesOnVerdict, mergeDuplicateIntoExisting, STRICT_VERDICT_SCHEMA, DUPLICATE_BOX_MIN, NEAR_IDENTICAL_MIN, recurringOf, ruleGate, dedupeCandidates, confirmPair, STRICT_JUDGE_PROMPT, CALIBRATED_EMBEDDING_MODELS };


