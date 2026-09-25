"use strict";

const assert = require("assert");
const Module = require("module");

global.fetch = async () => {
  throw new Error("network access is disabled in this local harness");
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") {
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
      requestUrl() {
        throw new Error("Obsidian network access is disabled in this local harness");
      }
    };
  }
  if (["http", "https", "node:http", "node:https"].includes(request)) {
    throw new Error("network access is disabled in this local harness");
  }
  return originalLoad.call(this, request, parent, isMain);
};

let Plugin;
try {
  Plugin = require("../main.js");
} finally {
  Module._load = originalLoad;
}

const seams = Plugin.__taskFieldCompletion || {};
const failures = [];
function captureRegression(name, run) {
  try {
    run();
    process.stdout.write(`GREEN ${name}\n`);
  } catch (error) {
    failures.push(`${name}: ${error.message || error}`);
    process.stdout.write(`RED ${name}: ${(error.message || error).split("\n")[0]}\n`);
  }
}

function sourceTask(content = "Review Example Research audit") {
  return { content, priority: 1, labels: [], due_date: null, deadline_date: null, subtasks: [] };
}

function markedActionFact(factId, scopeId, sourceId, sourceSurface, overrides = {}) {
  return {
    factId,
    type: "task-action",
    role: "requested-action",
    evidenceId: `evidence-${factId}`,
    scopeId,
    sourceId,
    current: true,
    authorityState: "authoritative",
    conflictState: "none",
    kind: "marked-action",
    sourceSurface,
    ...overrides
  };
}

function taskWithFacts(content, { scopeId, sourceContractId, factRefs, facts }) {
  return {
    ...sourceTask(content),
    scope_id: scopeId,
    fact_refs: factRefs,
    evidenceBundle: { sourceContractId, facts }
  };
}

captureRegression("empty allowlist preserves model labels", () => {
  assert.strictEqual(typeof seams.labelsAllowedByInstructions, "function", "label instruction helper seam must be available");
  assert.strictEqual(typeof seams.cleanTask, "function", "task cleaner seam must be available");
  const allowed = seams.labelsAllowedByInstructions("");
  assert.strictEqual(allowed, null, "no configured label rules means no allowlist");
  assert.deepStrictEqual(
    seams.cleanTask({ content: "Review audit", labels: ["FollowUp"] }, allowed).labels,
    ["FollowUp"],
    "an unconfigured allowlist must preserve a model-returned label"
  );
});

captureRegression("explicit opt-out still filters every model label", () => {
  assert.strictEqual(typeof seams.labelsAllowedByInstructions, "function", "label instruction helper seam must be available");
  assert.strictEqual(typeof seams.cleanTask, "function", "task cleaner seam must be available");
  const allowed = seams.labelsAllowedByInstructions("Do not add labels.");
  assert.ok(allowed instanceof Set, "an explicit opt-out must remain an empty Set");
  assert.deepStrictEqual(seams.cleanTask({ content: "Review audit", labels: ["FollowUp"] }, allowed).labels, []);
});

captureRegression("named label allowlist filters to its own labels", () => {
  assert.strictEqual(typeof seams.labelsAllowedByInstructions, "function", "label instruction helper seam must be available");
  assert.strictEqual(typeof seams.cleanTask, "function", "task cleaner seam must be available");
  const allowed = seams.labelsAllowedByInstructions("Add #FollowUp when contacting the team.");
  assert.deepStrictEqual(
    seams.cleanTask({ content: "Contact team", labels: ["FollowUp", "Urgent"] }, allowed).labels,
    ["FollowUp"],
    "a named allowlist must pass only the named label"
  );
});

captureRegression("explicit priority marker fills only the default", () => {
  assert.strictEqual(typeof seams.completeEmptyGeneratedTaskFields, "function", "task-field completion seam must be available");
  const marked = taskWithFacts("Review Example Research audit", {
    scopeId: "scope-priority",
    sourceContractId: "contract-priority",
    factRefs: ["priority-fact"],
    facts: [markedActionFact("priority-fact", "scope-priority", "contract-priority", "- Review Example Research audit !!3")]
  });
  const absent = sourceTask("Prepare annual vacation request");
  const provided = taskWithFacts("Review financial statement", {
    scopeId: "scope-provided-priority",
    sourceContractId: "contract-provided-priority",
    factRefs: ["provided-priority-fact"],
    facts: [markedActionFact("provided-priority-fact", "scope-provided-priority", "contract-provided-priority", "- Review financial statement !!2")]
  });
  provided.priority = 4;
  seams.completeEmptyGeneratedTaskFields([marked, absent, provided], {
    sourceEvidence: "- Review Example Research audit !!3\n- Prepare annual vacation request",
    labelInstructions: "",
    settings: Plugin.DEFAULT_SETTINGS
  });
  assert.strictEqual(marked.priority, 3, "!!3 must fill a priority-1 main task");
  assert.strictEqual(absent.priority, 1, "priority 1 must remain when no marker exists");
  assert.strictEqual(provided.priority, 4, "an explicit model priority must not be overwritten");
});

captureRegression("explicit due date and deadline markers fill only null fields", () => {
  assert.strictEqual(typeof seams.completeEmptyGeneratedTaskFields, "function", "task-field completion seam must be available");
  const marked = taskWithFacts("Review Example Research audit", {
    scopeId: "scope-dates",
    sourceContractId: "contract-dates",
    factRefs: ["date-fact"],
    facts: [markedActionFact("date-fact", "scope-dates", "contract-dates", "- Review Example Research audit 📅 2026-10-15 {{2026-10-16}}")]
  });
  const absent = sourceTask("Prepare annual vacation request");
  const provided = taskWithFacts("Review financial statement", {
    scopeId: "scope-provided-dates",
    sourceContractId: "contract-provided-dates",
    factRefs: ["provided-date-fact"],
    facts: [markedActionFact("provided-date-fact", "scope-provided-dates", "contract-provided-dates", "- Review financial statement 📅 2026-11-15 {{2026-11-16}}")]
  });
  provided.due_date = "2026-10-20";
  provided.deadline_date = "2026-10-21";
  seams.completeEmptyGeneratedTaskFields([marked, absent, provided], {
    sourceEvidence: "- Review Example Research audit 📅 2026-10-15 {{2026-10-16}}\n- Prepare annual vacation request",
    labelInstructions: "",
    settings: Plugin.DEFAULT_SETTINGS
  });
  assert.strictEqual(marked.due_date, "2026-10-15", "📅 date must fill a null due_date");
  assert.strictEqual(marked.deadline_date, "2026-10-16", "{{date}} must fill a null deadline_date");
  assert.strictEqual(absent.due_date, null, "due_date must remain null without a marker");
  assert.strictEqual(absent.deadline_date, null, "deadline_date must remain null without a marker");
  assert.strictEqual(provided.due_date, "2026-10-20", "a model due_date must not be overwritten");
  assert.strictEqual(provided.deadline_date, "2026-10-21", "a model deadline_date must not be overwritten");
});

captureRegression("sibling, ambiguous, non-current, or mismatched facts cannot fill task fields", () => {
  assert.strictEqual(typeof seams.completeEmptyGeneratedTaskFields, "function", "task-field completion seam must be available");
  const sibling = taskWithFacts("Review Example Research audit", {
    scopeId: "scope-sibling",
    sourceContractId: "contract-sibling",
    factRefs: ["own-fact"],
    facts: [
      markedActionFact("own-fact", "scope-sibling", "contract-sibling", "- Review Example Research audit"),
      markedActionFact("sibling-fact", "scope-sibling", "contract-sibling", "- Contact sibling team !!4 📅 2026-10-11 {{2026-10-12}}")
    ]
  });
  const ambiguous = taskWithFacts("Review audit", {
    scopeId: "scope-ambiguous",
    sourceContractId: "contract-ambiguous",
    factRefs: ["ambiguous-one", "ambiguous-two"],
    facts: [
      markedActionFact("ambiguous-one", "scope-ambiguous", "contract-ambiguous", "- Review audit !!2 📅 2026-10-13 {{2026-10-14}}"),
      markedActionFact("ambiguous-two", "scope-ambiguous", "contract-ambiguous", "- Review audit !!4 📅 2026-10-15 {{2026-10-16}}")
    ]
  });
  const nonCurrent = taskWithFacts("Prepare annual vacation request", {
    scopeId: "scope-history",
    sourceContractId: "contract-history",
    factRefs: ["historical-fact"],
    facts: [markedActionFact("historical-fact", "scope-history", "contract-history", "- Prepare vacation request !!3 📅 2026-10-17 {{2026-10-18}}", { current: false })]
  });
  const wrongScope = taskWithFacts("Review audit", {
    scopeId: "scope-expected",
    sourceContractId: "contract-scope",
    factRefs: ["wrong-scope-fact"],
    facts: [markedActionFact("wrong-scope-fact", "scope-other", "contract-scope", "- Review audit !!3 📅 2026-10-19 {{2026-10-20}}")]
  });
  const wrongSource = taskWithFacts("Review audit", {
    scopeId: "scope-source",
    sourceContractId: "contract-expected",
    factRefs: ["wrong-source-fact"],
    facts: [markedActionFact("wrong-source-fact", "scope-source", "contract-other", "- Review audit !!3 📅 2026-10-21 {{2026-10-22}}")]
  });
  const conflicting = taskWithFacts("Review audit", {
    scopeId: "scope-conflict",
    sourceContractId: "contract-conflict",
    factRefs: ["conflicting-fact"],
    facts: [markedActionFact("conflicting-fact", "scope-conflict", "contract-conflict", "- Review audit !!3 📅 2026-10-23 {{2026-10-24}}", { conflictState: "conflicting" })]
  });
  const nonAuthoritative = taskWithFacts("Review audit", {
    scopeId: "scope-authority",
    sourceContractId: "contract-authority",
    factRefs: ["non-authoritative-fact"],
    facts: [markedActionFact("non-authoritative-fact", "scope-authority", "contract-authority", "- Review audit !!3 📅 2026-10-25 {{2026-10-26}}", { authorityState: "inferred" })]
  });
  const rejected = [sibling, ambiguous, nonCurrent, wrongScope, wrongSource, conflicting, nonAuthoritative];
  seams.completeEmptyGeneratedTaskFields(rejected, {
    sourceEvidence: "- Contact sibling team !!4 📅 2026-10-11 {{2026-10-12}}",
    labelInstructions: "",
    settings: Plugin.DEFAULT_SETTINGS
  });
  for (const [index, task] of rejected.entries()) {
    assert.strictEqual(task.priority, 1, `ineligible fact case ${index} must preserve priority 1`);
    assert.strictEqual(task.due_date, null, `ineligible fact case ${index} must preserve null due_date`);
    assert.strictEqual(task.deadline_date, null, `ineligible fact case ${index} must preserve null deadline_date`);
  }
});

captureRegression("configured label rules apply only when title or task evidence matches", () => {
  assert.strictEqual(typeof seams.completeEmptyGeneratedTaskFields, "function", "task-field completion seam must be available");
  const matching = sourceTask("Review Example Research audit");
  const nonMatching = sourceTask("Prepare annual vacation request");
  const instructions = "Add #Compliance for tasks involving Example Research.";
  seams.completeEmptyGeneratedTaskFields([matching, nonMatching], {
    sourceEvidence: "- Review Example Research audit\n- Prepare annual vacation request",
    labelInstructions: instructions,
    settings: Plugin.DEFAULT_SETTINGS
  });
  assert.deepStrictEqual(matching.labels, ["Compliance"], "a matching rule must add its configured label");
  assert.deepStrictEqual(nonMatching.labels, [], "a non-matching rule must not add a label");
});

if (failures.length) throw new Error(`task field completion regressions failed:\n${failures.join("\n")}`);
process.stdout.write("task field completion test passed\n");
