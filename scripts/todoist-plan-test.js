"use strict";

// Task 1 (change-plan validation) test. Plain node + assert, prints PASS per case.
const assert = require("assert");
const { validateChangePlan, CHANGE_PLAN_SCHEMA } = require("../src/todoist/plan.js");

const snapshot = {
  tasks: [
    { id: "t1", isRecurring: false, content: "Buy compost", description: "", projectId: "p1", sectionId: "", parentId: "", labels: ["home"], priority: 1, dueDate: "2026-11-01", deadlineDate: "", isCompleted: false },
    { id: "t3", isRecurring: false, content: "Call", description: "", projectId: "p1", sectionId: "", parentId: "", labels: [], priority: 1, dueDate: "2026-11-01T10:00:00", deadlineDate: "2026-11-05T09:00:00", isCompleted: false },
    { id: "t2", isRecurring: false, content: "Old", description: "", projectId: "p2", sectionId: "", parentId: "", labels: [], priority: 1, dueDate: "", deadlineDate: "", isCompleted: true }
  ],
  projects: [{ id: "pin", name: "Inbox", isInbox: true }, { id: "p1", name: "Errands" }, { id: "p2", name: "Work" }],
  sections: [{ id: "s1", name: "Today", projectId: "p1" }],
  labels: ["home"]
};
const opts = { allowedIds: new Set(["t1", "t2", "t3", "pin", "p1", "p2", "s1"]), labels: ["home"] };
const run = (changes, o = opts) => validateChangePlan({ changes }, snapshot, o);
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("schema is an object schema", () => assert.strictEqual(CHANGE_PLAN_SCHEMA.type, "object"));
test("unknown task id rejected", () => {
  const r = run([{ op: "update", taskId: "zzz", priority: 2 }]);
  assert.strictEqual(r.rows.length, 0);
  assert.strictEqual(r.rejected[0].reason, "unknown-id");
});
test("unknown project id rejected", () => {
  assert.strictEqual(run([{ op: "move", taskId: "t1", projectId: "nope" }]).rejected[0].reason, "unknown-id");
});
test("project given by name rejected", () => {
  const r = run([{ op: "move", taskId: "t1", projectName: "Work" }]);
  assert.strictEqual(r.rows.length, 0);
  assert.strictEqual(r.rejected[0].reason, "project-by-name");
});
test("priority 5 and date \"2026-13-40\" are rejected", () => {
  assert.strictEqual(run([{ op: "update", taskId: "t1", priority: 5 }]).rejected[0].reason, "bad-priority");
  assert.strictEqual(run([{ op: "update", taskId: "t1", dueDate: "2026-13-40" }]).rejected[0].reason, "bad-date");
  assert.strictEqual(run([{ op: "update", taskId: "t1", deadlineDate: "2026-02-30" }]).rejected[0].reason, "bad-date");
  assert.strictEqual(run([{ op: "update", taskId: "t1", priority: 2.5 }]).rejected[0].reason, "bad-priority");
});
test("valid update keeps only changed fields", () => {
  const r = run([{ op: "update", taskId: "t1", priority: 3, dueDate: "2026-11-01" }]);
  assert.deepStrictEqual(r.rows[0].fields, { priority: 3 });
  assert.strictEqual(r.rows[0].taskId, "t1");
});
test("unchanged update dropped no-op", () => {
  const r = run([{ op: "update", taskId: "t1", priority: 1, content: "Buy compost" }]);
  assert.strictEqual(r.rows.length, 0);
  assert.strictEqual(r.rejected[0].reason, "no-op");
});
test("unknown label becomes newLabels entry", () => {
  const r = run([{ op: "update", taskId: "t1", addLabels: ["Home", "outside"] }]);
  assert.deepStrictEqual(r.rows[0].newLabels, ["outside"]);
  assert.deepStrictEqual(r.rows[0].fields.addLabels, ["outside"]);
});
test("merge rejected in phase 1", () => {
  const m = { op: "merge", taskId: "t1", targetTaskId: "t2" };
  assert.strictEqual(run([m]).rejected[0].reason, "merge-disabled");
  assert.strictEqual(run([m], Object.assign({ allowMerge: true }, opts)).rows[0].op, "merge");
});
test("create without project goes to inbox project id", () => {
  const r = run([{ op: "create", content: "New thing" }]);
  assert.strictEqual(r.rows[0].target.projectId, "pin");
  assert.strictEqual(r.rows[0].fields.content, "New thing");
});
test("create without content rejected", () => {
  assert.strictEqual(run([{ op: "create" }]).rejected[0].reason, "missing-content");
});
test("move to same place is no-op; move to section works", () => {
  assert.strictEqual(run([{ op: "move", taskId: "t1", projectId: "p1" }]).rejected[0].reason, "no-op");
  assert.deepStrictEqual(run([{ op: "move", taskId: "t1", projectId: "p1", sectionId: "s1" }]).rows[0].target, { projectId: "p1", sectionId: "s1" });
});
test("complete/reopen/delete state checks", () => {
  assert.strictEqual(run([{ op: "complete", taskId: "t1" }]).rows[0].op, "complete");
  assert.strictEqual(run([{ op: "complete", taskId: "t2" }]).rejected[0].reason, "no-op");
  assert.strictEqual(run([{ op: "reopen", taskId: "t2" }]).rows[0].op, "reopen");
  assert.strictEqual(run([{ op: "delete", taskId: "t1" }]).rows[0].op, "delete");
});
test("create-section needs name and known project; unknown op rejected", () => {
  assert.strictEqual(run([{ op: "create-section", projectId: "p1", content: "Later" }]).rows[0].op, "create-section");
  assert.strictEqual(run([{ op: "create-section", projectId: "p1" }]).rejected[0].reason, "missing-content");
  assert.strictEqual(run([{ op: "explode" }]).rejected[0].reason, "unknown-op");
});
test("malformed plan yields empty result", () => {
  assert.deepStrictEqual(validateChangePlan(null, snapshot, opts), { rows: [], rejected: [] });
});
test("wrong-kind ids rejected as unknown-id", () => {
  assert.strictEqual(run([{ op: "create", content: "x", projectId: "t1" }]).rejected[0].reason, "unknown-id");
  assert.strictEqual(run([{ op: "create", content: "x", projectId: "s1" }]).rejected[0].reason, "unknown-id");
  assert.strictEqual(run([{ op: "create", content: "x", sectionId: "p1" }]).rejected[0].reason, "unknown-id");
  assert.strictEqual(run([{ op: "create", content: "x", parentId: "p1" }]).rejected[0].reason, "unknown-id");
  assert.strictEqual(run([{ op: "update", taskId: "p1", priority: 2 }]).rejected[0].reason, "unknown-id");
  assert.strictEqual(run([{ op: "merge", taskId: "t1", targetTaskId: "p1" }], Object.assign({ allowMerge: true }, opts)).rejected[0].reason, "unknown-id");
});
test("create with section only derives project from the section", () => {
  assert.deepStrictEqual(run([{ op: "create", content: "x", sectionId: "s1" }]).rows[0].target, { projectId: "p1", sectionId: "s1" });
});
test("section/project mismatch rejected for create and move", () => {
  assert.strictEqual(run([{ op: "create", content: "x", projectId: "p2", sectionId: "s1" }]).rejected[0].reason, "section-project-mismatch");
  assert.strictEqual(run([{ op: "move", taskId: "t2", projectId: "p2", sectionId: "s1" }]).rejected[0].reason, "section-project-mismatch");
});
test("date-only update equal to a datetime due/deadline is a no-op", () => {
  const r = run([{ op: "update", taskId: "t3", dueDate: "2026-11-01", deadlineDate: "2026-11-05" }]);
  assert.strictEqual(r.rows.length, 0);
  assert.strictEqual(r.rejected[0].reason, "no-op");
  assert.deepStrictEqual(run([{ op: "update", taskId: "t3", dueDate: "2026-11-02" }]).rows[0].fields, { dueDate: "2026-11-02" });
});
test("create placement carried through; invalid placement dropped", () => {
  assert.deepStrictEqual(run([{ op: "create", content: "x", placement: { kind: "named", paths: ["A/B.md"] } }]).rows[0].placement, { kind: "named", paths: ["A/B.md"] });
  assert.deepStrictEqual(run([{ op: "create", content: "x", placement: { kind: "active" } }]).rows[0].placement, { kind: "active" });
  for (const bad of ["active", { kind: "bogus" }, { kind: "named", paths: [1] }, null]) {
    const r = run([{ op: "create", content: "x", placement: bad }]);
    assert.strictEqual(r.rows.length, 1);
    assert.ok(!("placement" in r.rows[0]));
  }
  assert.ok("placement" in CHANGE_PLAN_SCHEMA.properties.changes.items.properties);
});

test("move with section only fills the section's project", () => {
  const r = run([{ op: "move", taskId: "t2", sectionId: "s1" }]);
  assert.deepStrictEqual(r.rows[0].target, { projectId: "p1", sectionId: "s1" });
});
test("create subtask with parent only takes the parent's project", () => {
  assert.strictEqual(run([{ op: "create", content: "x", parentId: "t2" }]).rows[0].target.projectId, "p2");
});
test("create subtask in a different project than its parent is rejected", () => {
  const r = run([{ op: "create", content: "x", parentId: "t1", projectId: "p2" }]);
  assert.strictEqual(r.rows.length, 0);
  assert.strictEqual(r.rejected[0].reason, "parent-project-mismatch");
});
test("merge row keeps kept id in fields.targetTaskId; merge into itself is a no-op", () => {
  const o = Object.assign({ allowMerge: true }, opts);
  const row = run([{ op: "merge", taskId: "t1", targetTaskId: "t2" }], o).rows[0];
  assert.strictEqual(row.taskId, "t1");
  assert.strictEqual(row.fields.targetTaskId, "t2");
  assert.strictEqual(run([{ op: "merge", taskId: "t1", targetTaskId: "t1" }], o).rejected[0].reason, "no-op");
});
const strictProblems = (s, path = "root") => {
  const out = [];
  const types = [].concat(s.type || []);
  if (types.includes("object")) {
    if (s.additionalProperties !== false) out.push(`${path}: additionalProperties not false`);
    const keys = Object.keys(s.properties || {});
    if (JSON.stringify([...(s.required || [])].sort()) !== JSON.stringify([...keys].sort())) out.push(`${path}: required != all properties`);
    for (const k of keys) out.push(...strictProblems(s.properties[k], `${path}.${k}`));
  }
  if (types.includes("array") && s.items) out.push(...strictProblems(s.items, `${path}[]`));
  return out;
};
test("CHANGE_PLAN_SCHEMA is OpenAI strict-mode compliant, optional fields nullable", () => {
  assert.deepStrictEqual(strictProblems(CHANGE_PLAN_SCHEMA), []);
  const p = CHANGE_PLAN_SCHEMA.properties.changes.items.properties;
  for (const k of ["taskId", "priority", "dueDate", "labels", "placement"]) assert.ok(p[k].type.includes("null"), k);
  assert.strictEqual(p.op.type, "string");
});
test("null optional fields behave absent", () => {
  const nulls = { taskId: null, targetTaskId: null, projectId: null, sectionId: null, parentId: null, content: null, description: null, priority: null, dueDate: null, deadlineDate: null, labels: null, addLabels: null, removeLabels: null, placement: null };
  const r = run([{ ...nulls, op: "update", taskId: "t1", priority: 3 }]);
  assert.deepStrictEqual(r.rows[0].fields, { priority: 3 });
  const c = run([{ ...nulls, op: "create", content: "x", placement: { kind: "named", paths: null } }]);
  assert.deepStrictEqual(c.rows[0].placement, { kind: "named" });
  assert.deepStrictEqual(c.rows[0].target, { projectId: "pin" });
  assert.strictEqual(run([{ ...nulls, op: "move", taskId: "t1", sectionId: "s1" }]).rows[0].target.sectionId, "s1");
  assert.strictEqual(run([{ ...nulls, op: "update", taskId: "t1" }]).rejected[0].reason, "no-op");
});
const mo = Object.assign({ allowMerge: true }, opts);
const mergeSnap = {
  ...snapshot,
  tasks: [
    ...snapshot.tasks,
    { id: "r1", content: "Rec", projectId: "p1", parentId: "", labels: [], isRecurring: true, isCompleted: false },
    { id: "k1", content: "Kid", projectId: "p1", parentId: "t1", labels: [], isRecurring: false, isCompleted: false },
    { id: "k2", content: "Grandkid", projectId: "p1", parentId: "k1", labels: [], isRecurring: false, isCompleted: false },
  ],
};
const mrun = (changes) => validateChangePlan({ changes }, mergeSnap, { ...mo, allowedIds: new Set([...mo.allowedIds, "r1", "k1", "k2"]) });
test("merge guard: task in at most one merge row", () => {
  const r = mrun([{ op: "merge", taskId: "t1", targetTaskId: "t3" }, { op: "merge", taskId: "t1", targetTaskId: "t2" }, { op: "merge", taskId: "t3", targetTaskId: "t2" }, { op: "merge", taskId: "t2", targetTaskId: "t3" }]);
  assert.strictEqual(r.rows.length, 1);
  assert.deepStrictEqual(r.rejected.map((x) => x.reason), ["merge-conflict", "merge-conflict", "merge-conflict"]);
});
test("merge guard: non-merge row touching participant rejected, any plan order", () => {
  const r = mrun([{ op: "update", taskId: "t3", priority: 3 }, { op: "delete", taskId: "t1" }, { op: "merge", taskId: "t1", targetTaskId: "t3" }, { op: "update", taskId: "t2", priority: 2 }]);
  assert.deepStrictEqual(r.rows.map((x) => x.op + x.taskId), ["merge" + "t1", "update" + "t2"]);
  assert.deepStrictEqual(r.rejected.map((x) => x.reason), ["merge-conflict", "merge-conflict"]);
});
test("merge guard: recurring or unknown-recurrence merged-away rejected", () => {
  assert.strictEqual(mrun([{ op: "merge", taskId: "r1", targetTaskId: "t1" }]).rejected[0].reason, "merge-recurring");
  const unk = validateChangePlan({ changes: [{ op: "merge", taskId: "u1", targetTaskId: "t3" }] }, { ...snapshot, tasks: [...snapshot.tasks, { id: "u1", content: "U", projectId: "p1", labels: [] }] }, { ...mo, allowedIds: new Set([...mo.allowedIds, "u1"]) });
  assert.strictEqual(unk.rejected[0].reason, "merge-recurring");
  assert.strictEqual(mrun([{ op: "merge", taskId: "t1", targetTaskId: "r1" }]).rows.length, 1);
});
test("merge guard: kept task under merged-away task (any depth) rejected", () => {
  assert.strictEqual(mrun([{ op: "merge", taskId: "t1", targetTaskId: "k1" }]).rejected[0].reason, "merge-ancestor");
  assert.strictEqual(mrun([{ op: "merge", taskId: "t1", targetTaskId: "k2" }]).rejected[0].reason, "merge-ancestor");
  assert.strictEqual(mrun([{ op: "merge", taskId: "k2", targetTaskId: "t1" }]).rows.length, 1);
});
test("merge guard: delete/complete of an ancestor of a merge participant rejected", () => {
  const conflict = (changes) => mrun(changes).rejected.map((x) => x.reason);
  assert.deepStrictEqual(conflict([{ op: "merge", taskId: "t3", targetTaskId: "k1" }, { op: "delete", taskId: "t1" }]), ["merge-conflict"]);
  assert.deepStrictEqual(conflict([{ op: "merge", taskId: "t3", targetTaskId: "k2" }, { op: "complete", taskId: "t1" }]), ["merge-conflict"]);
  assert.deepStrictEqual(conflict([{ op: "merge", taskId: "k2", targetTaskId: "t3" }, { op: "delete", taskId: "k1" }]), ["merge-conflict"]);
  const ok = mrun([{ op: "merge", taskId: "t3", targetTaskId: "k1" }, { op: "delete", taskId: "t2" }]);
  assert.deepStrictEqual(ok.rows.map((x) => x.op), ["merge", "delete"]);
  assert.strictEqual(ok.rejected.length, 0);
});
test("round 10: removeLabels uses the task's own spelling (case-insensitive match)", () => {
  const s = { ...snapshot, tasks: [...snapshot.tasks, { id: "c1", content: "Cased", projectId: "p1", parentId: "", labels: ["Errands", "home"], isRecurring: false, isCompleted: false }] };
  const o = { ...opts, allowedIds: new Set([...opts.allowedIds, "c1"]) };
  const r = validateChangePlan({ changes: [{ op: "update", taskId: "c1", removeLabels: ["errands", "HOME", "nope"] }] }, s, o);
  assert.deepStrictEqual(r.rows[0].fields.removeLabels, ["Errands", "home"]);
});
test("round 10: update with empty or blank content rejected missing-content", () => {
  assert.strictEqual(run([{ op: "update", taskId: "t1", content: "" }]).rejected[0].reason, "missing-content");
  assert.strictEqual(run([{ op: "update", taskId: "t1", content: "  \t" }]).rejected[0].reason, "missing-content");
  assert.strictEqual(run([{ op: "update", taskId: "t1", content: "Renamed" }]).rows[0].fields.content, "Renamed");
});
test("round 10: move parent cycles rejected parent-cycle", () => {
  assert.strictEqual(mrun([{ op: "move", taskId: "t1", parentId: "t1" }]).rejected[0].reason, "parent-cycle");
  assert.strictEqual(mrun([{ op: "move", taskId: "t1", parentId: "k1" }]).rejected[0].reason, "parent-cycle");
  assert.strictEqual(mrun([{ op: "move", taskId: "t1", parentId: "k2" }]).rejected[0].reason, "parent-cycle");
  const ok = mrun([{ op: "move", taskId: "k2", parentId: "t3" }]);
  assert.strictEqual(ok.rows[0].target.parentId, "t3");
});
test("round 10: move with projectId and parentId in another project rejected parent-project-mismatch", () => {
  assert.strictEqual(mrun([{ op: "move", taskId: "t3", projectId: "p2", parentId: "k1" }]).rejected[0].reason, "parent-project-mismatch");
  assert.strictEqual(mrun([{ op: "move", taskId: "t2", projectId: "p1", parentId: "k1" }]).rows.length, 1);
});

test("round 10c: parent+section in another project than parent rejected; same project accepted", () => {
  const s = { ...mergeSnap, sections: [...mergeSnap.sections, { id: "s2", name: "Later", projectId: "p2" }] };
  const o = { ...mo, allowedIds: new Set([...mo.allowedIds, "r1", "k1", "k2", "s2"]) };
  const m = (c) => validateChangePlan({ changes: [c] }, s, o);
  assert.strictEqual(m({ op: "move", taskId: "t3", parentId: "k1", sectionId: "s2" }).rejected[0].reason, "parent-project-mismatch");
  assert.strictEqual(m({ op: "move", taskId: "t3", parentId: "k1", sectionId: "s1" }).rows.length, 1);
});
test("round 10c: removeLabels removes every case variant once", () => {
  const s = { ...snapshot, tasks: [...snapshot.tasks, { id: "c2", content: "Dup", projectId: "p1", parentId: "", labels: ["errands", "ERRANDS", "home"], isRecurring: false, isCompleted: false }] };
  const o = { ...opts, allowedIds: new Set([...opts.allowedIds, "c2"]) };
  const r = validateChangePlan({ changes: [{ op: "update", taskId: "c2", removeLabels: ["errands", "Errands"] }] }, s, o);
  assert.deepStrictEqual(r.rows[0].fields.removeLabels, ["errands", "ERRANDS"]);
  const one = validateChangePlan({ changes: [{ op: "update", taskId: "c2", removeLabels: ["home"] }] }, s, o);
  assert.deepStrictEqual(one.rows[0].fields.removeLabels, ["home"]);
});
let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n${e.stack}`); }
}
process.exit(failed ? 1 : 0);