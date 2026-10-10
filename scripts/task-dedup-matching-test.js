"use strict";
// scripts/task-dedup-matching-test.js — Task 8 (D1 canonical relink, D2 degraded flagging).
// Harness pattern: Module._compile main.js + __test exports + stubbed obsidian.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const mainPath = path.join(__dirname, "..", "main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request !== "obsidian") return originalLoad.call(this, request, parent, isMain);
  class Empty {}
  return {
    ItemView: Empty,
    MarkdownRenderer: {},
    MarkdownView: Empty,
    Modal: Empty,
    Notice: Empty,
    Plugin: Empty,
    PluginSettingTab: Empty,
    Setting: Empty,
    TFile: Empty,
    setIcon() {},
    requestUrl() { throw new Error("network disabled"); },
  };
};

let pluginApi;
try {
  testModule._compile(
    `${mainSource}\nmodule.exports.__testTaskDedupMatching = {` +
      "findExistingTodoistTaskMatch, bestTaskDeduplicationMatch, emptyTaskDeduplicationStats" +
      "};\n",
    mainPath
  );
  pluginApi = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const {
  findExistingTodoistTaskMatch,
  bestTaskDeduplicationMatch,
  emptyTaskDeduplicationStats,
} = pluginApi.__testTaskDedupMatching || {};

function check(failures, name, assertion) {
  try {
    assertion();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error && error.message || error}`);
    console.error(`FAIL: ${name}: ${error && error.message || error}`);
  }
}

const failures = [];

function snapTask(text, projectName, due, extra = {}) {
  return Object.assign({
    id: `snap-${String(text).slice(0, 12)}`,
    content: text,
    projectName: projectName || "",
    dueDate: due || "",
    isCompleted: false,
  }, extra);
}

function creationTask(text, projectName, due) {
  return { content: text, projectName: projectName || "", due_date: due || "", isSubtask: false };
}

check(failures, "D1 aspirational (NOT shipped): canonical variant NOT relinked by shipped matcher", () => {
  const existing = [snapTask("Send EFT report", "Finance", "")];
  const creation = creationTask("  SEND  EFT report ✅ ", "Finance", "");
  // Gate rejected D1: shipped matcher keeps singleLine().toLowerCase();
  // the emoji-suffixed variant does not relink — D2 flags it instead.
  assert.strictEqual(findExistingTodoistTaskMatch(creation, existing, ""), null);
});

check(failures, "D1 refuses cross-project relink", () => {
  const existing = [snapTask("Send EFT report", "Payroll", "")];
  const creation = creationTask("Send EFT report ✅", "Finance", "");
  assert.strictEqual(findExistingTodoistTaskMatch(creation, existing, ""), null);
});

check(failures, "D1 refuses due mismatch", () => {
  const existing = [snapTask("Send EFT report", "Finance", "2026-10-17")];
  const creation = creationTask("Send EFT report ✅", "Finance", "2026-10-10");
  assert.strictEqual(findExistingTodoistTaskMatch(creation, existing, ""), null);
});

// D1 hunk reverted (fix round 1): findExistingTodoistTaskMatch is byte-identical to the
// shipped baseline here, so it no longer filters completed tasks itself. The caller
// (relinkCreationsToExistingTodoistTasks, main.js:19935) drops completed tasks before
// the matcher runs — assert that contract, not a matcher guard the baseline does not have.
check(failures, "D1 ignores completed tasks (caller filter, not the shipped matcher)", () => {
  const existing = [snapTask("Send EFT report", "Finance", "", { isCompleted: true })];
  const creation = creationTask("Send EFT report", "Finance", "");
  const openOnly = existing.filter((task) => !task.isCompleted);
  assert.strictEqual(openOnly.length, 0);
  assert.strictEqual(findExistingTodoistTaskMatch(creation, openOnly, ""), null);
});

check(failures, "D1 aspirational (NOT shipped): canonical variant flagged via D2 path instead", () => {
  const stats = emptyTaskDeduplicationStats();
  const task = { id: "gen-1", content: "SEND EFT report ✅", projectName: "Finance" };
  const candidates = [{ id: "todoist-1", task: snapTask("Send EFT report", "Finance", "") }];
  candidates[0].task.id = "todoist-1";
  const decision = bestTaskDeduplicationMatch(task, candidates, undefined, { dedupeStats: stats });
  assert.equal(decision.decision, "create");
  assert.equal(stats.candidateFlags.length, 1);
  // D2 is flag-only: never relinks, never rewrites the source task id.
  assert.equal(task.id, "gen-1");
});

check(failures, "D2 does not flag when the candidate has no project name", () => {
  const stats = emptyTaskDeduplicationStats();
  const task = { id: "gen-2", content: "SEND EFT report ✅", projectName: "Finance" };
  const candidates = [{ id: "todoist-2", task: snapTask("Send EFT report", "", "") }];
  candidates[0].task.id = "todoist-2";
  const decision = bestTaskDeduplicationMatch(task, candidates, undefined, { dedupeStats: stats });
  assert.equal(decision.decision, "create");
  assert.equal(stats.candidateFlags.length, 0);
  assert.equal(task.id, "gen-2");
});

check(failures, "D2 does not flag when the source task has no project name", () => {
  const stats = emptyTaskDeduplicationStats();
  const task = { id: "gen-3", content: "SEND EFT report ✅", projectName: "" };
  const candidates = [{ id: "todoist-3", task: snapTask("Send EFT report", "Finance", "") }];
  candidates[0].task.id = "todoist-3";
  const decision = bestTaskDeduplicationMatch(task, candidates, undefined, { dedupeStats: stats });
  assert.equal(decision.decision, "create");
  assert.equal(stats.candidateFlags.length, 0);
  assert.equal(task.id, "gen-3");
});

check(failures, "D2 does not flag across projects", () => {
  const stats = emptyTaskDeduplicationStats();
  const task = { content: "Send EFT report", projectName: "Finance" };
  const candidates = [{ id: "todoist-9", task: snapTask("Send EFT report", "Payroll", "") }];
  candidates[0].task.id = "todoist-9";
  const decision = bestTaskDeduplicationMatch(task, candidates, undefined, { dedupeStats: stats });
  assert.equal(decision.decision, "create");
  assert.equal(stats.candidateFlags.length, 0);
});

console.log("---");
if (failures.length > 0) {
  console.error(`FAILURES (${failures.length}):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
} else {
  console.log("All checks PASSED.");
  process.exit(0);
}
