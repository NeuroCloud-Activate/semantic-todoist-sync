"use strict";

// Generated citation-bearing descriptions must survive pending -> cached ->
// reference-cache synchronization. Set STSYNC_TEST_MAIN_SOURCE to run against
// a private patched source copy.

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
  testModule._compile(`${mainSource}\nmodule.exports.__descriptionSyncTest = {
    descriptionStateForParsedTask: module.exports.prototype.descriptionStateForParsedTask,
    pendingDescriptionForParsedTask: module.exports.prototype.pendingDescriptionForParsedTask,
    cacheTask: module.exports.prototype.cacheTask,
    referenceCacheEntry,
    pendingTaskOidKey,
    formatTodoistDescription,
    sanitizeStoredTodoistDescription
  };`, mainPath);
  pluginApi = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const { DEFAULT_SETTINGS } = pluginApi;
const testApi = pluginApi.__descriptionSyncTest;
const settings = Object.assign({}, DEFAULT_SETTINGS, { taskCache: {}, pendingTaskDescriptions: {} });
const task = {
  id: "synthetic-todoist-1",
  oid: "stsync-synthetic-1",
  path: "Planning/Clinic plan.md",
  lineNumber: 1,
  content: "Follow up with the clinic",
  isSubtask: false,
  labels: ["FollowUp"],
  priority: 4,
  due_date: "2026-10-15",
  deadline_date: "2026-10-20"
};
const pendingDescription = [
  "Please tag the clinic coordinator after confirming the October schedule (1).",
  "",
  "Sources:",
  "1. Planning/Clinic plan.md"
].join("\n");
const expectedDescription = testApi.formatTodoistDescription(pendingDescription, settings);
settings.pendingTaskDescriptions[testApi.pendingTaskOidKey(task.path, task.oid)] = expectedDescription;

const pluginContext = {
  settings,
  pendingDescriptionForParsedTask: testApi.pendingDescriptionForParsedTask
};
const parsedDescription = testApi.descriptionStateForParsedTask.call(pluginContext, task);
assert.equal(parsedDescription.descriptionShouldSync, true, "pending generated description should be marked for sync");
assert.equal(parsedDescription.description, expectedDescription, "pending citation description must survive description-state projection exactly");

const cacheContext = {
  settings,
  app: {},
  markTaskReferenceStateDirty() {},
  queueTaskReferenceIndexUpdate() {},
  observeSchedulerMemoryForTask() {}
};
testApi.cacheTask.call(cacheContext, task.id, Object.assign({}, task, { description: parsedDescription.description }));
assert.equal(settings.taskCache[task.id].description, expectedDescription, "cacheTask must preserve the synced rich description exactly");

const reloaded = testApi.referenceCacheEntry(task.id, Object.assign({}, task, {
  description: settings.taskCache[task.id].description
}), settings, null);
assert.equal(reloaded.description, expectedDescription, "reference-cache reload must preserve the rich description exactly");

const legacy = "Project: North Clinic\nThe clinic confirmed the mobile drive schedule for October and assigned a coordinator.";
const legacyStored = testApi.sanitizeStoredTodoistDescription(legacy, settings);
assert.ok(!legacyStored.includes("Project:"), "legacy unstructured metadata should still be sanitized");
assert.match(legacyStored, /The clinic confirmed the mobile drive schedule/, "legacy substantive summary should remain");

console.log(`Task description sync preservation: passed (${sourcePath === mainPath ? "repository source" : "source override"}).`);
