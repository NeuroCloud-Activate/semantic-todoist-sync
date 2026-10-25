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
const idOrName = (id, name) => {
  if (id != null && String(id) !== "") return "id:" + String(id);
  const n = String(name || "").trim().toLowerCase();
  return n ? "name:" + n : "";
};
const projectOf = (t) => idOrName(t.projectId, t.projectName);
const sectionOf = (t) => idOrName(t.sectionId, t.sectionName || t.section);
const parentOf = (t) => (t.parentId != null && String(t.parentId) !== "" ? String(t.parentId) : "");
function dueOf(t) {
  const d = t.dueDate || (t.due && typeof t.due === "object" ? t.due.date || t.due.string : t.due) || t.due_date || "";
  return d ? "d:" + String(d).slice(0, 10) : "";
}
// Real tasks carry boolean `isRecurring`; a `due` object is the fallback. Anything else is unknown (null).
function recurringOf(t) {
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
  const ida = String(a.id), idb = String(b.id), pa = parentOf(a), pb = parentOf(b);
  if (pa === idb || pb === ida) return "parent-child";
  if (pa && pb && pa !== pb) return "sibling-subtasks-of-different-parents";
  const ta = canon(a.content), tb = canon(b.content);
  if (projectOf(a) !== projectOf(b) && ta !== tb) return "different-projects";
  const ra = recurringOf(a), rb = recurringOf(b);
  if (ra === null || rb === null) return "recurring-unknown"; // precision first: unknown means do not suggest
  if (ra !== rb) return "recurring-mismatch";
  if (words(a.content).length <= 3 || words(b.content).length <= 3) {
    const full = ta !== "" && ta === tb && projectOf(a) === projectOf(b) && sectionOf(a) === sectionOf(b)
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
    && judgments.every((j) => j && j.verdict === "duplicate" && typeof j.confidence === "number" && typeof j.confidence === "number" && j.confidence >= minConfidence);
}

function dedupeAllowed(settings) {
  const s = settings || {};
  if (s.todoistDuplicateFindingValidated !== true) return { ok: false, reason: "not validated" };
  if (s.todoistDuplicateFinding !== true) return { ok: false, reason: "Duplicate finding is switched off" };
  if (!CALIBRATED_EMBEDDING_MODELS.includes(s.embeddingModel)) {
    return { ok: false, reason: `Duplicate finding needs a calibrated embedding model (${CALIBRATED_EMBEDDING_MODELS.join(", ")})` };
  }
  return { ok: true, reason: "" };
}

module.exports = { ruleGate, dedupeCandidates, confirmPair, dedupeAllowed, STRICT_JUDGE_PROMPT, CALIBRATED_EMBEDDING_MODELS };
