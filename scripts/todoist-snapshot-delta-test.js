"use strict";
// Pure merge of a Todoist /sync delta into the previous raw rows.
const assert = require("node:assert/strict");
const { mergeSyncResponse } = require("../src/todoist/snapshot-delta.js");

const prev = () => ({
  items: [{ id: "1", content: "A" }, { id: "2", content: "B" }],
  projects: [{ id: "p1", name: "Home" }],
  sections: [{ id: "s1", name: "Soon", project_id: "p1" }]
});
const ids = (rows) => rows.map((r) => r.id).sort();
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("no previous rows is a full replace of the response", () => {
  const out = mergeSyncResponse(null, { items: [{ id: "9", content: "Z" }], projects: [], sections: [] });
  assert.equal(out.full, true);
  assert.deepEqual(ids(out.raw.items), ["9"]);
});
test("changed task is upserted and a new one is added", () => {
  const out = mergeSyncResponse(prev(), { items: [{ id: "1", content: "A2" }, { id: "3", content: "C" }] });
  assert.equal(out.full, false);
  assert.deepEqual(out.raw.items.map((r) => r.content).sort(), ["A2", "B", "C"]);
});
test("is_deleted task is removed", () => {
  const out = mergeSyncResponse(prev(), { items: [{ id: "2", is_deleted: true }] });
  assert.deepEqual(ids(out.raw.items), ["1"]);
});
test("task completed in the delta leaves the snapshot, as a full sync omits it", () => {
  for (const flag of ["checked", "is_completed"]) {
    const out = mergeSyncResponse(prev(), { items: [{ id: "1", content: "A", [flag]: true }] });
    assert.deepEqual(ids(out.raw.items), ["2"], flag);
  }
});
test("reopened task comes back", () => {
  const out = mergeSyncResponse(prev(), { items: [{ id: "7", content: "Back", checked: false }] });
  assert.deepEqual(ids(out.raw.items), ["1", "2", "7"]);
});
test("project and section upsert, delete and archive", () => {
  const out = mergeSyncResponse(prev(), {
    projects: [{ id: "p1", name: "House" }, { id: "p2", name: "New" }],
    sections: [{ id: "s1", is_deleted: true }, { id: "s2", name: "X", project_id: "p2" }]
  });
  assert.deepEqual(out.raw.projects.map((r) => r.name).sort(), ["House", "New"]);
  assert.deepEqual(ids(out.raw.sections), ["s2"]);
  const gone = mergeSyncResponse(prev(), { projects: [{ id: "p1", is_archived: true }] });
  assert.deepEqual(gone.raw.projects, []);
});
test("deleting an unknown id and rows without id change nothing", () => {
  const out = mergeSyncResponse(prev(), { items: [{ id: "404", is_deleted: true }, { content: "no id" }] });
  assert.deepEqual(out.raw, prev());
});
test("empty delta keeps the snapshot and does not mutate the input", () => {
  const before = prev();
  const out = mergeSyncResponse(before, { sync_token: "t", full_sync: false });
  assert.deepEqual(out.raw, prev());
  assert.deepEqual(before, prev());
});
test("full_sync: true replaces instead of merging", () => {
  const out = mergeSyncResponse(prev(), { full_sync: true, items: [{ id: "5", content: "E" }], projects: [], sections: [] });
  assert.equal(out.full, true);
  assert.deepEqual(out.raw, { items: [{ id: "5", content: "E" }], projects: [], sections: [] });
});
test("garbage response is treated as an empty delta", () => {
  assert.deepEqual(mergeSyncResponse(prev(), null).raw, prev());
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed += 1; console.error(`FAIL - ${name}\n${e.stack}`); }
  }
  console.log(`${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exit(1);
})();
