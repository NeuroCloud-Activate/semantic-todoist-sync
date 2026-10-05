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
    generatedTaskWorkflowQualityReport,
    generatedTaskPriorityIssues,
    generatedTaskTemporalIssues,
    applyLocalGeneratedTaskQualityCorrections,
    today
  };`, mainPath);
  pluginApi = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const { DEFAULT_SETTINGS } = pluginApi;
const { taskWorkflowSystemInstruction, taskGenerationRequirements, generatedTaskWorkflowQualityReport, generatedTaskPriorityIssues, generatedTaskTemporalIssues, applyLocalGeneratedTaskQualityCorrections, today } = pluginApi.__taskMetadataPlanningInstructionsTest;
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

// --- Content-based priority inference and workload date/deadline estimates ---
// Defaults must authorize the model to infer priority 1-4 from a task's own
// content and to estimate due dates and deadlines from urgency/workload plus
// the supplied planning date. Estimates are planning judgments, not source facts.
for (const key of ["priorityInstructions", "notePriorityInstructions", "emailPriorityInstructions"]) {
  assert.match(DEFAULT_SETTINGS[key], /urgency|importance|complexity/i, `default ${key} must authorize content-based priority inference`);
}
for (const key of ["dateInstructions", "noteDateInstructions", "emailDateInstructions"]) {
  assert.match(DEFAULT_SETTINGS[key], /urgency|workload|complexity/i, `default ${key} must authorize workload date/deadline estimation`);
}
// Existing users who kept a previous default must be migrated to the
// authorizing default rather than silently losing inference support.
for (const previousDefault of [
  "Assign priority 1 to 4 to each task and subtask, where 4 is highest priority and 1 is no priority.",
  "Assign priority 1 to 4 to each email-derived task and subtask, where 4 is highest priority and 1 is no priority.",
  "Assign priority 1 to 4 to each note-derived task and subtask, where 4 is highest priority and 1 is no priority.",
  "Determine a task completion deadline and a due date for each main task based on urgency, priority, and complexity. Do not add due dates to subtasks. Avoid weekends and the holidays that apply to the user's locale.",
  "Determine due dates and deadlines from the email's urgency, stated dates, complexity, and sender expectations. Avoid weekends and the holidays that apply to the user's locale. Do not add due dates to subtasks.",
  "Determine due dates and deadlines from the note's timing, urgency, complexity, and any explicit dates. Avoid weekends and the holidays that apply to the user's locale. Do not add due dates to subtasks."
]) {
  assert.ok(mainSource.includes(previousDefault), `settings migration must remap the previous default: ${previousDefault.slice(0, 40)}...`);
}

const urgencyEvidence = "Please review the urgent audit report and respond immediately.";
const dateAfterDays = (days) => {
  const date = new Date(`${today()}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const urgencyTask = (priority, overrides = {}) => ({
  content: "Review the urgent audit report",
  priority,
  due_date: null,
  deadline_date: null,
  subtasks: [],
  ...overrides
});
const priorityIssuesFor = (task, instructions = DEFAULT_SETTINGS.priorityInstructions) =>
  generatedTaskPriorityIssues([task], urgencyEvidence, instructions, DEFAULT_SETTINGS);

assert.ok(
  !priorityIssuesFor(urgencyTask(4)).some((issue) => issue.code === "unsupported-high-priority"),
  "content urgency must support priority 4 under an inference-authorized rule"
);
assert.ok(
  !priorityIssuesFor(urgencyTask(4, { due_date: dateAfterDays(1) })).some((issue) => issue.code === "unsupported-high-priority"),
  "content-urgent priority 4 with a near date must be accepted"
);
assert.ok(
  !priorityIssuesFor(urgencyTask(2)).some((issue) => issue.code === "under-prioritized-urgent-task"),
  "an inference-authorized priority rule must let the model judge a content-urgent task as priority 2"
);
assert.ok(
  priorityIssuesFor({ content: "File routine form", priority: 4, due_date: null, deadline_date: null, subtasks: [] })
    .some((issue) => issue.code === "unsupported-high-priority"),
  "priority 4 with no urgency at all must stay flagged"
);
assert.ok(
  priorityIssuesFor(urgencyTask(2), "Assign priority 1 to 4.")
    .some((issue) => issue.code === "under-prioritized-urgent-task"),
  "a non-authorizing priority rule must keep the existing under-prioritized flag"
);

const inWindowDate = dateAfterDays(30);
const outOfWindowDate = dateAfterDays(600);
const inferenceDateTask = (overrides = {}) => ({ content: "Prepare the audit summary", priority: 1, due_date: null, deadline_date: null, subtasks: [], ...overrides });

assert.ok(
  !generatedTaskTemporalIssues([inferenceDateTask({ deadline_date: inWindowDate })], urgencyEvidence, { inferenceAuthorized: true })
    .some((issue) => issue.code === "implausible-deadline-date"),
  "an authorized inferred deadline within the planning horizon must be accepted"
);
assert.ok(
  generatedTaskTemporalIssues([inferenceDateTask({ deadline_date: outOfWindowDate })], urgencyEvidence, { inferenceAuthorized: true })
    .some((issue) => issue.code === "implausible-deadline-date"),
  "an out-of-window inferred deadline must stay rejected"
);
assert.ok(
  generatedTaskTemporalIssues([inferenceDateTask({ deadline_date: inWindowDate })], urgencyEvidence, { inferenceAuthorized: false })
    .some((issue) => issue.code === "implausible-deadline-date"),
  "an inferred deadline without date-rule authorization must be rejected"
);
assert.ok(
  generatedTaskTemporalIssues([inferenceDateTask({ due_date: inWindowDate })], `The deadline is ${inWindowDate}.`)
    .some((issue) => issue.code === "explicit-deadline-used-as-due-date"),
  "explicit deadline role misuse must stay rejected"
);
const invalidDateReport = generatedTaskWorkflowQualityReport(
  [inferenceDateTask({ deadline_date: "2026/12/31" })],
  { priorityInstructions: DEFAULT_SETTINGS.priorityInstructions, dateInstructions: DEFAULT_SETTINGS.dateInstructions },
  { sourceContext: { title: "Audit", text: urgencyEvidence }, citeContextNotes: false },
  DEFAULT_SETTINGS
);
assert.ok(
  invalidDateReport.issues.some((issue) => issue.code === "invalid-deadline-date"),
  "malformed inferred dates must stay rejected"
);

const authorizedCorrections = [inferenceDateTask({ deadline_date: inWindowDate })];
applyLocalGeneratedTaskQualityCorrections(authorizedCorrections, {
  sourceEvidence: urgencyEvidence,
  priorityInstructions: DEFAULT_SETTINGS.priorityInstructions,
  dateInstructions: DEFAULT_SETTINGS.dateInstructions,
  settings: DEFAULT_SETTINGS
});
assert.strictEqual(authorizedCorrections[0].deadline_date, inWindowDate, "authorized inferred values must not be nulled");
const unauthorizedCorrections = [inferenceDateTask({ deadline_date: inWindowDate })];
applyLocalGeneratedTaskQualityCorrections(unauthorizedCorrections, {
  sourceEvidence: urgencyEvidence,
  priorityInstructions: DEFAULT_SETTINGS.priorityInstructions,
  dateInstructions: "Use YYYY-MM-DD dates only when supported by the source.",
  settings: DEFAULT_SETTINGS
});
assert.strictEqual(unauthorizedCorrections[0].deadline_date, null, "unauthorized inferred values must be nulled");

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
