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
let passed = 0;

const tasks = [
  { content: "Review the project plan", section: "" , subtasks: [{ content: "Check dependencies", section: "" }] },
  { content: "Send the project plan", section: "Old Section", subtasks: [] }
];
const repaired = validation.repairGeneratedTaskSectionMetadata(tasks, "Notes_26_08_18_Project_Plan");
assert.strictEqual(repaired.valid, true, "section repair should produce a valid section contract");
assert.strictEqual(repaired.repairedCount, 2, "missing and divergent root sections should be repaired");
assert.strictEqual(tasks[0].section, "Notes_26_08_18_Project_Plan", "missing root section should be filled");
assert.strictEqual(tasks[1].section, "Notes_26_08_18_Project_Plan", "divergent root section should be normalized");
assert.strictEqual(tasks[0].subtasks[0].section, "", "subtask section metadata should remain inherited from its parent");
assert.deepStrictEqual(validation.validateGeneratedTaskSectionMetadata(tasks, repaired.sectionName).missingTaskIndexes, [], "repaired roots should not be missing sections");
passed += 5;

const task = { content: "Review the project plan" };
const context = { sourceTitle: "Project Plan", sourcePath: "Projects/Project Plan.md" };
const repairedDescription = validation.repairTaskDescriptionSourceReferences(
  "Project Plan states that the review must include dependency risks.",
  task,
  context,
  { title: context.sourceTitle, path: context.sourcePath }
);
assert.strictEqual(repairedDescription.summary, "The review must include dependency risks.", "leading source-note attribution should be repaired out of the narrative");
assert.strictEqual(validation.taskDescriptionSourceReferenceReason("Review the project plan", task, context), "description repeats task title", "title-only descriptions should fail validation");
assert.strictEqual(validation.taskDescriptionSourceReferenceReason("The Project Plan must include dependency risks.", task, context), "description directly references source note", "direct source-title prose should fail validation");
assert.strictEqual(validation.taskDescriptionSourceReferenceReason("Review the document for dependency risks.", task, context), "passed", "an action may legitimately refer to a document as its working artifact");
assert.strictEqual(validation.repairTaskDescriptionSourceReferences("According to the source note, the review must include dependency risks.", task, context, { title: context.sourceTitle, path: context.sourcePath }).summary, "The review must include dependency risks.", "explicit source attribution should be repaired from the narrative");
assert.strictEqual(validation.taskDescriptionSourceReferenceReason("Include dependency risks and confirm the review criteria.", task, context), "passed", "actionable prose without direct source references should pass");
passed += 6;

const descriptionInstruction = gateway.taskDescriptionSystemInstruction();
assert.ok(descriptionInstruction.indexOf("At the start of drafting") < descriptionInstruction.indexOf("Semantic context evidence bundles"), "source-reference rules must appear before semantic-context guidance");
assert.match(descriptionInstruction, /natural narrative prose/i, "description prompt must require narrative prose");
assert.match(descriptionInstruction, /context needed to accomplish the task accurately/i, "description prompt must require actionable context");
assert.match(descriptionInstruction, /validated independently after the cached batched generation call/i, "description prompt must explain independent validation and repair");
assert.match(descriptionInstruction, /semantic context evidence bundles/i, "description generation must explicitly inspect semantic context bundles");
assert.match(descriptionInstruction, /Sources\/Context Notes citation list/i, "description generation must reserve source references for the citation list");
passed += 6;

const semanticFact = {
  factId: "fact-semantic-context",
  evidenceId: "evidence-semantic-context",
  scopeId: "scope-1",
  type: "execution-detail",
  kind: "execution-detail",
  role: "supporting-context",
  sourceSurface: "Confirm the dependency review before sending",
  current: true,
  authorityState: "authoritative",
  conflictState: "none"
};
const semanticEvidence = {
  evidenceId: semanticFact.evidenceId,
  sourceKind: "semantic-context",
  current: true,
  authorityState: "authoritative",
  conflictState: "none"
};
const requiredFactCheck = validation.validateTaskDescriptionSentences(
  {
    description_sentences: [{ text: "Send the reviewed plan.", evidence_ids: ["evidence-source"], fact_refs: ["fact-source"] }]
  },
  {},
  {
    scopeId: "scope-1",
    evidenceIds: ["evidence-source", semanticEvidence.evidenceId],
    factRefs: ["fact-source", semanticFact.factId],
    bundle: {
      items: [{ evidenceId: "evidence-source", sourceKind: "current-source", current: true, authorityState: "authoritative", conflictState: "none" }, semanticEvidence],
      facts: [{ factId: "fact-source", evidenceId: "evidence-source", scopeId: "scope-1", type: "action", kind: "action", role: "requested-action" }, semanticFact],
      factBindings: [
        { factId: "fact-source", evidenceId: "evidence-source", scopeId: "scope-1", type: "action", role: "requested-action" },
        { factId: semanticFact.factId, evidenceId: semanticFact.evidenceId, scopeId: "scope-1", type: semanticFact.type, role: semanticFact.role }
      ]
    },
    requiredDescriptionFactRefs: [semanticFact.factId]
  },
  null,
  [{ evidenceId: "evidence-source", number: 1 }]
);
assert.strictEqual(requiredFactCheck.valid, false, "omitting selected semantic execution context must fail description validation");
assert.ok(requiredFactCheck.errors.includes(`description-required-fact-missing:${semanticFact.factId}`), "missing semantic execution context must be diagnosable");
passed += 2;

process.stdout.write(JSON.stringify({
  passed,
  failed: 0,
  checks: [
    "generated-root-task-section-repair",
    "description-title-and-source-reference-validation",
    "semantic-context-and-citation-only-prompt-guidance",
    "required-semantic-context-fact-coverage"
  ]
}, null, 2) + "\n");
