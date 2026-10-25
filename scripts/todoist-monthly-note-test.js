"use strict";
const assert = require("assert");
const m = require("../src/todoist/monthly-note.js");

const T = (c, oid, p) => `- [ ] ${c} #sync !!4${p ? ` %%[p:: ${p}]%%` : ""} %%[oid:: ${oid}]%%`;
let n = 0;
function test(name, fn) { fn(); console.log(`PASS ${name}`); n++; }

test("path uses YYYY-MM Tasks.md", () => {
  assert.strictEqual(m.monthlyNotePath("Semantic Todoist Sync/Miscellaneous Tasks/", new Date(2026, 9, 25)),
    "Semantic Todoist Sync/Miscellaneous Tasks/2026-10 Tasks.md");
});
test("no headings pre-created", () => {
  const t = m.newMonthlyNote();
  assert.ok(!/^#/m.test(t));
  assert.strictEqual(t.split(/\r?\n/).filter((l) => /kept in step/.test(l)).length, 1);
});
test("first task creates its heading", () => {
  const out = m.insertTaskBlock(m.newMonthlyNote(), "Home", [T("a", "A1", "Home")]);
  assert.ok(/\n## Home\r?\n- \[ \] a /.test(out), out);
});
test("Inbox task goes under ## Inbox", () => {
  const out = m.insertTaskBlock(m.newMonthlyNote(), "", [T("a", "A1")]);
  assert.ok(/## Inbox\n- \[ \] a /.test(out), out);
});
test("move carries subtasks and removes emptied heading", () => {
  let t = m.insertTaskBlock(m.newMonthlyNote(), "Home", [T("a", "A1", "Home"), "    - [ ] sub #sync %%[oid:: S1]%%"]);
  t = m.insertTaskBlock(t, "Home", [T("b", "B1", "Home")]);
  const out = m.moveTaskBlock(t, "A1", "Work");
  assert.ok(/## Home\n- \[ \] b /.test(out), out);
  assert.ok(/## Work\n- \[ \] a [^\n]*%%\[p:: Work\]%%[^\n]*\n    - \[ \] sub/.test(out), out);
  const out2 = m.moveTaskBlock(out, "B1", "Work");
  assert.ok(!/## Home/.test(out2), out2);
});
test("line dragged under wrong heading put back by marker", () => {
  const t = `Intro\n\n## Home\n${T("a", "A1", "Home")}\n\n## Work\n${T("b", "B1", "Work")}\n${T("c", "C1", "Home")}\n    - [ ] sub #sync %%[oid:: S1]%%\n`;
  const out = m.reconcileHeadings(t);
  assert.strictEqual(out, `Intro\n\n## Home\n${T("a", "A1", "Home")}\n${T("c", "C1", "Home")}\n    - [ ] sub #sync %%[oid:: S1]%%\n\n## Work\n${T("b", "B1", "Work")}\n`);
});
test("project name ampersand and emoji round-trips", () => {
  const p = "R&D / Q#1 🚀";
  let t = m.insertTaskBlock(m.newMonthlyNote(), p, [T("a", "A1", p)]);
  assert.ok(t.includes(`## ${p}\n`));
  assert.strictEqual(m.reconcileHeadings(t), t);
  t = m.moveTaskBlock(t, "A1", "Home");
  t = m.moveTaskBlock(t, "A1", p);
  assert.ok(t.includes(`## ${p}\n- [ ] a`) && t.includes(`%%[p:: ${p}]%%`));
});
test("move keeps unrelated user text byte-identical", () => {
  const pre = "My notes\n\n  odd   spacing\t\n\n";
  const post = "\n## Misc\nuser text here  \n";
  const t = `${pre}## Home\n${T("a", "A1", "Home")}\n${post}`;
  const out = m.moveTaskBlock(t, "A1", "Work");
  assert.ok(out.startsWith(pre) && out.includes(post), out);
});
test("CRLF input stays CRLF", () => {
  let t = m.insertTaskBlock(m.newMonthlyNote().replace(/\n/g, "\r\n"), "Home", [T("a", "A1", "Home")]);
  t = m.moveTaskBlock(t, "A1", "Work");
  assert.ok(!/(^|[^\r])\n/.test(t), JSON.stringify(t));
  assert.ok(t.includes("## Work\r\n"));
});
test("U+2028 project name terminates with a readable heading", () => {
  // child process + timeout so a hang fails instead of blocking
  const code = `const m=require(${JSON.stringify(require.resolve("../src/todoist/monthly-note.js"))});` +
    `process.stdout.write(m.reconcileHeadings("## Home\\n- [ ] a #sync %%[p:: A\\u2028B]%% %%[oid:: A1]%%\\n"))`;
  const r = require("child_process").spawnSync(process.execPath, ["-e", code], { encoding: "utf8", timeout: 5000 });
  assert.ok(!r.error, `hung or failed: ${r.error}`);
  assert.ok(/## A B\n- \[ \] a [^\n]*%%\[p:: A\s+B\]%%/.test(r.stdout) && !/## Home/.test(r.stdout), r.stdout);
});
test("padded project name gives a trimmed marker", () => {
  const t = m.insertTaskBlock(m.newMonthlyNote(), "Home", [T("a", "A1", "Home")]);
  const out = m.moveTaskBlock(t, "A1", "  Work  ");
  assert.ok(out.includes("%%[p:: Work]%%") && out.includes("## Work\n"), out);
});
test("unrelated empty heading survives a move", () => {
  const t = `## Ideas\n\n## Home\n${T("a", "A1", "Home")}\n`;
  const out = m.moveTaskBlock(t, "A1", "Work");
  assert.ok(out.startsWith("## Ideas\n\n") && !out.includes("## Home"), out);
});
test("fenced code is ignored: no headings, no moves, byte-identical", () => {
  const fence = "```\n## Fake\n- [ ] example in code #sync %%[p:: Home]%% %%[oid:: BBBBB]%%\n```";
  const t = `Kept in step.\n## Home\n${T("real", "AAAAA", "Work")}\n${fence}\n`;
  const out = m.reconcileHeadings(t);
  assert.ok(out.includes(fence), out);
  assert.ok(out.includes("## Work\n- [ ] real"), out);
  assert.strictEqual(m.reconcileHeadings(out), out);
  const tilde = fence.replace(/```/g, "~~~~");
  assert.ok(m.reconcileHeadings(t.replace(fence, tilde)).includes(tilde));
});
test("fenced oid line is not a move target; unclosed fence runs to end", () => {
  const f = "```\n- [ ] x #sync %%[oid:: BBBBB]%%\n```";
  const t = `## Home\n${T("a", "A1", "Home")}\n${f}\n`;
  assert.strictEqual(m.moveTaskBlock(t, "BBBBB", "Work"), t);
  const open = `## Home\n${T("a", "A1", "Work")}\n\`\`\`\n## Fake\n`;
  assert.ok(m.reconcileHeadings(open).includes("```\n## Fake\n"), m.reconcileHeadings(open));
});
test("pre-heading task line is placed by marker; intro text untouched", () => {
  const t = `Intro line.\n${T("a", "A1", "Work")}\n`;
  const out = m.reconcileHeadings(t);
  assert.ok(out.startsWith("Intro line.\n") && out.includes("## Work\n- [ ] a"), out);
});console.log(`${n} passed`);
