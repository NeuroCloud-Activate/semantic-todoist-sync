"use strict";

// Pure validation of a model-proposed Todoist change plan. No I/O.
// Rows that fail validation are dropped and returned in `rejected` ("couldn't do").

const OPS = ["create", "update", "move", "complete", "reopen", "delete", "create-section", "merge"];

const CHANGE_PLAN_SCHEMA = {
  type: "object",
  properties: {
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: OPS },
          taskId: { type: "string" },
          targetTaskId: { type: "string" },
          projectId: { type: "string" },
          sectionId: { type: "string" },
          parentId: { type: "string" },
          content: { type: "string" },
          description: { type: "string" },
          priority: { type: "integer", minimum: 1, maximum: 4 },
          dueDate: { type: "string", description: "YYYY-MM-DD" },
          deadlineDate: { type: "string", description: "YYYY-MM-DD" },
          labels: { type: "array", items: { type: "string" } },
          addLabels: { type: "array", items: { type: "string" } },
          removeLabels: { type: "array", items: { type: "string" } },
        placement: {
          type: "object",
          properties: { kind: { type: "string", enum: ["active", "named", "none"] }, paths: { type: "array", items: { type: "string" } } },
          required: ["kind"]
        }
        },
        required: ["op"]
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
  if (p.paths === undefined) return { kind: p.kind };
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
      const cur = (task.labels || []).map((l) => l.toLowerCase());
      const add = resolve(change.addLabels).filter((l) => !cur.includes(l.toLowerCase()));
      const rem = (Array.isArray(change.removeLabels) ? change.removeLabels : []).map(cleanLabel).filter((l) => cur.includes(l.toLowerCase()));
      if (add.length) fields.addLabels = add;
      if (rem.length) fields.removeLabels = rem;
      newLabels.splice(0, newLabels.length, ...newLabels.filter((l) => add.includes(l)));
      if (!Object.keys(fields).length) { reject("no-op"); continue; }
    } else if (op === "move") {
      const target = {};
      for (const k of ["projectId", "sectionId", "parentId"]) if (has(change, k)) target[k] = String(change[k]);
      const same = ["projectId", "sectionId", "parentId"].every((k) => target[k] === undefined || target[k] === String(task[k] || ""));
      if (!Object.keys(target).length || same) { reject("no-op"); continue; }
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