"use strict";

// Task 2 (plain-language preview rows) - TDD test. Fixtures use the real shapes: snapshot {tasks, projects, sections}
// (camelCase) and rows as validateChangePlan emits them (no plan.js import).
const assert = require("assert");
const { buildPreview } = require("../src/todoist/preview.js");

const snapshot = {
  tasks: [
    { id: "t1", content: "Pay rent", projectId: "p1", sectionId: null, labels: ["home"], dueDate: "2026-11-01T10:00:00", isRecurring: true },
    { id: "t2", content: "Write report", projectId: "p2", sectionId: "s9", labels: ["work", "old"], dueDate: "" },
    { id: "t3", content: "Sub task", projectId: "p2", parentId: "t2", labels: [] },
  ],
  projects: [
    { id: "p1", name: "Home", isInbox: true, isShared: false },
    { id: "p2", name: "Work", isShared: true },
  ],
  sections: [{ id: "s9", name: "Doing", projectId: "p2" }, { id: "s8", name: "Done", projectId: "p2" }],
  cache: { t2: { path: "Notes/report.md" } },
};
const placementFor = () => ({ path: "Semantic Todoist Sync/Miscellaneous Tasks/2026-10 Tasks.md", heading: "Home" });
const move = { op: "move", taskId: "t1", fields: {}, target: { projectId: "p2", sectionId: "s8" }, newLabels: [] };
const label = { op: "update", taskId: "t1", fields: { addLabels: ["urgent"] }, newLabels: ["urgent"] };
const date = { op: "update", taskId: "t2", fields: { dueDate: "2026-12-01" }, newLabels: [] };
const done = { op: "complete", taskId: "t2", fields: {}, newLabels: [] };
const create = { op: "create", fields: { content: "Buy milk" }, target: { projectId: "p1" }, newLabels: [] };
const section = { op: "create-section", fields: { content: "Backlog" }, target: { projectId: "p2" }, newLabels: [] };
const merge = { op: "merge", taskId: "t1", fields: { targetTaskId: "t2" }, newLabels: [] };
const del = { op: "delete", taskId: "t3", fields: {}, newLabels: [] };
const edit = { op: "update", taskId: "t1", fields: { priority: 4 }, newLabels: [] };
const noIds = (s) => !/\b(t1|t2|t3|p1|p2|s8|s9)\b/.test(s);
const first = (rows, snap = snapshot) => buildPreview(rows, snap, { placementFor }).groups[0].rows[0];
const cases = [];
const test = (n, f) => cases.push([n, f]);

test("summary counts changes and tasks", () => {
  const p = buildPreview([move, label, date], snapshot, { placementFor });
  assert.strictEqual(p.summary, "3 changes to 2 tasks");
});
test("move row reads before→after names, never ids", () => {
  const r = first([move]);
  assert.strictEqual(r.sentence, 'Move "Pay rent" from Home to Work / Done');
  assert.ok(r.before === "Home" && r.after === "Work / Done");
  for (const s of [r.sentence, r.before, r.after]) assert.ok(noIds(s), s);
  assert.strictEqual(r.ticked, true);
});
test("dueDate update lands in dates with from/to", () => {
  const p = buildPreview([date, label], snapshot, { placementFor });
  const g = p.groups.find((x) => x.kind === "dates");
  assert.ok(g, JSON.stringify(p.groups.map((x) => x.kind)));
  assert.strictEqual(g.rows[0].sentence, 'Change dates on "Write report" from due no date to due 2026-12-01');
  const r = first([{ op: "update", taskId: "t1", fields: { dueDate: "2026-12-01" }, newLabels: [] }]);
  assert.ok(r.before.includes("2026-11-01") && !r.before.includes("T10"), r.before);
});
test("addLabels update lands in labels with before/after", () => {
  const p = buildPreview([label], snapshot, { placementFor });
  assert.strictEqual(p.groups[0].kind, "labels");
  const r = p.groups[0].rows[0];
  assert.strictEqual(r.before, "home");
  assert.strictEqual(r.after, "home, urgent");
  const r2 = first([{ op: "update", taskId: "t2", fields: { removeLabels: ["old"] }, newLabels: [] }]);
  assert.strictEqual(r2.after, "work");
  const r3 = first([{ op: "update", taskId: "t2", fields: { labels: ["x"] }, newLabels: [] }]);
  assert.strictEqual(r3.after, "x");
});
test("merge names its target", () => {
  assert.strictEqual(first([merge]).sentence, 'Merge "Pay rent" into "Write report"');
});
test("create-section shows its name", () => {
  assert.strictEqual(first([section]).sentence, 'Create section "Backlog" in Work');
});
test("deletes separate and unticked", () => {
  const p = buildPreview([del, move], snapshot, { placementFor });
  assert.strictEqual(p.deletes.length, 1);
  assert.strictEqual(p.deletes[0].ticked, false);
  assert.ok(p.deletes[0].warnings.some((w) => /undo/i.test(w)));
  assert.ok(!p.groups.some((g) => g.rows.some((r) => r.id === p.deletes[0].id)));
});
test("warnings: has-subtasks from parentId, linked-to-note, shared project from isShared", () => {
  const w1 = first([date]).warnings.join("|");
  assert.ok(/subtask/i.test(w1) && /note/i.test(w1) && /shared/i.test(w1), w1);
  const { cache, ...noCache } = snapshot;
  assert.ok(!/note/i.test(first([date], noCache).warnings.join("|")));
});
test("recurring warning from task.isRecurring", () => {
  assert.ok(/recurring/i.test(first([label]).warnings.join("|")));
  assert.ok(!/recurring/i.test(first([date]).warnings.join("|")));
});
test("create row says note will be written to", () => {
  const r = first([create]);
  assert.strictEqual(r.writesTo, placementFor().path);
  assert.ok(/Buy milk/.test(r.sentence) && /written/i.test(r.sentence) && r.sentence.includes("Home"));
});
test("groups ordered moves, labels, dates, completions, creates, merges, edits last", () => {
  const p = buildPreview([edit, merge, create, done, date, label, move], snapshot, { placementFor });
  assert.deepStrictEqual(p.groups.map((g) => g.kind), ["moves", "labels", "dates", "completions", "creates", "merges", "edits"]);
});
test("mixed-category update is one row naming every changed field", () => {
  const p = buildPreview([{ op: "update", taskId: "t3", fields: { content: "New", dueDate: "2026-03-03" }, newLabels: [] }], snapshot, { placementFor });
  assert.strictEqual(p.groups.length, 1);
  assert.strictEqual(p.groups[0].kind, "dates");
  assert.strictEqual(p.groups[0].rows.length, 1);
  const s = p.groups[0].rows[0].sentence;
  assert.ok(s.includes("content") && s.includes('"Sub task" -> "New"') && s.includes("due no date -> 2026-03-03"), s);
  const q = first([{ op: "update", taskId: "t1", fields: { dueDate: "2026-02-02", addLabels: ["b"] }, newLabels: [] }]).sentence;
  assert.ok(q.includes("labels from home to home, b") && q.includes("due 2026-11-01 -> 2026-02-02"), q);
});

let failed = 0;
for (const [n, f] of cases) {
  try { f(); console.log("PASS " + n); } catch (e) { failed++; console.log("FAIL " + n + "\n" + e.stack); }
}
process.exit(failed ? 1 : 0);
