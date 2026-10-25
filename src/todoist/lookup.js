"use strict";
// Look-up step (Task 4): schema + prompt for the fast model, and a cheap local task shortlist.
// v1 shortlist = explicit filters, then word overlap on title + description (no embeddings).

const LOOKUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["needsTodoist", "kind", "filters", "refersToLastAnswer"],
  properties: {
    needsTodoist: { type: "boolean" },
    kind: { type: "string", enum: ["none", "question", "change", "duplicates"] },
    filters: {
      type: "object",
      additionalProperties: false,
      required: ["words", "projects", "labels", "dueFrom", "dueTo", "priority", "includeCompleted"],
      properties: {
        words: { type: "array", items: { type: "string" } },
        projects: { type: "array", items: { type: "string" } },
        labels: { type: "array", items: { type: "string" } },
        dueFrom: { type: ["string", "null"] },
        dueTo: { type: ["string", "null"] },
        priority: { type: ["integer", "null"] },
        includeCompleted: { type: ["boolean", "null"] }
      }
    },
    refersToLastAnswer: { type: "boolean" }
  }
};

function lookupPrompt(prompt, historyText) {
  const system = [
    "You classify a chat message for a Todoist-aware assistant. Reply with JSON only, matching the schema. Keep it short.",
    "needsTodoist=false (kind \"none\") when the message is only about vault notes, writing or general chat.",
    "needsTodoist=true when it asks about, changes, or looks for duplicates among the user's Todoist tasks, projects, sections or labels.",
    "kind: \"question\" = asks about tasks; \"change\" = asks to create/edit/move/complete/delete tasks; \"duplicates\" = asks to find duplicate tasks.",
    "filters: words = key words likely in task titles; projects/labels = names the user mentioned; dueFrom/dueTo = YYYY-MM-DD; priority = 1-4; filters describe the EXISTING tasks to find, not the new value to set (for a change request, leave dueFrom/dueTo/priority null unless the user describes the task by its current date or priority); includeCompleted only if the user asks about completed tasks.",
    "refersToLastAnswer=true when the message points at tasks from the previous answer (\"those\", \"them\", \"the first one\")."
  ].join("\n");
  return { system, user: `Conversation so far:\n${historyText || "(none)"}\n\nLatest message:\n${prompt}` };
}

const DEFAULT_CAP = 40;
const norm = (s) => String(s || "").trim().toLowerCase();
const words = (s) => norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

function shortlistTasks(snapshot, lookup, lastAnswerTaskIds, cap) {
  const all = snapshot && (snapshot.tasks || snapshot.items);
  if (!lookup || !lookup.needsTodoist || !Array.isArray(all)) return [];
  const f = lookup.filters || {};
  const day = (x) => String(x).slice(0, 10);
  const byId = new Map(all.map((t) => [String(t.id), t]));
  const out = [];
  const seen = new Set();
  const push = (t) => { if (t && !seen.has(String(t.id))) { seen.add(String(t.id)); out.push(t); } };
  if (lookup.refersToLastAnswer) for (const id of lastAnswerTaskIds || []) push(byId.get(String(id)));

  const names = (f.projects || []).map(norm).filter(Boolean);
  const projectIds = names.length ? new Set((snapshot.projects || []).filter((p) => names.includes(norm(p.name))).map((p) => String(p.id))) : null;
  const labels = (f.labels || []).map(norm).filter(Boolean);
  const terms = [...new Set((f.words || []).flatMap(words))];
  // A change request's dates/priority are usually the NEW values, so with named words they must not exclude the task.
  const namedChange = lookup.kind === "change" && terms.length > 0;
  const scored = [];
  for (const t of all) {
    if (t.isCompleted && !f.includeCompleted) continue;
    if (projectIds && !projectIds.has(String(t.projectId))) continue;
    if (labels.length && !labels.every((l) => (t.labels || []).some((x) => norm(x) === l))) continue;
    const inRange = !(f.priority && t.priority !== f.priority)
      && !(f.dueFrom && !(t.dueDate && day(t.dueDate) >= day(f.dueFrom)))
      && !(f.dueTo && !(t.dueDate && day(t.dueDate) <= day(f.dueTo)));
    if (!namedChange && !inRange) continue;
    let score = 0;
    if (terms.length) {
      const title = new Set(words(t.content));
      const desc = new Set(words(t.description));
      for (const w of terms) score += (title.has(w) ? 2 : 0) + (desc.has(w) ? 1 : 0);
      if (!score) continue;
    }
    scored.push({ t, score, inRange });
  }
  scored.sort((a, b) => b.inRange - a.inRange || b.score - a.score); // stable: ties keep snapshot order
  for (const { t } of scored) push(t);
  return out.slice(0, Number.isFinite(cap) ? Math.max(0, cap) : DEFAULT_CAP);
}

module.exports = { LOOKUP_SCHEMA, lookupPrompt, shortlistTasks };