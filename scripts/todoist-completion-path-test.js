"use strict";

// Todoist completion must check the note line: pullTodoistUpdates ->
// setTaskLineChecked -> updateCachedLine must not write blindly to the stale
// settings.taskCache[taskId].path. When the cached path no longer holds the
// line, the write must re-resolve to the canonical note (or skip when the
// location is zero/ambiguous) instead of flipping the wrong note.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = path.join(__dirname, "..", "src/main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));

let TFileRef = null;
const originalLoad = Module._load;
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
  class TFile {}
  TFileRef = TFile;
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
    TFile,
    setIcon() {},
    requestUrl() { throw new Error("network disabled in local test"); },
  };
};

let pluginApi;
try {
  testModule._compile(`${mainSource}`, mainPath);
  pluginApi = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const TASK_ID = "6hmCc84rCV224xjV";
const OID = "Q7X2Z";
const SCRATCH = "Drafts/GUI validation tasks.md";
const REAL = "Drafts/Task test.md";
const uncheckedLine = `- [ ] Validate the GUI flow %%[oid:: ${OID}]%%`;
const checkedLine = `- [x] Validate the GUI flow %%[oid:: ${OID}]%%`;

function makeVaultHarness(files) {
  const store = new Map(Object.entries(files));
  const tfiles = new Map();
  for (const filePath of store.keys()) {
    const file = new TFileRef();
    file.path = filePath;
    tfiles.set(filePath, file);
  }
  const writes = [];
  return {
    writes,
    content: (filePath) => store.get(filePath),
    vault: {
      getAbstractFileByPath: (filePath) => tfiles.get(String(filePath)) || null,
      getMarkdownFiles: () => [...tfiles.values()],
      read: async (file) => store.get(file.path),
      modify: async (file, content) => { writes.push(file.path); store.set(file.path, content); },
    },
  };
}

function makePlugin(settings, vault) {
  const plugin = Object.create(pluginApi.prototype);
  plugin.settings = settings;
  plugin.app = { vault };
  plugin.logCalls = [];
  plugin.logLocal = (message, details) => { plugin.logCalls.push([message, details]); };
  plugin.markTaskReferenceStateDirty = () => {};
  plugin.markInternalNoteWrite = () => {};
  return plugin;
}

function settingsWithStaleCache() {
  const settings = Object.assign({}, pluginApi.DEFAULT_SETTINGS, { taskCache: {} });
  settings.taskCache[TASK_ID] = { oid: OID, path: SCRATCH, isCompleted: false };
  return settings;
}

async function main() {
  // Case A: cached path is stale (no matching line); exactly one canonical
  // note holds the line -> completion must land there, and the cache path
  // must follow it.
  {
    const harness = makeVaultHarness({
      [SCRATCH]: "# Scratch\n- [ ] unrelated scratch item\n",
      [REAL]: `${uncheckedLine}\n`,
    });
    const settings = settingsWithStaleCache();
    const plugin = makePlugin(settings, harness.vault);
    await plugin.setTaskLineChecked(TASK_ID, true);
    assert.equal(
      harness.content(REAL),
      `${checkedLine}\n`,
      "completion must check the line in the canonical note holding it"
    );
    assert.equal(
      harness.content(SCRATCH),
      "# Scratch\n- [ ] unrelated scratch item\n",
      "stale cached note must stay untouched"
    );
    assert.equal(settings.taskCache[TASK_ID].path, REAL, "stale cache path must update to the canonical note");
  }

  // Case B: the cached path is stale and the same task line exists in two
  // other notes (ambiguous) -> skip the write entirely (never blind-write),
  // leave the cache path alone, and log the skip.
  {
    const OTHER = "Drafts/Other validation.md";
    const harness = makeVaultHarness({
      [SCRATCH]: "# Scratch\n- [ ] unrelated scratch item\n",
      [REAL]: `${uncheckedLine}\n`,
      [OTHER]: `${uncheckedLine}\n`,
    });
    const settings = settingsWithStaleCache();
    const plugin = makePlugin(settings, harness.vault);
    await plugin.setTaskLineChecked(TASK_ID, true);
    assert.deepEqual(harness.writes, [], "ambiguous completion must not write to any note");
    assert.equal(harness.content(REAL), `${uncheckedLine}\n`, "ambiguous completion must not guess the first note");
    assert.equal(harness.content(OTHER), `${uncheckedLine}\n`, "ambiguous completion must not guess the second note");
    assert.equal(settings.taskCache[TASK_ID].path, SCRATCH, "ambiguous completion must not move the cache path");
    assert.ok(plugin.logCalls.length > 0, "ambiguous completion must log the skip");
  }

  console.log("todoist completion path: passed (canonical write + no stale miswrite).");
}

main().catch((error) => {
  console.error(`todoist completion path FAILED: ${error && error.message || error}`);
  process.exit(1);
});
