"use strict";

// scripts/description-warm-skip-test.js — Task 5: skip warm-first when the cache is warm.
// Harness pattern: Module._compile of main.js + module.exports.__testX suffix,
// stubbed obsidian, check(failures,name,fn), exit 1 on failures.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = path.join(__dirname, "..", "main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request !== "obsidian") return originalLoad.call(this, request, parent, isMain);
  class Empty {}
  return {
    ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty,
    Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty,
    TFile: Empty, setIcon() {}, requestUrl() { throw new Error("network disabled"); },
  };
};

let pluginApi;
try {
  const testModule = new Module(mainPath, module);
  testModule.filename = mainPath;
  testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
  testModule._compile(
    `${mainSource}\nmodule.exports.__testDescriptionWarm = {\n` +
      "  descriptionPhaseDispatch,\n" +
      "  DESCRIPTION_WARM_REUSE_MS\n" +
      "};\n",
    mainPath
  );
  pluginApi = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const { descriptionPhaseDispatch, DESCRIPTION_WARM_REUSE_MS } = pluginApi.__testDescriptionWarm;

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error && error.message || error}`);
    console.error(`FAIL: ${name}: ${error && error.message || error}`);
  }
}

// Fake clock: stub Date.now globally around each dispatch.
let clock = 1000000;
const realDateNow = Date.now;
Date.now = () => clock;

// A worker that records start/complete order and yields once between them,
// so serial vs parallel dispatch is observable deterministically (no timers):
// in warm-first serial mode, target#1 completes before #2 starts; in pooled
// mode every worker records its start before any completion drains.
function makeWorker(events, mode) {
  return async (task, index) => {
    events.push(`start:${task.id}`);
    await Promise.resolve();
    if (mode === "reject" && index === 0) throw new Error("warm worker failed");
    events.push(`complete:${task.id}`);
  };
}

function targets(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `t${i}`, index: i }));
}

async function main() {
  await check("warm reuse window is 270000 ms", () => {
    assert.strictEqual(DESCRIPTION_WARM_REUSE_MS, 270000);
  });

  await check("first dispatch warms", async () => {
    clock = 1000000;
    const plugin = {};
    const events = [];
    await descriptionPhaseDispatch(targets(4), 4, makeWorker(events, "ok"), true, "prov|model|hash", plugin);
    const completeFirst = events.indexOf("complete:t0");
    const startSecond = events.indexOf("start:t1");
    assert.ok(completeFirst !== -1 && startSecond !== -1, `expected starts+completes, got [${events.join(",")}]`);
    assert.ok(completeFirst < startSecond, `target#1 must complete before #2 starts, got [${events.join(",")}]`);
  });

  await check("second dispatch within window skips warm", async () => {
    clock = 1000000;
    const plugin = {};
    const warmEvents = [];
    await descriptionPhaseDispatch(targets(4), 4, makeWorker(warmEvents, "ok"), true, "prov|model|hash", plugin);
    clock = 1060000; // +60000 ms, inside the 270000 ms window
    const events = [];
    await descriptionPhaseDispatch(targets(4), 4, makeWorker(events, "ok"), true, "prov|model|hash", plugin);
    const startFirst = events.indexOf("start:t0");
    const startSecond = events.indexOf("start:t1");
    const completeFirst = events.indexOf("complete:t0");
    assert.ok(startFirst !== -1 && startSecond !== -1, `expected starts, got [${events.join(",")}]`);
    assert.ok(startSecond < completeFirst, `first two workers must start before worker 0 completes, got [${events.join(",")}]`);
  });

  await check("expired key warms again", async () => {
    clock = 1000000;
    const plugin = {};
    await descriptionPhaseDispatch(targets(4), 4, makeWorker([], "wait"), true, "prov|model|hash", plugin);
    clock = 1000000 + 270001;
    const events = [];
    await descriptionPhaseDispatch(targets(4), 4, makeWorker(events, "ok"), true, "prov|model|hash", plugin);
    const completeFirst = events.indexOf("complete:t0");
    const startSecond = events.indexOf("start:t1");
    assert.ok(completeFirst < startSecond, `expired key must warm serially again, got [${events.join(",")}]`);
  });

  await check("other model warms", async () => {
    clock = 1000000;
    const plugin = {};
    await descriptionPhaseDispatch(targets(4), 4, makeWorker([], "wait"), true, "prov|model-a|hash", plugin);
    clock = 1001000; // +1000 ms but a different key
    const events = [];
    await descriptionPhaseDispatch(targets(4), 4, makeWorker(events, "wait"), true, "prov|model-b|hash", plugin);
    const completeFirst = events.indexOf("complete:t0");
    const startSecond = events.indexOf("start:t1");
    assert.ok(completeFirst < startSecond, `different key must warm serially, got [${events.join(",")}]`);
  });

  await check("failed warm not recorded", async () => {
    clock = 1000000;
    const plugin = {};
    await assert.rejects(
      descriptionPhaseDispatch(targets(4), 4, makeWorker([], "reject"), true, "prov|model|hash", plugin),
      /warm worker failed/
    );
    clock = 1001000;
    const events = [];
    await descriptionPhaseDispatch(targets(4), 4, makeWorker(events, "ok"), true, "prov|model|hash", plugin);
    const completeFirst = events.indexOf("complete:t0");
    const startSecond = events.indexOf("start:t1");
    assert.ok(completeFirst < startSecond, `after failed warm the next dispatch must warm again, got [${events.join(",")}]`);
  });

  await check("single target unaffected", async () => {
    clock = 1000000;
    const plugin = {};
    const events = [];
    await descriptionPhaseDispatch(targets(1), 4, makeWorker(events, "immediate"), true, "prov|model|hash", plugin);
    assert.deepStrictEqual(events, ["start:t0", "complete:t0"]);
  });

  await check("warmFirst false ignores key", async () => {
    clock = 1000000;
    const plugin = {};
    const events = [];
    await descriptionPhaseDispatch(targets(4), 4, makeWorker(events, "wait"), false, "prov|model|hash", plugin);
    const startSecond = events.indexOf("start:t1");
    const completeFirst = events.indexOf("complete:t0");
    assert.ok(startSecond < completeFirst, `pooled dispatch must overlap, got [${events.join(",")}]`);
  });
}

main().then(
  () => {
    Date.now = realDateNow;
    if (failures.length) {
      console.error(`\nTest failed (${failures.length}):\n- ${failures.join("\n- ")}`);
      process.exit(1);
    }
    console.log("description-warm-skip-test: pass");
  },
  (err) => {
    Date.now = realDateNow;
    console.error(err && err.stack || err);
    process.exit(1);
  }
);
