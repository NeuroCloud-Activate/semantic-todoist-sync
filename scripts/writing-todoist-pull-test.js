"use strict";

// Task: Todoist pull resolver, target records, pull list renderer (design section C).
// Plain node + assert, prints `PASS <case>`, exits non-zero on failure.
process.env.TZ = "America/New_York";
const assert = require("assert");
const E = require("../src/writing/todoist-evidence.js");

const taskUrl = (id) => `https://app.todoist.com/app/task/${id}`;
const P = (id, name, parentId = "") => ({ id, name, parentId });
const S = (id, name, projectId) => ({ id, name, projectId });
const T = (id, content, o = {}) => ({
  id, content, projectId: o.projectId || "p1", sectionId: o.sectionId || "s1",
  parentId: o.parentId || "", completedAt: o.completedAt || "", dueDate: o.dueDate || "",
  labels: o.labels || [], priority: o.priority || 1, description: o.description || ""
});

const projects = [P("p1", "Thesis"), P("p2", "Grants"), P("p3", "Data", "p1"), P("p4", "AI")];
const sections = [S("s1", "Ethics", "p1"), S("s2", "Methods", "p1"), S("s3", "Data", "p2"), S("s4", "AI", "p4"), S("s5", "Ethics", "p2")];
const tasks = [
  T("t1", "Write draft", { sectionId: "s1" }),
  T("t2", "Review draft", { sectionId: "s1", parentId: "t1" }),
  T("t3", "Edit draft", { sectionId: "s1", parentId: "t1" }),
  T("t4", "Methods task", { sectionId: "s2" }),
  T("t5", "Data sub task", { projectId: "p3", sectionId: "s3" }),
  T("t6", "AI task", { projectId: "p4", sectionId: "s4" }),
];
const snap = { tasks, projects, sections };

const mkRec = (id, title, o = {}) => ({
  id, title, projectId: o.projectId || "p1", projectName: o.projectName || "Thesis",
  sectionName: o.sectionName || "Ethics", parentId: o.parentId || "", parentTitle: o.parentTitle || "",
  status: o.status || "open", due: o.due || "", deadline: o.deadline || "", priority: o.priority || 1,
  labels: o.labels || [], completedAt: o.completedAt || "", description: o.description || "",
  notePaths: o.notePaths || [], url: taskUrl(id), ...o
});

// ---------- resolveTodoistTarget ----------
{
  const r = E.resolveTodoistTarget("https://app.todoist.com/app/task/t1", snap);
  assert.deepStrictEqual(r, { kind: "task", id: "t1", name: "Write draft", projectId: "p1" });
  console.log("PASS resolver task link app.todoist.com");
}
{
  const r = E.resolveTodoistTarget("see https://todoist.com/app/task/t2 here", snap);
  assert.deepStrictEqual(r, { kind: "task", id: "t2", name: "Review draft", projectId: "p1" });
  console.log("PASS resolver task link todoist.com host");
}
{
  const r = E.resolveTodoistTarget("https://app.todoist.com/app/project/p2", snap);
  assert.deepStrictEqual(r, { kind: "project", id: "p2", name: "Grants", projectId: "p2" });
  console.log("PASS resolver project link");
}
{
  const r = E.resolveTodoistTarget("https://app.todoist.com/app/section/s1", snap);
  assert.deepStrictEqual(r, { kind: "section", id: "s1", name: "Ethics", projectId: "p1" });
  console.log("PASS resolver section link");
}
{
  const r = E.resolveTodoistTarget("https://app.todoist.com/app/project/p1?section=s2", snap);
  assert.deepStrictEqual(r, { kind: "section", id: "s2", name: "Methods", projectId: "p1" });
  console.log("PASS resolver project with section query");
}
{
  const r = E.resolveTodoistTarget("todoist://task?id=t3", snap);
  assert.deepStrictEqual(r, { kind: "task", id: "t3", name: "Edit draft", projectId: "p1" });
  console.log("PASS resolver todoist://");
}
{
  const r = E.resolveTodoistTarget("https://app.todoist.com/app/task/thesis-drafts-t1", snap);
  assert.deepStrictEqual(r, { kind: "task", id: "t1", name: "Write draft", projectId: "p1" });
  console.log("PASS resolver slug prefix");
}
{
  const r = E.resolveTodoistTarget("https://app.todoist.com/app/task/t1).", snap);
  assert.deepStrictEqual(r, { kind: "task", id: "t1", name: "Write draft", projectId: "p1" });
  console.log("PASS resolver trailing punctuation");
}
{
  const r = E.resolveTodoistTarget("https://app.todoist.com/app/task/zzz", snap);
  assert.strictEqual(r, null);
  console.log("PASS resolver unknown id null");
}
{
  const r = E.resolveTodoistTarget("the METHODS section", snap);
  assert.deepStrictEqual(r, { kind: "section", id: "s2", name: "Methods", projectId: "p1" });
  console.log("PASS resolver section name case-insensitive");
}
{
  const r = E.resolveTodoistTarget("grants", snap);
  assert.deepStrictEqual(r, { kind: "project", id: "p2", name: "Grants", projectId: "p2" });
  console.log("PASS resolver project name case-insensitive");
}
{
  const r = E.resolveTodoistTarget("AI", snap);
  assert.strictEqual(r, null);
  console.log("PASS resolver short name ignored");
}
{
  const r = E.resolveTodoistTarget("Ethics", snap);
  assert.deepStrictEqual(r, { ambiguous: [
    { kind: "section", id: "s1", name: "Ethics", projectId: "p1" },
    { kind: "section", id: "s5", name: "Ethics", projectId: "p2" },
  ] });
  console.log("PASS resolver ambiguous same-name sections");
}
{
  const r = E.resolveTodoistTarget("Data", snap);
  assert.deepStrictEqual(r, { ambiguous: [
    { kind: "section", id: "s3", name: "Data", projectId: "p2" },
    { kind: "project", id: "p3", name: "Data", projectId: "p3" },
  ] });
  console.log("PASS resolver section-vs-project same name ambiguous");
}
{
  const r = E.resolveTodoistTarget("hello world", snap);
  assert.strictEqual(r, null);
  console.log("PASS resolver text mentioning neither null");
}

// ---------- targetRecords ----------
{
  const { records, skippedCompleted } = E.targetRecords({
    snapshot: snap, target: { kind: "task", id: "t1", name: "Write draft", projectId: "p1" }, taskUrl
  });
  assert.deepStrictEqual(records.map((r) => r.id), ["t1", "t2", "t3"]);
  assert.strictEqual(records[0].projectId, "p1");
  assert.strictEqual(records[0].projectName, "Thesis");
  assert.strictEqual(records[0].sectionName, "Ethics");
  assert.strictEqual(records[1].parentId, "t1");
  assert.strictEqual(records[1].parentTitle, "Write draft");
  assert.strictEqual(skippedCompleted, 0);
  console.log("PASS targetRecords task pull includes descendants");
}
{
  const { records, skippedCompleted } = E.targetRecords({
    snapshot: snap, target: { kind: "section", id: "s1", name: "Ethics", projectId: "p1" }, taskUrl
  });
  assert.deepStrictEqual(records.map((r) => r.id), ["t1", "t2", "t3"]);
  assert.strictEqual(skippedCompleted, 0);
  console.log("PASS targetRecords section pull");
}
{
  const { records } = E.targetRecords({
    snapshot: snap, target: { kind: "project", id: "p1", name: "Thesis", projectId: "p1" }, taskUrl
  });
  assert.deepStrictEqual(records.map((r) => r.id).sort(), ["t1", "t2", "t3", "t4", "t5"].sort());
  const t5 = records.find((r) => r.id === "t5");
  assert.strictEqual(t5.projectId, "p3");
  assert.strictEqual(t5.projectName, "Data");
  console.log("PASS targetRecords project pull includes sub-projects, no merge");
}
{
  const completed = [T("c1", "Done elsewhere", { sectionId: "s2", completedAt: "2026-10-20T10:00:00" })];
  const { records, skippedCompleted } = E.targetRecords({
    snapshot: snap, completed, target: { kind: "section", id: "s1", name: "Ethics", projectId: "p1" }, taskUrl, includeCompleted: true
  });
  assert.deepStrictEqual(records.map((r) => r.id), ["t1", "t2", "t3"]);
  assert.strictEqual(skippedCompleted, 1);
  console.log("PASS targetRecords completed skipped when no matching id");
}
{
  const completed = [T("c2", "Done ethics", { sectionId: "s1", completedAt: "2026-10-20T10:00:00" })];
  const { records, skippedCompleted } = E.targetRecords({
    snapshot: snap, completed, target: { kind: "section", id: "s1", name: "Ethics", projectId: "p1" }, taskUrl, includeCompleted: true
  });
  assert.deepStrictEqual(records.map((r) => r.id), ["t1", "t2", "t3", "c2"]);
  assert.strictEqual(records.find((r) => r.id === "c2").status, "done");
  assert.strictEqual(skippedCompleted, 0);
  console.log("PASS targetRecords completed included when matching section");
}
{
  const completed = [T("c2", "Done ethics", { sectionId: "s1", completedAt: "2026-10-20T10:00:00" })];
  const { records, skippedCompleted } = E.targetRecords({
    snapshot: snap, completed, target: { kind: "section", id: "s1", name: "Ethics", projectId: "p1" }, taskUrl, includeCompleted: false
  });
  assert.deepStrictEqual(records.map((r) => r.id), ["t1", "t2", "t3"]);
  assert.strictEqual(skippedCompleted, 1);
  console.log("PASS targetRecords includeCompleted false skips completed");
}
{
  const many = [];
  for (let i = 0; i < 60; i++) many.push(T(`m${i}`, `Task ${i}`, { sectionId: "s1" }));
  many.push(T("sub1", "sub 1", { sectionId: "s1", parentId: "m0" }));
  many.push(T("sub2", "sub 2", { sectionId: "s1", parentId: "m5" }));
  const bigSnap = { tasks: many, projects, sections };
  const { records } = E.targetRecords({
    snapshot: bigSnap, target: { kind: "section", id: "s1", name: "Ethics", projectId: "p1" }, taskUrl
  });
  assert.strictEqual(records.length, 62, "60 tasks + 2 subtasks, no cap or budget");
  console.log("PASS targetRecords section pull returns all 60 tasks plus subtasks");
}
{
  // DEFECT 1: duplicate open id emitted once, first occurrence kept
  const dupSnap = { tasks: [...tasks, T("t1", "Write draft again", { sectionId: "s1" })], projects, sections };
  const { records } = E.targetRecords({ snapshot: dupSnap, target: { kind: "section", id: "s1", name: "Ethics", projectId: "p1" }, taskUrl });
  const ids = records.map((r) => r.id);
  assert.strictEqual(ids.filter((id) => id === "t1").length, 1, "t1 emitted once: " + JSON.stringify(ids));
  assert.strictEqual(records.find((r) => r.id === "t1").title, "Write draft", "first occurrence kept: " + JSON.stringify(ids));
  console.log("PASS targetRecords duplicate open id emitted once");
}
{
  // DEFECT 1: same id in open and completed arrays emitted once, open version kept
  const completed = [T("t2", "Done review", { sectionId: "s1", completedAt: "2026-10-20T10:00:00" })];
  const { records, skippedCompleted } = E.targetRecords({
    snapshot: snap, completed, target: { kind: "section", id: "s1", name: "Ethics", projectId: "p1" }, taskUrl, includeCompleted: true
  });
  assert.deepStrictEqual(records.map((r) => r.id), ["t1", "t2", "t3"]);
  assert.strictEqual(records.find((r) => r.id === "t2").status, "open", "open version kept");
  assert.strictEqual(skippedCompleted, 1, "completed duplicate of an open id is skipped and counted");
  console.log("PASS targetRecords open+completed same id emitted once, open version kept");
}
{
  // DEFECT 2: task pull - completed item sharing section/project with a different parent is not attached
  const completed = [
    T("c1", "Done elsewhere", { sectionId: "s1", projectId: "p1", completedAt: "2026-10-20T10:00:00" }),
    T("c2", "Done under unrelated parent", { sectionId: "s1", projectId: "p1", parentId: "t99", completedAt: "2026-10-20T11:00:00" }),
  ];
  const { records, skippedCompleted } = E.targetRecords({
    snapshot: snap, completed, target: { kind: "task", id: "t1", name: "Write draft", projectId: "p1" }, taskUrl, includeCompleted: true
  });
  assert.deepStrictEqual(records.map((r) => r.id), ["t1", "t2", "t3"]);
  assert.strictEqual(skippedCompleted, 2, "completed items outside the target tree are skipped and counted");
  console.log("PASS targetRecords task pull ignores completed items not parented to the target tree");
}
{
  // DEFECT 2: task pull - completed child attached by parentId (real shape carries parentId)
  const completed = [T("c1", "Done sub-review", { sectionId: "s1", parentId: "t2", completedAt: "2026-10-20T10:00:00" })];
  const { records, skippedCompleted } = E.targetRecords({
    snapshot: snap, completed, target: { kind: "task", id: "t1", name: "Write draft", projectId: "p1" }, taskUrl, includeCompleted: true
  });
  assert.deepStrictEqual(records.map((r) => r.id), ["t1", "t2", "t3", "c1"]);
  assert.strictEqual(records.find((r) => r.id === "c1").status, "done");
  assert.strictEqual(skippedCompleted, 0);
  console.log("PASS targetRecords task pull attaches completed child by parentId");
}
{
  // DEFECT 2: completed item parented to the target task itself attaches even from another section
  const completed = [T("c1", "Done under parent", { sectionId: "s2", parentId: "t1", completedAt: "2026-10-20T10:00:00" })];
  const { records, skippedCompleted } = E.targetRecords({
    snapshot: snap, completed, target: { kind: "task", id: "t1", name: "Write draft", projectId: "p1" }, taskUrl, includeCompleted: true
  });
  assert.deepStrictEqual(records.map((r) => r.id), ["t1", "t2", "t3", "c1"]);
  assert.strictEqual(skippedCompleted, 0);
  console.log("PASS targetRecords task pull attaches completed item parented to the target task");
}

// ---------- renderPullList ----------
{
  const { records } = E.targetRecords({
    snapshot: snap, target: { kind: "section", id: "s1", name: "Ethics", projectId: "p1" }, taskUrl
  });
  const out = E.renderPullList(records);
  const lines = out.split("\n");
  assert.strictEqual(lines.length, 3, out);
  assert.ok(/^- \[Write draft\]\(https:\/\/app\.todoist\.com\/app\/task\/t1\) \u00b7 open$/.test(lines[0]), lines[0]);
  assert.ok(/^ {2}- \[Review draft\]\(https:\/\/app\.todoist\.com\/app\/task\/t2\) \u00b7 open$/.test(lines[1]), lines[1]);
  assert.ok(/^ {2}- \[Edit draft\]\(https:\/\/app\.todoist\.com\/app\/task\/t3\) \u00b7 open$/.test(lines[2]), lines[2]);
  assert.ok(!/\[[ xX]\]/.test(out), "no checkboxes");
  assert.ok(!/#STsync/.test(out), "no STsync");
  assert.ok(!/oid:/.test(out), "no oid markers");
  console.log("PASS renderPullList plain bullets with indentation");
}
{
  const doneRec = mkRec("c2", "Done ethics", { status: "done", completedAt: "2026-10-20T10:00:00", sectionName: "Ethics" });
  const out = E.renderPullList([doneRec]);
  assert.ok(out.includes("· done Oct 20"), out);
  assert.ok(!/done · done/.test(out), "status word printed once: " + out);
  console.log("PASS renderPullList done shows done label once");
}
{
  const openRec = mkRec("t4", "Methods task", { status: "open", due: "2026-11-02", sectionName: "Methods" });
  const overdueRec = mkRec("t5", "Data sub task", { projectId: "p3", sectionId: "s3", status: "overdue", due: "2026-10-01", sectionName: "Data" });
  const out = E.renderPullList([openRec, overdueRec]);
  assert.ok(out.includes("· open · due Nov 2"), out);
  assert.ok(out.includes("· overdue · due Oct 1"), out);
  assert.ok(!/done · done/.test(out), out);
  console.log("PASS renderPullList open and overdue suffixes unchanged");
}
{
  const manual = [
    mkRec("t2", "Review draft", { parentId: "t1", parentTitle: "Write draft" }),
    mkRec("t4", "Methods task", { parentId: "" }),
  ];
  const out = E.renderPullList(manual);
  const lines = out.split("\n");
  assert.strictEqual(lines.length, 2, out);
  assert.ok(lines[0].startsWith("- "), lines[0]);
  assert.ok(!lines[0].startsWith("  "), lines[0]);
  assert.ok(lines[1].startsWith("- "), lines[1]);
  console.log("PASS renderPullList orphan child renders top level");
}
{
  const nested = [
    mkRec("t1", "Write draft", { parentId: "", sectionName: "Ethics" }),
    mkRec("t2", "Review draft", { parentId: "t1", parentTitle: "Write draft", sectionName: "Ethics" }),
    mkRec("sub", "grandchild", { parentId: "t2", parentTitle: "Review draft", sectionName: "Ethics" }),
  ];
  const out = E.renderPullList(nested);
  const lines = out.split("\n");
  assert.strictEqual(lines.length, 3, out);
  assert.ok(lines[0].startsWith("- "), lines[0]);
  assert.ok(lines[1].startsWith("  - "), lines[1]);
  assert.ok(lines[2].startsWith("    - "), lines[2]);
  console.log("PASS renderPullList nested descendants any depth");
}
{
  const multi = [
    mkRec("t1", "Write draft", { sectionName: "Ethics" }),
    mkRec("t4", "Methods task", { sectionName: "Methods" }),
  ];
  const out = E.renderPullList(multi);
  assert.ok(out.includes("**Ethics**"), out);
  assert.ok(out.includes("**Methods**"), out);
  assert.ok(out.indexOf("**Ethics**") < out.indexOf("**Methods**"), "first-appearance order");
  console.log("PASS renderPullList section headers in first-appearance order");
}
{
  const single = E.renderPullList([mkRec("t1", "Write draft", { sectionName: "Ethics" }), mkRec("t2", "Review draft", { sectionName: "Ethics" })]);
  assert.ok(!/\*\*/.test(single), single);
  console.log("PASS renderPullList no header for single section");
}
{
  const out = E.renderPullList([
    mkRec("x", "no section task", { sectionName: "" }),
    mkRec("t1", "Write draft", { sectionName: "Ethics" }),
  ]);
  assert.ok(out.includes("**No section**"), out);
  assert.ok(out.includes("**Ethics**"), out);
  assert.ok(out.indexOf("**No section**") < out.indexOf("**Ethics**"), out);
  console.log("PASS renderPullList no section header");
}
{
  assert.strictEqual(E.renderPullList([]), "");
  assert.strictEqual(E.renderPullList(undefined), "");
  console.log("PASS renderPullList empty");
}

// ---------- existing exports unchanged ----------
{
  assert.strictEqual(typeof E.buildTaskRecords, "function");
  assert.strictEqual(typeof E.renderTaskList, "function");
  assert.strictEqual(typeof E.budgetRecords, "function");
  const { records } = E.buildTaskRecords({ snapshot: snap, taskUrl });
  assert.deepStrictEqual(records.map((r) => r.id), ["t1", "t2", "t3", "t4", "t5", "t6"]);
  console.log("PASS existing exports still behave");
}
