"use strict";

// Task 1 (pure Todoist evidence helpers) - plain node + assert, prints `PASS <case>`.
process.env.TZ = "America/New_York"; // before any Date use
const assert = require("assert");
const E = require("../src/writing/todoist-evidence.js");

const NOW = new Date(2026, 9, 29, 12, 0, 0);
const taskUrl = (id) => `https://app.todoist.com/app/task/${id}`;
const T = (id, o = {}) => ({ id, content: `Task ${id}`, description: "", parentId: "", sectionId: "", projectId: "p1", labels: [], priority: 1, dueDate: "", deadlineDate: "", ...o });
const snap = (tasks) => ({ tasks, projects: [{ id: "p1", name: "Thesis" }, { id: "p2", name: "Grants" }], sections: [{ id: "s1", name: "Ethics" }] });
const build = (tasks, completed = [], extra = {}) => E.buildTaskRecords({ snapshot: snap(tasks), completed, now: NOW, taskUrl, ...extra });
const rec = (id, o = {}) => ({ id, title: `Task ${id}`, projectId: "p1", projectName: "Thesis", sectionName: "", parentId: "", parentTitle: "", status: "open", due: "", deadline: "", priority: 1, labels: [], completedAt: "", description: "", notePaths: [], url: taskUrl(id), ...o });

// status
assert.strictEqual(E.taskStatus({ dueDate: "2026-10-28" }, NOW), "overdue");
assert.strictEqual(E.taskStatus({ dueDate: "2026-11-05" }, NOW), "due-soon");
assert.strictEqual(E.taskStatus({ dueDate: "2026-11-06" }, NOW), "open");
assert.strictEqual(E.taskStatus({}, NOW), "open");
assert.strictEqual(E.taskStatus({ dueDate: "2026-10-28", completedAt: "2026-10-27T10:00:00" }, NOW), "done");
console.log("PASS status");

// window
{
  const { records } = build([], [T("a", { completedAt: "2026-10-14T23:00:00" }), T("b", { completedAt: "2026-10-15T01:00:00" })], { completedDays: 14 });
  assert.deepStrictEqual(records.map((r) => r.id), ["b"]);
  assert.strictEqual(records[0].status, "done");
  assert.strictEqual(records[0].url, taskUrl("b"));
  console.log("PASS window");
}

// projects scope
{
  const tasks = [T("a"), T("b", { projectId: "p2" })];
  const ok = build(tasks, [], { projects: ["thesis"] });
  assert.deepStrictEqual(ok.records.map((r) => r.id), ["a"]);
  assert.deepStrictEqual(ok.unknownProjects, []);
  const none = build(tasks, [], { projects: ["Nope"] });
  assert.deepStrictEqual(none.records, []);
  assert.deepStrictEqual(none.unknownProjects, ["Nope"]);
  console.log("PASS projects scope");
}

// unknown project
{
  const { records } = build([], [T("a", { projectId: "gone", completedAt: "2026-10-20T10:00:00" })]);
  assert.strictEqual(records[0].projectName, "Unknown project");
  console.log("PASS unknown project");
}

// description
{
  const long = "x".repeat(900);
  const d = `${long}\nContext Notes:\n- [A](obsidian://open?file=Notes%2FA.md)\n- [B](obsidian://open?vault=V&file=Notes%2FB%20b.md)\nSecret tail`;
  const { records } = build([T("a", { description: d, sectionId: "s1" })]);
  const r = records[0];
  assert.ok(r.description.length <= 600 && !/Context Notes|Secret tail|obsidian:/.test(r.description));
  assert.deepStrictEqual(r.notePaths, ["Notes/A.md", "Notes/B b.md"]);
  assert.strictEqual(r.sectionName, "Ethics");
  assert.deepStrictEqual(E.notePathsFromDescription("Sources:\n[A](obsidian://open?file=Notes%2FA.md)"), ["Notes/A.md"]);
  console.log("PASS description");
}

// follow-ups
{
  const C = rec("C", { status: "done", completedAt: "2026-10-20T10:00:00", notePaths: ["Notes/A.md"] });
  const C2 = rec("C2", { status: "done", completedAt: "2026-10-21T10:00:00", parentId: "PP" });
  const O1 = rec("O1", { parentId: "C" });
  const O2 = rec("O2", { labels: ["#followup"], projectId: "p3", projectName: "Other" });
  const O2b = rec("O2b", { labels: ["#followup"] });
  const O3 = rec("O3", { notePaths: ["Notes/A.md"] });
  const O4 = rec("O4", { parentId: "PP", notePaths: ["Notes/A.md"] });
  const m = E.followUpMap([C, C2, O1, O2, O2b, O3, O4]);
  assert.deepStrictEqual(m.get("C"), ["O1", "O2b", "O3"]);
  assert.deepStrictEqual(m.get("C2"), ["O4"]);
  assert.ok(![...m.values()].some((v) => v.includes("O2")));
  console.log("PASS follow-ups");
}
// groupByProject order
{
  const g = E.groupByProject([rec("a", { projectId: "p1", projectName: "Zeta" }), rec("b", { projectId: "p2", projectName: "Beta" }), rec("c", { projectId: "p3", projectName: "Alpha" }), rec("d", { projectId: "p3", projectName: "Alpha" }), rec("e", { projectId: "p4", projectName: "Done", status: "done" })]);
  assert.deepStrictEqual(g.map((x) => x.projectName), ["Alpha", "Beta", "Zeta", "Done"]);
  assert.strictEqual(g[0].records.length, 2);
  console.log("PASS groupByProject order");
}

// budget
{
  const rs = [rec("rest"), rec("done", { status: "done", completedAt: "2026-10-20" }), rec("match", { title: "Ethics form" }), rec("soon", { status: "due-soon" }), rec("over", { status: "overdue" })];
  const all = E.budgetRecords(rs, "ethics", 100000);
  assert.deepStrictEqual(all.kept.map((r) => r.id), ["over", "soon", "done", "match", "rest"]);
  assert.strictEqual(all.dropped, 0);
  const one = E.taskEvidenceText(rs[4]).length;
  const small = E.budgetRecords(rs, "ethics", one * 2 + 5);
  assert.ok(small.kept.length < rs.length && small.kept[0].id === "over");
  assert.strictEqual(small.dropped, rs.length - small.kept.length);
  console.log("PASS budget");
}

// renderTaskList
{
  const C = rec("C", { status: "done", completedAt: "2026-10-20T10:00:00", due: "2026-10-18" });
  const O1 = rec("O1", { parentId: "C", status: "overdue", due: "2026-10-24" });
  const W = rec("W", { title: "[x] | y\nz" });
  const X = rec("X", { title: "xy" });
  const out = E.renderTaskList([C, O1, W, X], E.followUpMap([C, O1, W, X]));
  const lines = out.split("\n");
  assert.strictEqual(lines.length, 4);
  assert.ok(/^- \[[^\]\n]+\]\(https?:\/\//.test(lines[0]));
  assert.ok(/^ {2}- \[[^\]\n]+\]\(https?:\/\/[^)]+\) \u00b7 overdue \u00b7 due Oct 24$/.test(lines[1]), lines[1]);
  assert.ok(/^- \[(?:\\.|[^\]\\])+\]\(https?:\/\/[^)]+\)/.test(lines[2]) && lines[2].includes("\\[x\\] | y z"), lines[2]);
  assert.ok(lines.every((l) => !/^\s*[-*]\s+\[[ xX]\]/.test(l)), out);
  assert.ok(!/oid:|todoist-id/.test(out));
  console.log("PASS renderTaskList");
}

// review fixes
{
  const enc = (p) => `[A](obsidian://open?file=${encodeURIComponent(p)})`;
  assert.deepStrictEqual(E.notePathsFromDescription(enc("Notes/A (1).md")), ["Notes/A (1).md"]);
  assert.deepStrictEqual(E.notePathsFromDescription(enc("Notes/Bob's.md")), ["Notes/Bob's.md"]);
  assert.deepStrictEqual(E.notePathsFromDescription(`${enc("Notes/A (1).md")} and [B](obsidian://open?vault=V&file=Notes%2FB.md)`), ["Notes/A (1).md", "Notes/B.md"]);
  console.log("PASS note paths with parens and apostrophes");
}
{
  const done = rec("D", { status: "done", completedAt: "2026-10-21T02:00:00Z" });
  assert.ok(E.renderTaskList([done], new Map()).endsWith("done Oct 20"), E.renderTaskList([done], new Map()));
  assert.ok(E.taskEvidenceText(done).includes("completed 2026-10-20"), E.taskEvidenceText(done));
  console.log("PASS done date uses local day");
}
{
  const ago = (n) => new Date(2026, 9, 29 - n, 10).toISOString();
  const ids = (days) => build([], [{ id: "x2", content: "a", projectId: "p1", completedAt: ago(2) }, { id: "x80", content: "b", projectId: "p1", completedAt: ago(80) }, { id: "x100", content: "c", projectId: "p1", completedAt: ago(100) }], { completedDays: days }).records.map((r) => r.id);
  assert.deepStrictEqual(ids(NaN), ["x2"]);
  assert.deepStrictEqual(ids(1000), ["x2", "x80"]);
  assert.deepStrictEqual(ids(0), ["x2"].filter(() => false));
  console.log("PASS completedDays guard");
}
{
  const { records } = build([], [{ id: "f", content: "future", projectId: "p1", completedAt: "2026-10-30T10:00:00" }]);
  assert.deepStrictEqual(records.map((r) => r.id), ["f"]);
  console.log("PASS later completions kept");
}
{
  const d = "Real\nsource list: x\nSOURCES:\nz";
  assert.strictEqual(build([T("s", { description: "Real\nSource List:\n- a" })]).records[0].description, "Real");
  assert.strictEqual(build([T("s", { description: "Real\nSOURCES:\n- a" })]).records[0].description, "Real");
  console.log("PASS stripSources case-insensitive");
}
{
  const rs = [rec("a", { title: "a" }), rec("b", { title: "b".repeat(300) }), rec("c", { title: "c" })];
  const res = E.budgetRecords(rs, "", E.taskEvidenceText(rs[0]).length + E.taskEvidenceText(rs[2]).length + 5);
  assert.deepStrictEqual(res.kept.map((r) => r.id), ["a", "c"]);
  assert.strictEqual(res.dropped, 1);
  console.log("PASS budget skips oversized");
}
{
  assert.ok(!/priority/.test(E.taskEvidenceText(rec("p", { priority: 1 }))));
  assert.ok(E.taskEvidenceText(rec("p", { priority: 4 })).includes("priority p1"));
  assert.ok(E.taskEvidenceText(rec("p", { priority: 2 })).includes("priority p3"));
  console.log("PASS priority label");
}
{
  for (const title of ["x", "X", " ", ""]) {
    const out = E.renderTaskList([rec("Q", { title })], new Map());
    assert.ok(!/^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[.\]/.test(out), `checkbox-like: ${JSON.stringify(title)} -> ${out}`);
    assert.ok(!/^\s*[-*]\s+\[[ xX]\]/.test(out), out);
  }
  assert.ok(E.renderTaskList([rec("Q", { title: " " })], new Map()).includes("(untitled task)"));
  console.log("PASS checkbox-like titles are escaped");
}
