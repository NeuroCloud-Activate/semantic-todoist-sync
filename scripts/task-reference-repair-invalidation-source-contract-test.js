"use strict";
// The task-reference repair swaps in rebuilt Todoist rows (new evidence IDs) and must invalidate the
// retrieval caches like every other index swap. Without it the revision stays put, the cached routing
// state keeps the old row IDs, and the next task generation fails the coverage proof with
// protected-workflow-evidence-closure-unresolved (live repro: generate on note A, then note B at once).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const start = source.indexOf("async runSemanticTaskReferenceRepair(");
assert.ok(start > 0, "runSemanticTaskReferenceRepair not found");
const body = source.slice(start, source.indexOf("\n  async ", start + 10));
const swap = body.indexOf("this.semanticIndex = candidate;");
const save = body.indexOf("await this.saveSemanticIndex()", swap);
assert.ok(swap > 0 && save > swap, "repair swap/save not found");
assert.match(body.slice(swap, save), /this\.invalidateSemanticRetrievalCache\(\);/,
  "task-reference repair must invalidate retrieval caches after swapping the index");
console.log("PASS: task-reference repair invalidates retrieval caches after the index swap");
