"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

// Append test-only exports to a fresh copy so this harness exercises the real
// private projection, materiality, and validator functions without changing
// main.js or exposing test seams in the plugin API.
const mainPath = path.join(__dirname, "..", "main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
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
    requestUrl() { throw new Error("network disabled - requestUrl must not be called"); }
  };
};

let pluginApi;
try {
  testModule._compile(
    `${mainSource}\nmodule.exports.__testTaskSelectedNoteMateriality = {\n` +
      "  buildTaskSourceContract, taskSemanticCurrentSourceCandidateDecision, buildTaskEvidenceCatalog,\n" +
      "  attachTaskWorkflowSemanticEvidence, taskWorkflowContextBundle, attachTaskWorkflowEvidenceBundles,\n" +
      "  taskDescriptionRichLocalPayload, validateTaskDescriptionSentences\n" +
      "};\n",
    mainPath
  );
  pluginApi = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const {
  buildTaskSourceContract,
  taskSemanticCurrentSourceCandidateDecision,
  buildTaskEvidenceCatalog,
  attachTaskWorkflowSemanticEvidence,
  taskWorkflowContextBundle,
  attachTaskWorkflowEvidenceBundles,
  taskDescriptionRichLocalPayload,
  validateTaskDescriptionSentences
} = pluginApi.__testTaskSelectedNoteMateriality;

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
const sourceText = [
  "# Release guide",
  "Background remains available to the selected action.",
  "- [ ] Publish the response guide",
  "Publication is blocked until Security approves the rollback rehearsal.",
  "The archive appendix describes unrelated historical examples."
].join("\n");
const source = {
  type: "note",
  title: "Release guide",
  path: "Launch/Release guide.md",
  sourceId: "source-release-guide",
  primaryEvidenceId: "evidence-release-source",
  text: sourceText
};
const settings = Object.assign({}, pluginApi.DEFAULT_SETTINGS, { maxTaskContextChunks: 48 });
const sourceContract = buildTaskSourceContract(source, sourceText, settings);
const marker = sourceContract.explicitMarkers[0];
const scopeId = marker.scopeId;
const taskId = "todoist-task-17";
const queryId = "selected-note-query-1";
const markerFact = sourceContract.facts.find((fact) => fact.factId === marker.factId);

function candidateDecision(evidenceId, line, text, overrides = {}) {
  const factId = overrides.factId || `fact-${evidenceId}`;
  const fact = {
    factId,
    type: "summary",
    kind: "semantic-excerpt",
    role: "supporting-context",
    value: text,
    sourceSurface: text,
    evidenceId,
    scopeId,
    sourceId: sourceContract.sourceId,
    current: true,
    temporalRelation: "current",
    authorityState: "authoritative",
    conflictState: "none",
    mandatoryFor: []
  };
  const candidate = Object.assign({
    id: evidenceId,
    evidenceId,
    sourceId: sourceContract.sourceId,
    sourceKind: "semantic-index-chunk",
    title: source.title,
    path: source.path,
    text,
    lineStart: line,
    lineEnd: line,
    score: 0.94,
    semanticScore: 0.94,
    semanticUnitKind: "context",
    current: true,
    temporalRelation: "current",
    authorityState: "authoritative",
    conflictState: "none",
    scopeId,
    scopeIds: [scopeId],
    taskId,
    queryId,
    taskScopeAssociations: [{ taskId, scopeId, queryId, sourceContractId: sourceContract.id }],
    structuredFacts: [fact]
  }, overrides);
  const decision = taskSemanticCurrentSourceCandidateDecision(
    candidate,
    source,
    sourceContract,
    scopeId,
    { id: taskId, taskId, scope_id: scopeId },
    { supportingEvidenceOnly: true, activeSourcePath: source.path, taskId, queryId }
  );
  return { decision, fact };
}

const positiveText = "Publication is blocked until Security approves the rollback rehearsal.";
const positive = candidateDecision("evidence-current-note-context", 4, positiveText);
const positiveChunk = Object.assign({}, positive.decision.item.chunk, {
  // These are the existing selector's selected action-lane outputs. The test
  // starts after semantic ranking and verifies that downstream projection and
  // binding preserve the admitted current-note candidate.
  actionLaneSupported: true,
  actionLaneContribution: 0.91,
  materialityDimensions: ["authoritative-source", "current-vault"],
  materialityContributions: { "authoritative-source": 0.82, "current-vault": 0.77 }
});
const irrelevantText = "An unrelated appendix contains historical archive examples.";
const irrelevant = candidateDecision("evidence-irrelevant-same-note", 5, irrelevantText);
const irrelevantChunk = irrelevant.decision.item.chunk;
const overlap = candidateDecision("evidence-marker-overlap", marker.line, "Publish the response guide");

check(failures, "the positive candidate is exact-path, positive-score, line-owned, and outside the marker", () => {
  assert.equal(positive.decision.admitted, true);
  assert.equal(positive.decision.item.sourceKind, "current-source-context");
  assert.equal(positiveChunk.path, source.path);
  assert.ok(positiveChunk.score > 0);
  assert.ok(positiveChunk.lineStart > marker.line || positiveChunk.lineEnd < marker.line);
});
check(failures, "a marker-overlapping current-note chunk is excluded by the source decision", () => {
  assert.equal(overlap.decision.admitted, false);
  assert.equal(overlap.decision.reasonCode, "current-source-marker-overlap");
});

const initialTask = {
  id: taskId,
  taskId,
  content: marker.action,
  scope_id: scopeId,
  evidence_ids: [sourceContract.primaryEvidenceId],
  fact_refs: [markerFact.factId],
  fact_bindings: [{
    factId: markerFact.factId,
    type: markerFact.type,
    role: markerFact.role,
    evidenceId: markerFact.evidenceId,
    scopeId: markerFact.scopeId
  }],
  subtasks: []
};
const evidenceCatalog = buildTaskEvidenceCatalog(sourceContract, [positiveChunk, irrelevantChunk], settings, { source, sourceSummary: sourceText });
attachTaskWorkflowSemanticEvidence([initialTask], sourceContract, evidenceCatalog, {
  byScope: {
    [scopeId]: {
      scopeId,
      queryId,
      evidenceIds: [positiveChunk.evidenceId, irrelevantChunk.evidenceId],
      context: [positiveChunk, irrelevantChunk]
    }
  }
}, null);

const taskRefs = initialTask.evidence_ids.slice();
const contextBundle = taskWorkflowContextBundle({
  source,
  sourceType: "note",
  sourceTitle: source.title,
  sourcePath: source.path,
  sourceSummary: sourceText,
  sourceContract,
  evidenceCatalog,
  semanticContext: [positiveChunk, irrelevantChunk],
  tasks: [initialTask],
  taskEvidenceRefs: { [taskId]: taskRefs },
  taskEvidenceScopes: { [taskId]: scopeId },
  settings
});

check(failures, "the exact current-note chunk survives provider projection", () => {
  assert.ok(contextBundle.providerEvidenceProjection.selectedEvidenceIds.includes(positiveChunk.evidenceId));
  assert.ok(contextBundle.contextBundleValidation.dispatchAllowed);
});

const attached = attachTaskWorkflowEvidenceBundles(
  [initialTask],
  sourceContract,
  contextBundle.providerEvidenceCatalog,
  { allowLegacyFactBindings: false }
);
const task = attached.tasks[0];
check(failures, "the admitted chunk and its exact current fact binding reach the one task bundle", () => {
  assert.equal(attached.rejected.length, 0, `bundle attachment rejected task: ${JSON.stringify(attached.rejected)}`);
  assert.ok(task.evidenceBundle.evidenceIds.includes(positiveChunk.evidenceId));
  assert.ok(task.evidenceBundle.fact_bindings.some((binding) =>
    binding.factId === positive.fact.factId
      && binding.evidenceId === positiveChunk.evidenceId
      && binding.scopeId === scopeId));
});

const local = taskDescriptionRichLocalPayload(task, task.evidenceBundle, sourceContract);
check(failures, "materiality admits only the relevant same-note fact under current authority and exact binding", () => {
  assert.ok(local.materialDescriptionFactRefs.includes(positive.fact.factId));
  assert.ok(!local.materialDescriptionFactRefs.includes(irrelevant.fact.factId));
});

const omittedNarrative = {
  scope_id: scopeId,
  description_sentences: [{
    text: marker.action,
    evidence_ids: [sourceContract.primaryEvidenceId],
    fact_refs: [markerFact.factId]
  }]
};
const validation = validateTaskDescriptionSentences(omittedNarrative, task, {
  scopeId,
  evidenceIds: local.evidenceIds,
  factRefs: local.factRefs,
  factBindings: local.factBindings,
  materialDescriptionFactRefs: local.materialDescriptionFactRefs,
  executionDetailFactRefs: [],
  bundle: task.evidenceBundle
}, sourceContract, local.citationLedger, source.path);
check(failures, "sentence validation rejects prose that omits the admitted material current-note fact", () => {
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes(`description-sentence-material-fact-omitted:${positive.fact.factId}`), validation.errors.join("; "));
});

if (task?.evidenceBundle) {
  const wrongScopeBundle = JSON.parse(JSON.stringify(task.evidenceBundle));
  const positiveItem = wrongScopeBundle.items.find((item) => item.evidenceId === positiveChunk.evidenceId);
  if (positiveItem) {
    positiveItem.scopeIds = [scopeId, "scope-other-task"];
    positiveItem.taskScopeAssociations = [{ taskId: "todoist-task-other", scopeId: "scope-other-task", queryId: "foreign-query" }];
  }
  const wrongScopeTask = Object.assign({}, task, { evidenceBundle: wrongScopeBundle, taskEvidenceBundle: wrongScopeBundle });
  const wrongScopeLocal = taskDescriptionRichLocalPayload(wrongScopeTask, wrongScopeBundle, sourceContract);
  check(failures, "a same-note fact with only a foreign task/scope association is not material to this task", () => {
    assert.ok(!wrongScopeLocal.materialDescriptionFactRefs.includes(positive.fact.factId));
  });
}

if (failures.length) {
  throw new Error(`task selected-note materiality test failed (${failures.length}):\n- ${failures.join("\n- ")}`);
}

console.log("task selected-note materiality test: pass");
