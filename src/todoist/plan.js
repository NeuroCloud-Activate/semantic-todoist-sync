"use strict";

// Pure validation of a model-proposed Todoist change plan. No I/O.
// Rows that fail validation are dropped and returned in `rejected` ("couldn't do").

const OPS = ["create", "update", "move", "complete", "reopen", "delete", "create-section", "merge"];

// OpenAI strict mode: every object lists all its properties in `required` and sets additionalProperties:false,
// so optional fields are nullable (null reads as absent in validateChangePlan).
const nul = (type, extra = {}) => ({ type: [type, "null"], ...extra });
const CHANGE_PLAN_SCHEMA = {
type: "object",
additionalProperties: false,
properties: {
changes: {
type: "array",
items: {
type: "object",
additionalProperties: false,
properties: {
op: { type: "string", enum: OPS },
taskId: nul("string"),
targetTaskId: nul("string"),
projectId: nul("string"),
sectionId: nul("string"),
parentId: nul("string"),
content: nul("string"),
description: nul("string"),
priority: nul("integer", { minimum: 1, maximum: 4 }),
dueDate: nul("string", { description: "YYYY-MM-DD" }),
deadlineDate: nul("string", { description: "YYYY-MM-DD" }),
labels: nul("array", { items: { type: "string" } }),
addLabels: nul("array", { items: { type: "string" } }),
removeLabels: nul("array", { items: { type: "string" } }),
placement: {
type: ["object", "null"],
additionalProperties: false,
properties: { kind: { type: "string", enum: ["active", "named", "none"] }, paths: nul("array", { items: { type: "string" } }) },
required: ["kind", "paths"]
}
},
required: ["op", "taskId", "targetTaskId", "projectId", "sectionId", "parentId", "content", "description", "priority", "dueDate", "deadlineDate", "labels", "addLabels", "removeLabels", "placement"]
}
}
},
required: ["changes"]
};
function validDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const has = (o, k) => o[k] !== undefined && o[k] !== null;
const cleanLabel = (l) => String(l || "").trim().replace(/^@/, "");
const day = (x) => String(x ?? "").slice(0, 10);
const PLACEMENT_KINDS = ["active", "named", "none"];
function cleanPlacement(p) {
  if (!p || typeof p !== "object" || !PLACEMENT_KINDS.includes(p.kind)) return null;
  if (p.paths === undefined || p.paths === null) return { kind: p.kind };
  if (!Array.isArray(p.paths) || !p.paths.every((x) => typeof x === "string")) return null;
  return { kind: p.kind, paths: p.paths.slice() };
}

function validateChangePlan(plan, snapshot, { allowedIds = new Set(), labels = [], allowMerge = false } = {}) {
  const rows = [];
  const rejected = [];
  const changes = Array.isArray(plan?.changes) ? plan.changes : [];
  const snap = snapshot || {};
  const tasks = new Map((snap.items || snap.tasks || []).map((t) => [String(t.id), t]));
  const projects = snap.projects || [];
  const projectIds = new Set(projects.map((p) => String(p.id)));
  const sections = new Map((snap.sections || []).map((s) => [String(s.id), s]));
  const inbox = projects.find((p) => p.isInbox);
  const known = new Map();
  for (const l of [...labels, ...(snap.labels || [])]) known.set(cleanLabel(l).toLowerCase(), cleanLabel(l));

  // Merge guards (merge never deletes or loses data; when unsure, leave duplicates): decided per merge row in plan order.
  const mergeVerdict = new Map();
  const mergeIds = new Set();
  const isUnder = (id, ancestorId) => {
    for (let cur = tasks.get(String(id)), n = 0; cur && cur.parentId && n < 1000; n++) {
      if (String(cur.parentId) === String(ancestorId)) return true;
      cur = tasks.get(String(cur.parentId));
    }
    return false;
  };
  if (allowMerge) for (const c of changes) {
    if (c?.op !== "merge" || !has(c, "taskId") || !has(c, "targetTaskId") || String(c.taskId) === String(c.targetTaskId)) continue;
    const away = tasks.get(String(c.taskId));
    if (!away || !tasks.has(String(c.targetTaskId))) continue;
    const reason = mergeIds.has(String(c.taskId)) || mergeIds.has(String(c.targetTaskId)) ? "merge-conflict"
      : away.isRecurring !== false ? "merge-recurring"
      : isUnder(c.targetTaskId, c.taskId) ? "merge-ancestor" : null;
    mergeVerdict.set(c, reason);
    if (!reason) { mergeIds.add(String(c.taskId)); mergeIds.add(String(c.targetTaskId)); }
  }
  for (const change of changes) {
    const op = change?.op;
    const reject = (reason) => rejected.push({ op: String(op ?? ""), reason, text: String(change?.content ?? change?.taskId ?? "") });
    if (!OPS.includes(op)) { reject("unknown-op"); continue; }
    if (op === "merge" && !allowMerge) { reject("merge-disabled"); continue; }
    if (has(change, "projectName") || has(change, "sectionName")) { reject("project-by-name"); continue; }

    const kindOk = { taskId: tasks.has.bind(tasks), targetTaskId: tasks.has.bind(tasks), parentId: tasks.has.bind(tasks), projectId: (id) => projectIds.has(id), sectionId: (id) => sections.has(id) };
    if (Object.keys(kindOk).some((k) => has(change, k) && (!allowedIds.has(String(change[k])) || !kindOk[k](String(change[k]))))) { reject("unknown-id"); continue; }
    const sec = has(change, "sectionId") ? sections.get(String(change.sectionId)) : null;
    if (sec && has(change, "projectId") && String(sec.projectId) !== String(change.projectId)) { reject("section-project-mismatch"); continue; }
    const needsTask = op !== "create" && op !== "create-section";
    const task = needsTask ? tasks.get(String(change.taskId)) : null;
    if (needsTask && !task) { reject("unknown-id"); continue; }
    if (op === "merge" && mergeVerdict.get(change)) { reject(mergeVerdict.get(change)); continue; }
  if (op !== "merge" && ["taskId", "parentId"].some((k) => has(change, k) && mergeIds.has(String(change[k])))) { reject("merge-conflict"); continue; }
  // Todoist removes/closes subtasks with their parent, which would lose merged data.
  if ((op === "delete" || op === "complete") && task && [...mergeIds].some((id) => isUnder(id, task.id))) { reject("merge-conflict"); continue; }
  if (op === "merge" && !tasks.has(String(change.targetTaskId))) { reject("unknown-id"); continue; }

    if (has(change, "priority") && !(Number.isInteger(change.priority) && change.priority >= 1 && change.priority <= 4)) { reject("bad-priority"); continue; }
    if ((has(change, "dueDate") && change.dueDate !== "" && !validDate(change.dueDate)) || (has(change, "deadlineDate") && change.deadlineDate !== "" && !validDate(change.deadlineDate))) { reject("bad-date"); continue; }

    const newLabels = [];
    const resolve = (list) => (Array.isArray(list) ? list : []).map(cleanLabel).filter(Boolean).map((l) => {
      const hit = known.get(l.toLowerCase());
      if (hit) return hit;
        if (!newLabels.some((n) => n.toLowerCase() === l.toLowerCase())) newLabels.push(l);
      return l;
    });

    const row = { op, fields: {}, newLabels };
    if (task) row.taskId = String(task.id);
    const fields = row.fields;

    if (op === "create" || op === "create-section") {
      const content = String(change.content || "").trim();
      if (!content) { reject("missing-content"); continue; }
      fields.content = content;
      if (op === "create-section") {
        if (!has(change, "projectId")) { reject("unknown-id"); continue; }
        row.target = { projectId: String(change.projectId) };
      } else {
        for (const k of ["description", "priority", "dueDate", "deadlineDate"]) if (has(change, k)) fields[k] = change[k];
        if (has(change, "labels")) fields.labels = resolve(change.labels);
        const parent = has(change, "parentId") ? tasks.get(String(change.parentId)) : null;
        const projectId = has(change, "projectId") ? String(change.projectId) : sec ? String(sec.projectId) : parent ? String(parent.projectId) : inbox?.id;
        if (parent && projectId && String(parent.projectId) !== String(projectId)) { reject("parent-project-mismatch"); continue; }
        if (!projectId) { reject("no-inbox"); continue; }
        row.target = { projectId: String(projectId) };
        if (has(change, "sectionId")) row.target.sectionId = String(change.sectionId);
        if (has(change, "parentId")) row.target.parentId = String(change.parentId);
        const placement = cleanPlacement(change.placement);
        if (placement) row.placement = placement;
      }
    } else if (op === "update") {
      for (const k of ["content", "description", "priority", "dueDate", "deadlineDate"]) {
        if (has(change, k) && (k === "dueDate" || k === "deadlineDate" ? day(change[k]) !== day(task[k]) : change[k] !== (task[k] ?? ""))) fields[k] = change[k];
      }
      if (has(change, "content") && !String(change.content).trim()) { reject("missing-content"); continue; }
      const cur = (task.labels || []).map((l) => l.toLowerCase());
      const add = resolve(change.addLabels).filter((l) => !cur.includes(l.toLowerCase()));
      // Apply removes case-sensitively, so send the task's own spelling.
      const rem = (Array.isArray(change.removeLabels) ? change.removeLabels : []).map(cleanLabel).flatMap((l) => (task.labels || []).filter((t) => t.toLowerCase() === l.toLowerCase()));
      const remSent = [...new Set(rem)];
      if (add.length) fields.addLabels = add;
      if (remSent.length) fields.removeLabels = remSent;
      newLabels.splice(0, newLabels.length, ...newLabels.filter((l) => add.includes(l)));
      if (!Object.keys(fields).length) { reject("no-op"); continue; }
    } else if (op === "move") {
      const target = {};
      for (const k of ["projectId", "sectionId", "parentId"]) if (has(change, k)) target[k] = String(change[k]);
      const same = ["projectId", "sectionId", "parentId"].every((k) => target[k] === undefined || target[k] === String(task[k] || ""));
      if (!Object.keys(target).length || same) { reject("no-op"); continue; }
      if (target.parentId && (target.parentId === row.taskId || isUnder(target.parentId, row.taskId))) { reject("parent-cycle"); continue; }
      const par = target.parentId ? tasks.get(target.parentId) : null;
      if (par && (target.projectId || sec) && String(par.projectId) !== (target.projectId || String(sec.projectId))) { reject("parent-project-mismatch"); continue; }
      if (sec && !target.projectId) target.projectId = String(sec.projectId);
      row.target = target;
    } else if (op === "complete" || op === "reopen") {
      if (Boolean(task.isCompleted) === (op === "complete")) { reject("no-op"); continue; }
    } else if (op === "merge") {
      fields.targetTaskId = String(change.targetTaskId);
      if (fields.targetTaskId === row.taskId) { reject("no-op"); continue; }
    }
    rows.push(row);
  }
  return { rows, rejected };
}

module.exports = { CHANGE_PLAN_SCHEMA, validateChangePlan };