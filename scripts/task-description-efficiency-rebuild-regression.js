"use strict";

const assert = require("assert");
const Module = require("module");

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
    requestUrl() {}
  };
};

const Plugin = require("../main.js");
const validation = Plugin.__taskGenerationValidation;
const gateway = Plugin.__aiModelGateway;
const retrieval = Plugin.__semanticRetrieval;

assert.strictEqual(
  typeof validation?.taskDescriptionProviderEnvelopeFit,
  "function",
  "description provider envelope fitting helper must be exported for the regression seam"
);

const settings = {
  aiProvider: "openai",
  aiModelProvider: "openai",
  aiModel: "gpt-4o-mini"
};
const protectedText = "protected current-source action fact ".repeat(600);
const optionalRows = [
  { evidenceId: "optional-score-unknown", factId: "optional-fact-unknown", score: undefined, text: "optional missing-score context ".repeat(1200) },
  { evidenceId: "optional-score-low", factId: "optional-fact-low", score: 0.1, text: "optional low-score context ".repeat(1200) },
  { evidenceId: "optional-score-high", factId: "optional-fact-high", score: 0.9, text: "optional high-score context ".repeat(1200) }
];
const protectedEvidenceId = "protected-current";
const protectedFactId = "protected-fact";
const scopeId = "description-scope-1";
const taskId = "description-task-1";
const evidenceById = {
  [protectedEvidenceId]: {
    evidenceId: protectedEvidenceId,
    factId: protectedFactId,
    scopeId,
    sourceKind: "current-source",
    current: true,
    excerpt: protectedText,
    score: 1
  },
  ...Object.fromEntries(optionalRows.map((row) => [row.evidenceId, {
    evidenceId: row.evidenceId,
    factId: row.factId,
    scopeId,
    sourceKind: "semantic",
    excerpt: row.text,
    score: row.score
  }]))
};
const factsById = {
  [protectedFactId]: { factId: protectedFactId, evidenceId: protectedEvidenceId, scopeId, value: protectedText, type: "action" },
  ...Object.fromEntries(optionalRows.map((row) => [row.factId, {
    factId: row.factId,
    evidenceId: row.evidenceId,
    scopeId,
    value: row.text,
    type: "context"
  }]))
};
const allowedEvidenceIds = [protectedEvidenceId, ...optionalRows.map((row) => row.evidenceId)];
const allowedFactIds = [protectedFactId, ...optionalRows.map((row) => row.factId)];
const factBindings = allowedFactIds.map((factId) => ({
  factId,
  evidenceId: factsById[factId].evidenceId,
  scopeId
}));
const citationLedgerByTask = {
  "0": allowedEvidenceIds.map((evidenceId) => ({ evidenceId, scopeId }))
};
const singletonContract = {
  valid: true,
  version: 1,
  sourceContractId: "description-contract-source-v1",
  promptEvidenceHash: "description-prompt-evidence-v1",
  contractHash: "description-contract-regression-v1",
  projectionHash: "description-projection-regression-v1",
  taskId,
  scopeId,
  allowedEvidenceIds,
  allowedFactIds,
  allowedCitationIds: allowedEvidenceIds,
  requiredCurrentEvidenceIds: [protectedEvidenceId],
  requiredCurrentFactIds: [protectedFactId],
  requiredFactIds: [protectedFactId],
  requiredDescriptionFactRefs: [],
  materialDescriptionFactRefs: [],
  executionDetailFactRefs: [],
  availableDescriptionFactRefs: [protectedFactId, ...optionalRows.map((row) => row.factId)],
  factsById,
  evidenceById,
  factBindings,
  citationLedgerByTask
};
const promptTask = {
  index: 0,
  title: "Protected current action",
  taskLocalEvidence: { taskId, scopeId, factBindings }
};
const sharedTaskEvidence = {
  providerEvidenceIds: allowedEvidenceIds,
  providerFactIds: allowedFactIds,
  factsById,
  evidenceById,
  citationLedgerByTask
};
const projection = {
  protectedEvidenceIds: [protectedEvidenceId],
  selectedEvidenceIds: allowedEvidenceIds,
  providerEvidenceById: evidenceById
};
const optionalGroups = validation.taskDescriptionProviderEvidenceGroups(
  projection,
  sharedTaskEvidence,
  singletonContract
);
assert.strictEqual(optionalGroups.length, optionalRows.length, "all optional evidence rows must be eligible for fitting");
const candidateCalls = [];
const buildCandidate = (omittedOptionalEvidenceIds = []) => {
  const omitted = new Set((omittedOptionalEvidenceIds || []).map(String));
  assert.strictEqual(omitted.has(protectedEvidenceId), false, "the optional rebuild seam must never receive protected evidence");
  candidateCalls.push([...omitted]);
  const candidateContract = validation.taskDescriptionOptionalPrunedContractView(singletonContract, [...omitted]);
  const candidateEvidenceIds = candidateContract.allowedEvidenceIds;
  const candidateFactIds = candidateContract.allowedFactIds;
  const candidateSchemaVocabulary = {
    evidenceIds: candidateEvidenceIds,
    factIds: candidateFactIds,
    scopeIds: [scopeId],
    taskIds: [taskId],
    requiredCurrentEvidenceIds: candidateContract.requiredCurrentEvidenceIds,
    requiredCurrentFactIds: candidateContract.requiredCurrentFactIds,
    taskIndexes: [0],
    contractHash: singletonContract.contractHash
  };
  const schema = gateway.taskDescriptionSchema(null, 3, candidateSchemaVocabulary);
  const canonicalRequest = gateway.taskDescriptionCanonicalRequestLedger(
    promptTask,
    sharedTaskEvidence,
    singletonContract,
    {
      phase: "initial",
      allowOptionalEvidencePruning: omitted.size > 0,
      omittedOptionalEvidenceIds: [...omitted]
    }
  );
  assert.strictEqual(canonicalRequest.valid, true, `pruned canonical request must remain valid: ${canonicalRequest.invalidReasonCode}`);
  const envelope = validation.buildDescriptionProviderEnvelope(singletonContract, {
    omittedOptionalEvidenceIds: [...omitted]
  });
  const suffix = retrieval.taskDescriptionPromptContextSuffix({}, {
    singletonContract,
    omittedOptionalEvidenceIds: [...omitted]
  });
  const user = [suffix, canonicalRequest.user].filter(Boolean).join("\n\n");
  const preflight = gateway.taskDescriptionProviderContextPreflight({
    settings,
    provider: "openai",
    model: "gpt-4o-mini",
    operation: "task-description",
    system: "task-description-system",
    promptCachePrefix: "TASK_DESCRIPTION_STABLE_PREFIX_v1",
    promptContextSuffix: "",
    user,
    schema,
    originalSchema: schema,
    schemaVocabulary: candidateSchemaVocabulary
  });
  return {
    preflight,
    omittedOptionalEvidenceIds: [...omitted],
    protectedEvidenceIds: candidateContract.requiredCurrentEvidenceIds,
    protectedFactIds: candidateContract.requiredCurrentFactIds,
    candidateContract,
    candidateSchemaVocabulary,
    canonicalRequest,
    envelope,
    suffix
  };
};

const first = validation.taskDescriptionProviderEnvelopeFit({
  optionalGroups,
  buildCandidate,
  targetExclusiveTokens: 16000,
  operationalBoundaryExclusiveTokens: 16385
});
const second = validation.taskDescriptionProviderEnvelopeFit({
  optionalGroups,
  buildCandidate,
  targetExclusiveTokens: 16000,
  operationalBoundaryExclusiveTokens: 16385
});

assert.ok(first.initialCandidate.preflight.estimatedInputTokens >= 16000, "fixture must start above the efficiency target");
assert.ok(first.candidate.preflight.estimatedInputTokens < 16000, `rebuilt description envelope must fit below the efficiency target (initial=${first.initialCandidate.preflight.estimatedInputTokens}, final=${first.candidate.preflight.estimatedInputTokens}, omitted=${first.omittedOptionalEvidenceIds.length})`);
assert.ok(first.omittedOptionalEvidenceIds.length >= 2, "fixture must require multiple optional omissions");
assert.deepStrictEqual(
  first.omittedOptionalEvidenceIds.slice(0, 2),
  ["optional-score-unknown", "optional-score-low"],
  "optional evidence must be omitted missing-score-first, then ascending score"
);
assert.strictEqual(first.omittedOptionalEvidenceIds.includes(protectedEvidenceId), false, "protected evidence must never be omitted");
assert.strictEqual(first.candidate.protectedEvidenceIds.includes(protectedEvidenceId), true, "protected evidence must survive the rebuild");
assert.strictEqual(first.candidate.protectedFactIds.includes(protectedFactId), true, "protected facts must survive the rebuild");
assert.strictEqual(first.candidate.candidateContract.allowedEvidenceIds.includes(protectedEvidenceId), true, "protected evidence must remain in the pruned contract");
assert.strictEqual(first.candidate.candidateContract.allowedFactIds.includes(protectedFactId), true, "protected fact must remain in the pruned contract");
for (const omittedEvidenceId of first.omittedOptionalEvidenceIds) {
  assert.strictEqual(first.candidate.candidateContract.allowedEvidenceIds.includes(omittedEvidenceId), false, "omitted evidence must leave the candidate contract");
  const omittedFactId = optionalRows.find((row) => row.evidenceId === omittedEvidenceId).factId;
  assert.strictEqual(first.candidate.candidateContract.allowedFactIds.includes(omittedFactId), false, "facts bound only to omitted evidence must leave the candidate contract");
  assert.strictEqual(first.candidate.canonicalRequest.ledger.evidenceById[omittedEvidenceId], undefined, "omitted evidence must leave the canonical ledger");
}
assert.strictEqual(first.candidate.envelope.omittedOptionalEvidenceIds.length, first.omittedOptionalEvidenceIds.length, "envelope must carry the selected omissions");
assert.strictEqual(first.candidate.canonicalRequest.protectedClosureEquivalent, true, "pruned canonical ledger must preserve the protected closure");
assert.strictEqual(first.candidate.candidateSchemaVocabulary.evidenceIds.includes(protectedEvidenceId), true, "schema vocabulary must retain protected evidence");
assert.strictEqual(first.telemetry.efficiencyTargetPruningApplied, true, "late pruning must be observable");
assert.strictEqual(first.telemetry.efficiencyTargetReached, true, "late pruning must report the initial target crossing");
assert.strictEqual(first.telemetry.protectedCarrierStillOverTarget, false, "the retained protected carrier must fit this fixture");
assert.deepStrictEqual(
  first.omittedOptionalEvidenceIds,
  second.omittedOptionalEvidenceIds,
  "rebuild omission order must be deterministic"
);
assert.strictEqual(
  first.candidate.preflight.estimatedInputTokens,
  second.candidate.preflight.estimatedInputTokens,
  "rebuild sizing must be deterministic"
);
assert.ok(candidateCalls.length < (optionalGroups.length * 2) + 4, "fitting should avoid an unbounded rebuild storm");

const nonMonotoneGroups = [
  { evidenceId: "nonmonotone-0", score: 0 },
  { evidenceId: "nonmonotone-1", score: 0.1 },
  { evidenceId: "nonmonotone-2", score: 0.2 },
  { evidenceId: "nonmonotone-3", score: 0.3 }
];
const nonMonotoneEstimates = [200, 90, 200, 80, 70];
const nonMonotone = validation.taskDescriptionProviderEnvelopeFit({
  optionalGroups: nonMonotoneGroups,
  buildCandidate: (omittedOptionalEvidenceIds = []) => ({
    preflight: { estimatedInputTokens: nonMonotoneEstimates[omittedOptionalEvidenceIds.length] }
  }),
  targetExclusiveTokens: 100,
  operationalBoundaryExclusiveTokens: 100
});
assert.strictEqual(nonMonotone.omittedGroups, 1, "fitting must select the smallest prefix even when estimates are non-monotone");
assert.deepStrictEqual(nonMonotone.omittedOptionalEvidenceIds, ["nonmonotone-0"], "non-monotone fitting must preserve deterministic omission order");

const missingEstimate = validation.taskDescriptionProviderEnvelopeFit({
  optionalGroups: [{ evidenceId: "missing-estimate", score: 0 }],
  buildCandidate: () => ({ preflight: {} }),
  targetExclusiveTokens: 100,
  operationalBoundaryExclusiveTokens: 100
});
assert.strictEqual(missingEstimate.telemetry.efficiencyTargetFits, false, "missing estimates must not be treated as a fitting candidate");
assert.strictEqual(missingEstimate.omittedGroups, 1, "missing estimates must fail closed after all optional groups are considered");

console.log(JSON.stringify({
  status: "GREEN",
  initialEstimatedInputTokens: first.initialCandidate.preflight.estimatedInputTokens,
  finalEstimatedInputTokens: first.candidate.preflight.estimatedInputTokens,
  omittedOptionalEvidenceIds: first.omittedOptionalEvidenceIds,
  candidateBuilds: candidateCalls.length
}));
