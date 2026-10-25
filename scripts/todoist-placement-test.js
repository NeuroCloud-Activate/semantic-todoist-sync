"use strict";

// Task 7 wave 1: choosePlacement. Plain node + assert; prints `PASS <case>`.
const assert = require("assert");
const { choosePlacement } = require("../src/todoist/placement.js");

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('"this note" goes to the active note', () => {
  const r = choosePlacement({ content: "x", placement: { kind: "active" } }, { activePath: "A/n.md", namedPaths: [] });
  assert.strictEqual(r.path, "note");
  assert.strictEqual(r.notePath, "A/n.md");
  assert.ok(r.reason);
});

test("active request with no open note goes monthly", () => {
  const r = choosePlacement({ placement: { kind: "active" } }, { activePath: "", namedPaths: [] });
  assert.strictEqual(r.path, "monthly");
  assert.strictEqual(r.notePath, undefined);
});

test("one named note goes to it", () => {
  const r = choosePlacement({ placement: { kind: "named", paths: ["B/one.md"] } }, { activePath: "A/n.md", namedPaths: ["B/one.md"] });
  assert.deepStrictEqual([r.path, r.notePath], ["note", "B/one.md"]);
});

test("one named note via namedPaths option when row has no paths", () => {
  const r = choosePlacement({ placement: { kind: "named" } }, { activePath: "A/n.md", namedPaths: ["B/one.md"] });
  assert.deepStrictEqual([r.path, r.notePath], ["note", "B/one.md"]);
});

test("several named notes go monthly", () => {
  const r = choosePlacement({ placement: { kind: "named", paths: ["B/1.md", "B/2.md"] } }, { activePath: "A/n.md", namedPaths: ["B/1.md", "B/2.md"] });
  assert.strictEqual(r.path, "monthly");
});

test("none or missing placement goes monthly", () => {
  for (const row of [{ placement: { kind: "none" } }, {}, { placement: null }]) {
    assert.strictEqual(choosePlacement(row, { activePath: "A/n.md", namedPaths: [] }).path, "monthly");
  }
});

test("subtask goes under parent's line wherever it is", () => {
  const r = choosePlacement({ op: "create", target: { parentId: "t1" }, placement: { kind: "active" } }, { activePath: "A/n.md", namedPaths: [], parentLine: { path: "Z/parent.md" } });
  assert.deepStrictEqual([r.path, r.notePath], ["note", "Z/parent.md"]);
});

test("top-level parentId alias still counts as subtask", () => {
  const r = choosePlacement({ parentId: "t1", placement: { kind: "active" } }, { activePath: "A/n.md", namedPaths: [], parentLine: { path: "Z/parent.md" } });
  assert.deepStrictEqual([r.path, r.notePath], ["note", "Z/parent.md"]);
});

test("subtask with no parent line goes monthly under project", () => {
  const r = choosePlacement({ op: "create", target: { parentId: "t1" }, placement: { kind: "active" } }, { activePath: "A/n.md", namedPaths: [] });
  assert.strictEqual(r.path, "monthly");
});

test("a named path the plugin did not supply is ignored -> monthly note", () => {
  const r = choosePlacement({ placement: { kind: "named", paths: ["Evil/x.md"] } }, { activePath: "A/n.md", namedPaths: ["B/one.md"] });
  assert.strictEqual(r.path, "monthly");
});

test("duplicate named paths collapse to one note", () => {
  const r = choosePlacement({ placement: { kind: "named", paths: ["B/one.md", "B/one.md"] } }, { activePath: "A/n.md", namedPaths: ["B/one.md"] });
  assert.deepStrictEqual([r.path, r.notePath], ["note", "B/one.md"]);
});

let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n${e.stack}`); }
}
process.exit(failed ? 1 : 0);
