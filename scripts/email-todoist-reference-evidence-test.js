"use strict";

// Email Todoist reference evidence: a validated Todoist task-reference row
// (todoist-snapshot-reference-row / subtask-task-tree-record with canonical
// identity + todoist-snapshot source surface) is read-only reference evidence.
// Its native owner is the referenced Todoist task, not a competing generation
// task, so an email generation task with a valid retrieval binding for its own
// task/scope + the ACTIVE contract must be AUTHORIZED. All other denials stay:
// wrong-contract or missing bindings, ordinary cross-task ownership, and
// unresolved owners must still be DENIED.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = path.join(__dirname, "..", "src/main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));

const originalLoad = Module._load;
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
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
    requestUrl() { throw new Error("network disabled - requestUrl must not be called"); }
  };
};

let pluginApi;
try {
  testModule._compile(
    `${mainSource}\nmodule.exports.__testEmailTodoistReference = {\n` +
      "  taskWorkflowEvidenceAuthorization,\n" +
      "  taskReferenceSyntheticPath\n" +
      "};\n",
    mainPath
  );
  pluginApi = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const { taskWorkflowEvidenceAuthorization, taskReferenceSyntheticPath } = pluginApi.__testEmailTodoistReference;

const ACTIVE = "src-43qhzg";
const SCOPE = "scope-lg5ake";
const TODOIST_ID = "1234567890";
const OID = "ABCDEF1234567890";

function snapshotRow(overrides = {}) {
  const taskId = overrides.taskId || "task-0";
  const scopeId = overrides.scopeId || SCOPE;
  const contractId = overrides.contractId || ACTIVE;
  const todoistId = overrides.todoistId || TODOIST_ID;
  const sourceKind = overrides.sourceKind || "todoist-snapshot-reference-row";
  const refPath = taskReferenceSyntheticPath("record-email-1", sourceKind);
  return {
    evidenceId: "ev-snap-1",
    id: "ev-snap-1",
    sourceKind,
    path: refPath,
    text: "Title: File the budget report",
    taskId: todoistId,
    todoistId,
    nonVaultSource: true,
    sourceSurface: "todoist-snapshot",
    retrievalEligible: true,
    taskReference: {
      todoistId,
      taskId: todoistId,
      id: todoistId,
      oid: OID,
      sourceKind,
      nonVaultSource: true,
      sourceSurface: "todoist-snapshot",
      retrievalEligible: true,
      path: refPath,
      content: "File the budget report"
    },
    queryTaskId: taskId,
    queryScopeId: scopeId,
    querySourceContractId: contractId,
    taskScopeAssociations: overrides.associations !== undefined ? overrides.associations : [
      { taskId, scopeId, queryId: "", sourceContractId: contractId }
    ]
  };
}

const failures = [];
function check(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL: ${name}: ${error && error.message || error}`); }
}

// (1) Key case: recognized snapshot reference row, native owner is the
// referenced Todoist task, valid retrieval binding for task-0/scope/ACTIVE.
check("snapshot reference row is authorized for the citing email task", () => {
  const decision = taskWorkflowEvidenceAuthorization(snapshotRow(), "task-0", SCOPE, ACTIVE);
  assert.equal(decision.allowed, true, `expected authorized, got ${decision.reason}`);
  assert.equal(decision.reason, "authorized");
});

// (2a) Same row bound to a different contract stays denied.
check("snapshot reference row with a foreign-contract binding is denied", () => {
  const decision = taskWorkflowEvidenceAuthorization(
    snapshotRow({ contractId: "src-other" }), "task-0", SCOPE, ACTIVE
  );
  assert.equal(decision.allowed, false, "a foreign-contract binding must not authorize");
});

// (2b) Same row with no retrieval binding at all stays denied.
check("snapshot reference row with no binding is denied", () => {
  const row = snapshotRow({ associations: [] });
  delete row.queryTaskId;
  delete row.queryScopeId;
  delete row.querySourceContractId;
  const decision = taskWorkflowEvidenceAuthorization(row, "task-0", SCOPE, ACTIVE);
  assert.equal(decision.allowed, false, "a row with no retrieval binding must not authorize");
});

// (2c) Same row bound to a different scope stays denied for this scope.
check("snapshot reference row bound to another scope is denied", () => {
  const decision = taskWorkflowEvidenceAuthorization(
    snapshotRow({ taskId: "task-0", scopeId: "scope-other" }), "task-0", SCOPE, ACTIVE
  );
  assert.equal(decision.allowed, false, "a wrong-scope binding must not authorize this scope");
});

// (3) An ordinary vault note row natively owned by another generation task
// stays denied even with a valid retrieval binding for the citing task.
check("ordinary note row owned by another generation task is denied", () => {
  const row = {
    evidenceId: "ev-note-1",
    id: "ev-note-1",
    sourceKind: "note",
    path: "Notes/Plan.md",
    text: "Some other task's private note body",
    taskId: "task-9",
    queryTaskId: "task-0",
    queryScopeId: SCOPE,
    querySourceContractId: ACTIVE,
    taskScopeAssociations: [{ taskId: "task-0", scopeId: SCOPE, queryId: "", sourceContractId: ACTIVE }]
  };
  const decision = taskWorkflowEvidenceAuthorization(row, "task-0", SCOPE, ACTIVE);
  assert.equal(decision.allowed, false, "true cross-task ownership must stay denied");
  assert.equal(decision.reason, "foreign-owner");
});

// (4) A snapshot reference row carrying an unresolved extra owner stays denied.
check("snapshot reference row with an unresolved owner is denied", () => {
  const row = snapshotRow();
  row.taskScopeAssociations = [
    ...row.taskScopeAssociations,
    { taskId: "task-zzz", scopeId: "scope-other", queryId: "", sourceContractId: ACTIVE }
  ];
  const decision = taskWorkflowEvidenceAuthorization(row, "task-0", SCOPE, ACTIVE);
  assert.equal(decision.allowed, false, "unresolved owners must stay denied");
  assert.equal(decision.reason, "unresolved-owner");
});

if (failures.length) {
  console.error(`${failures.length} email-todoist-reference check(s) failed`);
  process.exit(1);
}
console.log("PASS: email Todoist reference evidence authorization");
