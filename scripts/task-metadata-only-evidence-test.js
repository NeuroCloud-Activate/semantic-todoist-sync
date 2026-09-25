"use strict";

// Exclude standalone empty headings and tag-only semantic chunks while keeping
// substantive short statements and mixed body text eligible as task evidence.
// Set STSYNC_TEST_MAIN_SOURCE to run against a private patched source copy.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = path.join(__dirname, "..", "main.js");
const sourcePath = process.env.STSYNC_TEST_MAIN_SOURCE || mainPath;
const mainSource = fs.readFileSync(sourcePath, "utf8");
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
  testModule._compile(`${mainSource}\nmodule.exports.__metadataOnlyEvidenceTest = {
    buildTaskSourceContract,
    buildTaskEvidenceCatalog
  };`, mainPath);
  pluginApi = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const { DEFAULT_SETTINGS } = pluginApi;
const { buildTaskSourceContract, buildTaskEvidenceCatalog } = pluginApi.__metadataOnlyEvidenceTest;
const settings = Object.assign({}, DEFAULT_SETTINGS);
const source = { type: "note", title: "Synthetic meeting notes", path: "Planning/Synthetic meeting notes.md" };
const sourceText = "Meeting notes:\nThe clinic approved the updated schedule.";
const contract = buildTaskSourceContract(source, sourceText, settings);

const chunks = [
  { id: "empty-heading", evidenceId: "evidence-empty-heading", text: "Meeting notes:" },
  { id: "tag-only", evidenceId: "evidence-tag-only", text: "rrTags: #MeetingNotes" },
  { id: "short-substantive", evidenceId: "evidence-short-substantive", text: "The clinic approved it." },
  { id: "mixed-body", evidenceId: "evidence-mixed-body", text: "Meeting notes:\nThe clinic confirmed the October 15 schedule." },
  { id: "deadline-value", evidenceId: "evidence-deadline-value", text: "Deadline: 2026-10-15" },
  { id: "tags-with-body", evidenceId: "evidence-tags-with-body", text: "Tags: #Finance\nSend the approved budget." }
];
const catalog = buildTaskEvidenceCatalog(contract, chunks, settings, { source, sourceSummary: sourceText });
const admittedIds = catalog.items.map((item) => item.evidenceId);
const rejectedIds = catalog.telemetry.metadataOnlyRejectedEvidenceIds;

assert.ok(rejectedIds.includes("evidence-empty-heading"), "standalone empty Meeting notes heading should be rejected as metadata-only");
assert.ok(rejectedIds.includes("evidence-tag-only"), "rrTags-only body should be rejected as metadata-only");
assert.ok(!admittedIds.includes("evidence-empty-heading"), "empty heading must not enter the evidence catalog");
assert.ok(!admittedIds.includes("evidence-tag-only"), "tag-only row must not enter the evidence catalog");
assert.ok(admittedIds.includes("evidence-short-substantive"), "short substantive statement must remain eligible");
assert.ok(admittedIds.includes("evidence-mixed-body"), "heading plus substantive body must remain eligible");
assert.ok(admittedIds.includes("evidence-deadline-value"), "a populated deadline field must remain eligible evidence");
assert.ok(admittedIds.includes("evidence-tags-with-body"), "a tag line with substantive body must remain eligible");

console.log(`Task metadata-only evidence: passed (${sourcePath === mainPath ? "repository source" : "source override"}).`);
