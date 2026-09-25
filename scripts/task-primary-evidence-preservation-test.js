"use strict";

// Regression for a ready post-structure context replacing a valid provider
// task's primary action evidence. The source module can be overridden with
// STSYNC_PRIMARY_EVIDENCE_SOURCE_OVERRIDE so a proposed production patch can
// be exercised in a private temporary copy without editing main.js.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = path.join(__dirname, "..", "main.js");
const sourcePath = process.env.STSYNC_PRIMARY_EVIDENCE_SOURCE_OVERRIDE || mainPath;
const mainSource = fs.readFileSync(sourcePath, "utf8");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
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
    requestUrl() { throw new Error("Network disabled in task primary evidence preservation test."); }
  };
};
global.window = global;
global.fetch = async () => { throw new Error("Network disabled in task primary evidence preservation test."); };

let Plugin;
try {
  testModule._compile(mainSource, mainPath);
  Plugin = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const {
  DEFAULT_SETTINGS,
  buildTaskEvidenceCatalog,
  buildTaskSourceContract,
  attachTaskWorkflowSemanticEvidence,
  attachTaskWorkflowEvidenceBundles,
  structuredMarkedActionFactCoverage,
  supplementMissingStructuredMarkedActionTasks,
  taskWorkflowOwnershipKey
} = Plugin;

for (const name of [
  "buildTaskEvidenceCatalog",
  "buildTaskSourceContract",
  "attachTaskWorkflowSemanticEvidence",
  "attachTaskWorkflowEvidenceBundles",
  "structuredMarkedActionFactCoverage",
  "supplementMissingStructuredMarkedActionTasks",
  "taskWorkflowOwnershipKey"
]) {
  assert.equal(typeof Plugin[name], "function", `${name} must be exported for the focused harness`);
}

const SETTINGS = Object.assign({}, DEFAULT_SETTINGS);
const SOURCE = { type: "note", title: "Clinic follow-up fixture", path: "Clinic follow-up fixture.md" };
const SOURCE_SUMMARY = "#todo Follow up with the clinic about the blood drive results\nThe clinic confirmed the mobile drive for October.";
const SECONDARY_EVIDENCE_ID = "evidence-same-scope-secondary-context";
const OLD_SECONDARY_EVIDENCE_ID = "evidence-old-supporting-context";
const contract = buildTaskSourceContract(SOURCE, SOURCE_SUMMARY, SETTINGS);
const markedScope = contract.scopes.find((scope) => scope && scope.family === "marked-action") || contract.scopes[0];
const scopeId = String(markedScope.scopeId || markedScope.id);
const primaryEvidenceId = String(contract.primaryEvidenceId);
const scopeFacts = (contract.facts || []).filter((fact) => String(fact.scopeId) === scopeId);
const actionFact = scopeFacts.find((fact) => String(fact.evidenceId) === primaryEvidenceId);
assert.ok(scopeId && primaryEvidenceId && actionFact, "fixture must expose a current primary action fact");

const secondaryChunk = {
  id: SECONDARY_EVIDENCE_ID,
  evidenceId: SECONDARY_EVIDENCE_ID,
  sourceKind: "semantic-index-chunk",
  title: SOURCE.title,
  path: SOURCE.path,
  text: "The coordinator confirmed the volunteer roster is ready for the call.",
  score: 0.92,
  semanticScore: 0.92,
  authorityState: "supporting",
  conflictState: "none",
  temporalRelation: "current",
  scopeId,
  scopeIds: [scopeId]
};
const oldSecondaryChunk = Object.assign({}, secondaryChunk, {
  id: OLD_SECONDARY_EVIDENCE_ID,
  evidenceId: OLD_SECONDARY_EVIDENCE_ID,
  text: "An earlier supporting detail about the clinic roster."
});
const catalog = buildTaskEvidenceCatalog(contract, [secondaryChunk, oldSecondaryChunk], SETTINGS, {
  source: SOURCE,
  sourceSummary: SOURCE_SUMMARY
});

function bindingsForScope() {
  return scopeFacts.map((fact) => ({
    factId: String(fact.factId),
    type: String(fact.type),
    role: String(fact.role),
    evidenceId: String(fact.evidenceId),
    scopeId: String(fact.scopeId)
  }));
}

function buildProviderTask(overrides = {}) {
  return Object.assign({
    content: "Follow up with the clinic about the blood drive results",
    description: "Keep the confirmed mobile drive details with this follow-up.",
    labels: ["FollowUp"],
    priority: 4,
    due_date: "2026-10-15",
    deadline_date: "2026-10-20",
    scope_id: scopeId,
    evidence_ids: [primaryEvidenceId],
    fact_refs: scopeFacts.map((fact) => String(fact.factId)),
    fact_bindings: bindingsForScope(),
    subtasks: []
  }, overrides);
}

function runReadySecondaryHandoff(providerTask, {
  requireValidSeed = true,
  indexState = "ready-results",
  postContext = [{ id: SECONDARY_EVIDENCE_ID, evidenceId: SECONDARY_EVIDENCE_ID }],
  preStructureEvidenceIds = []
} = {}) {
  const seed = attachTaskWorkflowEvidenceBundles([providerTask], contract, catalog, {});
  if (requireValidSeed) {
    assert.equal(seed.rejected.length, 0,
      `initial provider task must pass bundle validation: ${JSON.stringify(seed.rejected.map((entry) => entry.errors))}`);
    assert.equal(seed.tasks.length, 1, "initial provider task must survive its first bundle pass");
  }

  const task = requireValidSeed ? seed.tasks[0] : providerTask;
  const taskKey = taskWorkflowOwnershipKey(task, 0);
  const retrieval = {
    byTask: {
      [taskKey]: {
        queryId: "ready-secondary-query",
        context: postContext,
        telemetry: { indexState, degradedReason: "", selected: postContext.map((chunk) => chunk.evidenceId), rejected: [] }
      }
    },
    taskKeyByIndex: { "0": taskKey }
  };
  const preStructureContext = preStructureEvidenceIds.map((evidenceId) => ({ id: evidenceId, evidenceId }));
  attachTaskWorkflowSemanticEvidence([task], contract, catalog, {
    byScope: preStructureEvidenceIds.length ? {
      [scopeId]: { scopeId, evidenceIds: preStructureEvidenceIds, context: preStructureContext }
    } : {}
  }, retrieval);
  const final = attachTaskWorkflowEvidenceBundles([task], contract, catalog, {});
  const coverage = structuredMarkedActionFactCoverage(final.tasks, contract);
  const supplementation = coverage.passed
    ? { tasks: final.tasks, addedFactIds: [], unresolvedFactIds: [] }
    : supplementMissingStructuredMarkedActionTasks(final.tasks, contract, coverage.missingFacts, SETTINGS);
  return { task, seed, final, coverage, supplementation };
}

{
  const result = runReadySecondaryHandoff(buildProviderTask());
  const finalTask = result.final.tasks[0];
  assert.ok(result.final.tasks.length === 1,
    `ready same-scope secondary evidence must preserve the valid provider task; rejected=${JSON.stringify(result.final.rejected.map((entry) => entry.errors))}`);
  assert.ok(finalTask.evidence_ids.includes(primaryEvidenceId), "replacement must retain the usable incoming primary evidence id");
  assert.ok(finalTask.evidence_ids.includes(SECONDARY_EVIDENCE_ID), "replacement must still use ready secondary context");
  assert.ok(finalTask.fact_bindings.some((binding) => binding.factId === actionFact.factId && binding.evidenceId === primaryEvidenceId),
    "replacement must keep the valid primary action binding");
  assert.equal(finalTask.content, "Follow up with the clinic about the blood drive results");
  assert.equal(finalTask.description, "Keep the confirmed mobile drive details with this follow-up.");
  assert.deepEqual(finalTask.labels, ["FollowUp"]);
  assert.equal(finalTask.priority, 4);
  assert.equal(finalTask.due_date, "2026-10-15");
  assert.equal(finalTask.deadline_date, "2026-10-20");
  assert.equal(result.coverage.passed, true, "preserved primary action fact must satisfy marked-action coverage");
  assert.equal(result.supplementation.tasks[0].priority, 4, "successful handoff must avoid default-field supplementation");
  assert.equal(result.supplementation.tasks[0].due_date, "2026-10-15");
  assert.equal(result.supplementation.tasks[0].deadline_date, "2026-10-20");
}

{
  const result = runReadySecondaryHandoff(buildProviderTask({
    evidence_ids: [primaryEvidenceId, OLD_SECONDARY_EVIDENCE_ID]
  }), { preStructureEvidenceIds: [OLD_SECONDARY_EVIDENCE_ID] });
  assert.equal(result.final.tasks.length, 1, "ready secondary context must keep the validated task");
  assert.ok(result.final.tasks[0].evidence_ids.includes(primaryEvidenceId), "primary action evidence must remain selected");
  assert.ok(result.final.tasks[0].evidence_ids.includes(SECONDARY_EVIDENCE_ID), "new ready context must replace supporting context");
  assert.ok(!result.final.tasks[0].evidence_ids.includes(OLD_SECONDARY_EVIDENCE_ID), "old supporting evidence must be removed");
}

{
  const result = runReadySecondaryHandoff(buildProviderTask({
    evidence_ids: [primaryEvidenceId, OLD_SECONDARY_EVIDENCE_ID]
  }), { indexState: "ready-zero", postContext: [] });
  assert.equal(result.final.tasks.length, 1, "ready-zero must keep the valid provider task");
  assert.deepEqual(result.final.tasks[0].evidence_ids, [primaryEvidenceId], "ready-zero must retain only primary authority");
  assert.deepEqual(result.final.tasks[0].labels, ["FollowUp"]);
  assert.equal(result.final.tasks[0].priority, 4);
  assert.equal(result.final.tasks[0].due_date, "2026-10-15");
  assert.equal(result.final.tasks[0].deadline_date, "2026-10-20");
}

// A malformed primary binding must not become valid through primary-ID
// preservation. This task skips the initial-validity precondition so it
// specifically guards the safety boundary of the candidate fix.
{
  const malformed = buildProviderTask({
    fact_bindings: bindingsForScope().map((binding) => binding.factId === actionFact.factId
      ? Object.assign({}, binding, { scopeId: "scope-foreign-sibling" })
      : binding)
  });
  const result = runReadySecondaryHandoff(malformed, { requireValidSeed: false });
  assert.equal(result.final.tasks.length, 0, "foreign sibling-scope action binding must remain rejected");
  assert.equal(result.final.rejected.length, 1, "invalid binding must continue through the documented rejection path");
  assert.ok(!result.task.fact_bindings.some((binding) => binding.factId === actionFact.factId && binding.scopeId === scopeId),
    "preservation must not synthesize a valid local binding for a sibling-scope input");
}

console.log(`Task primary evidence preservation: passed (${sourcePath === mainPath ? "repository source" : "source override"}).`);
