"use strict";

// Task 1 (change-plan validation) test. Plain node + assert, prints PASS per case.
const assert = require("assert");
const { validateChangePlan, CHANGE_PLAN_SCHEMA } = require("../src/todoist/plan.js");

const snapshot = {
  tasks: [
    { id: "t1", content: "Buy compost", description: "", projectId: "p1", sectionId: "", parentId: "", labels: ["home"], priority: 1, dueDate: "2026-11-01", deadlineDate: "", isCompleted: false },
    { id: "t3", content: "Call", description: "", projectId: "p1", sectionId: "", parentId: "", labels: [], priority: 1, dueDate: "2026-11-01T10:00:00", deadlineDate: "2026-11-05T09:00:00", isCompleted: false },
    { id: "t2", content: "Old", description: "", projectId: "p2", sectionId: "", parentId: "", labels: [], priority: 1, dueDate: "", deadlineDate: "", isCompleted: true }
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
let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n${e.stack}`); }
}
process.exit(failed ? 1 : 0);