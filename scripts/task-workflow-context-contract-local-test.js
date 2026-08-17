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
const semantic = Plugin.__semanticRetrieval;
const settings = { maxTaskContextChunks: 48 };
const source = {
  type: "note",
  title: "Contract repair fixture",
  path: "Contract repair fixture.md",
  text: "- [ ] Ship the report"
};
const sourceContract = semantic.buildTaskSourceContract(source, source.text, settings);
const providers = ["openai", "gemini", "openrouter", "openwebui"];
let passed = 0;

for (const provider of providers) {
  const bundle = semantic.taskWorkflowContextBundle({
    source,
    sourceType: source.type,
    sourceTitle: source.title,
    sourcePath: source.path,
    sourceSummary: source.text,
    sourceContract,
    // Reproduce a provider path that hands the context compiler an incomplete
    // catalog. The immutable source contract still contains the exact primary
    // evidence/facts required for dispatch.
    evidenceCatalog: { version: 2, items: [], manifest: {}, telemetry: {} },
    semanticContext: [],
    tasks: [],
    settings: Object.assign({}, settings, { aiProvider: provider })
  });
  assert.strictEqual(bundle.contextBundleValidation.dispatchAllowed, true, `${provider} should dispatch after primary closure repair`);
  assert.deepStrictEqual(bundle.contextBundleValidation.protectedReferenceErrors, [], `${provider} should have no protected reference errors`);
  assert.ok(bundle.providerEvidenceProjection.selectedEvidenceIds.includes(sourceContract.primaryEvidenceId), `${provider} should receive the primary evidence row`);
  passed += 3;
}

const unresolvedBundle = semantic.taskWorkflowContextBundle({
  source,
  sourceType: source.type,
  sourceTitle: source.title,
  sourcePath: source.path,
  sourceSummary: source.text,
  sourceContract,
  evidenceCatalog: { version: 2, items: [], manifest: {}, telemetry: {} },
  semanticContext: [],
  scopeSemanticEvidence: {
    [sourceContract.sourceScopeId]: {
      scopeId: sourceContract.sourceScopeId,
      mandatoryTaskFactIds: ["fact-not-in-source-contract"],
      context: []
    }
  },
  tasks: [],
  settings
});
assert.strictEqual(unresolvedBundle.contextBundleValidation.dispatchAllowed, false, "unresolved external protected facts must remain fail-closed");
assert.ok(unresolvedBundle.contextBundleValidation.protectedReferenceErrors.includes("fact:fact-not-in-source-contract"), "the unresolved fact must remain diagnosable");
passed += 2;

const canonicalFact = sourceContract.facts[0];
const primaryRow = {
  evidenceId: sourceContract.primaryEvidenceId,
  id: sourceContract.primaryEvidenceId,
  sourceKind: "current-source",
  primarySource: true,
  current: true,
  authorityState: "authoritative",
  scopeIds: [sourceContract.sourceScopeId],
  factIds: [canonicalFact.factId],
  structuredFacts: [canonicalFact]
};
const staleDiagnosticFact = {
  factId: "fact-stale-diagnostic",
  evidenceId: "evidence-stale-diagnostic",
  value: "stale diagnostic value",
  mandatoryFor: ["description"]
};
const staleTask = {
  id: "task-stale-diagnostic",
  evidence_ids: [sourceContract.primaryEvidenceId],
  taskLocalEvidence: {
    evidenceIds: [sourceContract.primaryEvidenceId],
    typedFacts: [canonicalFact, staleDiagnosticFact],
    materialDescriptionFactRefs: [staleDiagnosticFact.factId],
    executionDetailFactRefs: [staleDiagnosticFact.factId],
    factBindings: [{ factId: canonicalFact.factId, evidenceId: sourceContract.primaryEvidenceId }],
    primarySourceEvidence: primaryRow
  }
};
const staleProjection = semantic.taskWorkflowProviderEvidenceProjection([primaryRow], {
  sourceContract,
  tasks: [staleTask],
  scopeSemanticEvidence: {
    [sourceContract.sourceScopeId]: {
      primaryContextFactIds: [staleDiagnosticFact.factId],
      factId: staleDiagnosticFact.factId
    }
  },
  coverageEligibleEvidenceIds: [sourceContract.primaryEvidenceId]
});
assert.deepStrictEqual(staleProjection.missingProtectedFactIds, [], "stale task-local diagnostic facts must not become protected provider facts");
assert.deepStrictEqual(staleProjection.missingProtectedEvidenceIds, [], "stale task-local diagnostic evidence must not become protected provider evidence");
const staleBundle = semantic.taskWorkflowContextBundle({
  source,
  sourceType: source.type,
  sourceTitle: source.title,
  sourcePath: source.path,
  sourceSummary: source.text,
  sourceContract,
  evidenceCatalog: { version: 2, items: [], manifest: {}, telemetry: {} },
  tasks: [staleTask],
  scopeSemanticEvidence: {
    [sourceContract.sourceScopeId]: {
      primaryContextFactIds: [staleDiagnosticFact.factId],
      factId: staleDiagnosticFact.factId
    }
  },
  settings
});
assert.strictEqual(staleBundle.contextBundleValidation.dispatchAllowed, true, "stale task-local diagnostics must not block provider dispatch");
passed += 3;

process.stdout.write(JSON.stringify({ passed, failed: 0, providers, checks: [
  "provider-neutral-primary-evidence-closure",
  "unresolved-protected-fact-remains-fail-closed",
  "stale-task-local-diagnostics-are-not-provider-protected"
] }, null, 2) + "\n");
