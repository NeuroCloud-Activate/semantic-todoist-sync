"use strict";

// Action-source gate on chunk-local markers: a note whose #todo action sits on a
// different chunk than the top query-handle chunk (list-group split) must not be
// blocked when the source contract already agrees on the action and scope line.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = path.join(__dirname, "..", "src/main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));

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
    requestUrl() { throw new Error("network disabled - requestUrl must not be called"); }
  };
};

let pluginApi;
try {
  testModule._compile(
    `${mainSource}\nmodule.exports.__testActionChunkGate = {\n` +
      "  explicitNoteActionMarkers, buildTaskSourceContract, chunkMarkdown\n" +
      "};\n",
    mainPath
  );
  pluginApi = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const { explicitNoteActionMarkers, buildTaskSourceContract, chunkMarkdown } =
  pluginApi.__testActionChunkGate;
const DEFAULT_SETTINGS = pluginApi.DEFAULT_SETTINGS;
const settings = Object.assign({}, DEFAULT_SETTINGS, { noteActionMarkerTags: ["#todo"] });

const failures = [];
function check(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); }
  catch (error) {
    failures.push(`${name}: ${error && error.message || error}`);
    console.error(`FAIL: ${name}: ${error && error.message || error}`);
  }
}

// The shipped gate text: from the chunk-local marker parse to the mismatch report.
const gateStart = mainSource.indexOf("const markerMatches = self ?");
const gatePush = mainSource.indexOf("action-source-mismatch:", gateStart);
assert.ok(gateStart >= 0 && gatePush > gateStart, "the action-source gate must exist in src/main.js");
const gateBody = mainSource.slice(gateStart, mainSource.indexOf("\n", gatePush)) + "\n}";
const runGate = new Function(
  "self", "actionText", "scopeForAction", "scopeId", "sourceContract", "sourcePath",
  "options", "DEFAULT_SETTINGS", "explicitNoteActionMarkers",
  "scoreMissingErrors", "taskKey", "queryHandleEvidenceId",
  `${gateBody}\nreturn scoreMissingErrors;`
);

const note = [
  "# Task test",
  "",
  "## Notes",
  "- plain bullet one",
  "- plain bullet two",
  "- [ ] #todo Add confidentiality language future targeted competition emails"
].join("\n");
const sourcePath = "Drafts/Task test.md";
const actionText = "Add confidentiality language future targeted competition emails";

const contract = buildTaskSourceContract({ type: "note", title: "Task test", path: sourcePath }, note, settings);
const scopeForAction = contract.scopes.find(
  (scope) => scope.family === "marked-action" && scope.action === actionText
);
assert.ok(scopeForAction, "the #todo line must produce a marked-action scope");

const chunks = chunkMarkdown(note);
const ranges = chunks.sourceLineRanges;
const markerChunkIndex = ranges.findIndex((range) => range.lineStart <= 6 && 6 <= range.lineEnd);
const selfChunkIndex = ranges.findIndex((range) => range.lineStart <= 4 && 4 <= range.lineEnd);
assert.ok(markerChunkIndex >= 0 && selfChunkIndex >= 0 && markerChunkIndex !== selfChunkIndex,
  "the marker line must sit in its own chunk apart from the top query-handle chunk");

const self = {
  evidenceId: "evidence-self",
  path: sourcePath,
  text: chunks[selfChunkIndex],
  lineStart: ranges[selfChunkIndex].lineStart,
  lineEnd: ranges[selfChunkIndex].lineEnd
};

check("chunk-local re-parse finds no marker (bug path)", () => {
  assert.equal(
    explicitNoteActionMarkers(self.text, settings).filter((marker) =>
      (marker.action === actionText
        || (marker.action.startsWith(actionText) && /^\s/.test(marker.action.slice(actionText.length))))
      && Array.isArray(scopeForAction.lines)
      && scopeForAction.lines.some((line) => Number(line) >= self.lineStart && Number(line) <= self.lineEnd)
    ).length,
    0,
    "expected 0 chunk-local matches: the [4,5] handle chunk carries no marker line"
  );
  assert.deepEqual(scopeForAction.lines, [6], "the scope must point at the real marker line");
  assert.equal(
    contract.explicitMarkers.find((marker) => marker.scopeId === scopeForAction.scopeId)?.action,
    actionText,
    "the source contract must carry the marker record for this scope"
  );
});

check("gate accepts an action whose marker lives on another chunk", () => {
  const errors = runGate(
    self, actionText, scopeForAction, scopeForAction.scopeId, contract, contract.path,
    { settings }, DEFAULT_SETTINGS, explicitNoteActionMarkers,
    [], "task-1", self.evidenceId
  );
  const mismatch = errors.filter((error) => error.startsWith("action-source-mismatch:"));
  assert.deepEqual(mismatch, [], "the gate must not block when the contract marker for the scope matches");
});

check("gate still blocks a wrong action", () => {
  const errors = runGate(
    self, "Some other action", scopeForAction, scopeForAction.scopeId, contract, contract.path,
    { settings }, DEFAULT_SETTINGS, explicitNoteActionMarkers,
    [], "task-1", self.evidenceId
  );
  assert.ok(
    errors.some((error) => error.startsWith("action-source-mismatch:")),
    "a wrong action must still be reported as action-source-mismatch"
  );
});

process.stdout.write(JSON.stringify({ passed: failures.length ? 0 : 3, failed: failures.length }, null, 2) + "\n");
if (failures.length) process.exit(1);
