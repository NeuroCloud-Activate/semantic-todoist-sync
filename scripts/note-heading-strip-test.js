"use strict";

const assert = require("assert");
const Module = require("module");

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
    requestUrl() {}
  };
};

const Plugin = require("../main.js");
Module._load = originalLoad;

const settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { noteActionMarkerTags: ["#todo"] });
assert.strictEqual(typeof Plugin.buildTaskSourceContract, "function", "the real source-contract builder must be exported");
assert.strictEqual(typeof Plugin.sourceContractSourceText, "function", "the real source-text builder (strip entry point) must be exported");

function contractFor(text, name) {
  const source = { type: "note", title: name, path: `${name}.md`, text };
  return Plugin.buildTaskSourceContract(source, Plugin.sourceContractSourceText(source, settings), settings);
}

function markerCountFor(heading) {
  return contractFor(`${heading}\n- #todo Add confidentiality language to emails\n`, `note under ${heading}`).explicitMarkers.length;
}

// Headings that merely start with Task/Tasks/Project but carry more words are
// ordinary note content: the #todo line beneath them must survive the strip.
const MUST_KEEP = [
  "# Task test",
  "## Tasks for Q4 planning",
  "# Project kickoff notes",
  "## Task-force update",
  "## Meeting Notes:"
];

// Genuine generated/standalone action-item headings: everything beneath them
// is plugin output and must still be stripped.
const MUST_STRIP = [
  "## Semantic Todoist Sync - Action Items",
  "## Action Items",
  "## Action Items:",
  "## Actionable Items from Note",
  "## Tasks",
  "## Tasks:",
  "## Task",
  "## Projects",
  "## Tasks & Projects",
  "## Tasks Completed",
  "## Tasks Processed",
  "## Tasks Delegated",
  "## \u2705 Action Items",
  "## Action Items   "
];

const failures = [];
for (const heading of MUST_KEEP) {
  try {
    assert.strictEqual(markerCountFor(heading), 1, `heading ${JSON.stringify(heading)} must not be stripped`);
  } catch (error) {
    failures.push(`KEEP ${error.message}`);
  }
}
for (const heading of MUST_STRIP) {
  try {
    assert.strictEqual(markerCountFor(heading), 0, `heading ${JSON.stringify(heading)} must still be stripped`);
  } catch (error) {
    failures.push(`STRIP ${error.message}`);
  }
}

const briefScenario = contractFor(
  "# Task test\n## Meeting Notes:\n- #todo Add confidentiality language to emails\n",
  "Task test note"
);
try {
  assert.strictEqual(briefScenario.explicitMarkers.length, 1, "the brief scenario note must yield one marker");
} catch (error) {
  failures.push(`SCENARIO ${error.message}`);
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  throw new Error(`${failures.length} note-heading strip cases failed`);
}
console.log("PASS: Task-prefixed note headings survive the generated-section strip");
