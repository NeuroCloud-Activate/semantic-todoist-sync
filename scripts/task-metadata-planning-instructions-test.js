"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

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
    ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty,
    Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty,
    TFile: Empty, setIcon() {}, requestUrl() { throw new Error("Network disabled in local test."); }
  };
};

let pluginApi;
try {
  testModule._compile(`${mainSource}\nmodule.exports.__taskMetadataPlanningInstructionsTest = {
    taskWorkflowSystemInstruction,
    taskGenerationRequirements,
    generatedTaskWorkflowQualityReport
  };`, mainPath);
  pluginApi = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const { DEFAULT_SETTINGS } = pluginApi;
const { taskWorkflowSystemInstruction, taskGenerationRequirements, generatedTaskWorkflowQualityReport } = pluginApi.__taskMetadataPlanningInstructionsTest;
const blankInstructions = { main: "", sectionTitle: "", tags: "", priorities: "", dates: "", subtasks: "" };
const defaultPrompt = taskGenerationRequirements(blankInstructions, {
  ...DEFAULT_SETTINGS,
  subtaskIncludeLabels: false,
  subtaskIncludePriority: false,
  subtaskIncludeDueDate: false,
  subtaskIncludeDeadline: false
});
const systemPrompt = taskWorkflowSystemInstruction();

assert.match(systemPrompt, /Metadata fields may be assigned as configured classifications or planning judgments/);
assert.match(systemPrompt, /never resolve source-relative terms from the current local planning date/);
assert.match(systemPrompt, /never invent a source date/);
assert.match(defaultPrompt, /For every task and subtask, independently evaluate labels, priority, due_date, and deadline_date/);
assert.match(defaultPrompt, /Do not require literal hashtags, priority markers, or ISO date tokens unless the saved instruction explicitly requires them/);
assert.match(defaultPrompt, /Empty labels, priority 1, and null dates are valid when no different value is supported/);
assert.match(defaultPrompt, /Labels: Do not add labels unless explicitly instructed\./);
assert.match(defaultPrompt, /Priority: Assign priority 1 to 4\./);
assert.match(defaultPrompt, /Use YYYY-MM-DD dates only when supported by the source\./);
assert.doesNotMatch(defaultPrompt, /Use deadline_date only when this task's own evidence explicitly states a deadline/);
assert.match(defaultPrompt, /When the saved date instructions require an explicit deadline/);
assert.match(defaultPrompt, /Disabled\. Return an empty labels array for every subtask\./);
assert.match(defaultPrompt, /Disabled\. Return due_date null for every subtask\./);
assert.match(defaultPrompt, /Disabled\. Return deadline_date null for every subtask\./);

const configuredInstructions = {
  ...blankInstructions,
  tags: "Assign configured labels by each task's semantic category; preserve configured label names.",
  priorities: "Assign priority 1 to 4 from task urgency and importance.",
  dates: "Use task timing, urgency, and complexity for practical due-date planning when supported; keep deadlines explicit."
};
const configuredPrompt = taskGenerationRequirements(configuredInstructions, DEFAULT_SETTINGS);
for (const rule of [configuredInstructions.tags, configuredInstructions.priorities, configuredInstructions.dates]) {
  assert.ok(configuredPrompt.includes(rule), `configured metadata rule must remain unchanged: ${rule}`);
}

const semanticLabelTask = [{
  content: "Review audit",
  description: "Review the audit findings.",
  labels: ["FollowUp"],
  priority: 1,
  due_date: null,
  deadline_date: null,
  subtasks: []
}];
const reportForAllowedLabels = (allowedLabels) => generatedTaskWorkflowQualityReport(
  semanticLabelTask,
  { allowedLabels, labelInstructions: "Assign labels by task meaning." },
  { sourceContext: { title: "Audit", text: "Review audit findings." }, citeContextNotes: false },
  DEFAULT_SETTINGS
);
assert.ok(
  !reportForAllowedLabels(null).issues.some((issue) => issue.code === "label-not-allowed"),
  "an unconfigured allowlist must preserve a semantic label"
);
assert.ok(
  reportForAllowedLabels([]).issues.some((issue) => issue.code === "label-not-allowed"),
  "an explicit empty allowlist must reject the semantic label"
);
assert.ok(
  !reportForAllowedLabels(["FollowUp"]).issues.some((issue) => issue.code === "label-not-allowed"),
  "a named allowlist must admit its own label"
);

const requestStart = mainSource.indexOf("const requestTaskStructure = async");
assert.notEqual(requestStart, -1, "task structure request must exist");
const userStart = mainSource.indexOf("user: [", requestStart);
const userEnd = mainSource.indexOf("].filter(Boolean).join(\"\\n\\n\")", userStart);
assert.ok(userStart > requestStart && userEnd > userStart, "task structure user request must be identifiable");
const structureUserPrompt = mainSource.slice(userStart, userEnd);
assert.match(structureUserPrompt, /Current local planning date \(device local\):[^\n]*\$\{today\(\)\}/);
assert.ok(
  mainSource.indexOf("promptCachePrefix:", requestStart) < userStart,
  "current planning date must be passed outside the cached prefix"
);

console.log("Task metadata planning instructions: passed.");
