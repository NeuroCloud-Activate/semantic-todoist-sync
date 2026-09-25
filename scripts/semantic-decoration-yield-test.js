"use strict";

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");

const root = path.resolve(__dirname, "..");
const candidatePath = path.join(root, "main.js");
const baselinePath = process.env.SEMANTIC_DECORATION_BASELINE_MAIN
  ? path.resolve(process.env.SEMANTIC_DECORATION_BASELINE_MAIN)
  : "";
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
    requestUrl() { throw new Error("Network disabled in semantic decoration yield test."); }
  };
};
global.window = global;
global.fetch = async () => { throw new Error("Network disabled in semantic decoration yield test."); };

function loadDecorationApi(filename) {
  let source = fs.readFileSync(filename, "utf8");
  source += `\nmodule.exports.__semanticDecorationTest = {
    decorateSemanticIndexChunks,
    decorateSemanticIndexChunksCooperative: typeof decorateSemanticIndexChunksCooperative === "function"
      ? decorateSemanticIndexChunksCooperative
      : null
  };\n`;
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(source, filename);
  return compiled.exports.__semanticDecorationTest;
}

function makeFixture() {
  const parentReference = { taskId: "parent", oid: "PARENT-OID", childEvidenceIds: ["before-parent"] };
  const childReference = { taskId: "child", oid: "CHILD-OID", childEvidenceIds: ["before-child"] };
  const rows = [
    { id: "note-duplicate-a", path: "Shared/note.md", text: "Repeated note evidence", chunkId: "note-a" },
    {
      id: "task-parent", path: "Tasks/parent.md", text: "Parent task evidence", chunkId: "parent-row",
      sourceKind: "todoist-snapshot-reference-row", taskId: "parent", oid: "PARENT-OID",
      childTaskIds: ["child"], childOids: ["CHILD-OID"], taskReference: parentReference,
      indexMetadata: { schemaVersion: 7, extension: "kept" },
      provenance: { extension: "source-preserved" }, embedding: [0.25, 0.75]
    },
    {
      id: "task-child", path: "Tasks/child.md", text: "Child task evidence", chunkId: "child-row",
      sourceKind: "subtask-task-tree-record", taskId: "child", oid: "CHILD-OID",
      taskReference: childReference, treePath: ["parent", "child"]
    },
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `note-${index}`, path: `Notes/${index}.md`, text: `Unique note evidence ${index}`, chunkId: `note-${index}`
    })),
    { id: "note-duplicate-b", path: "Shared/note.md", text: "Repeated note evidence", chunkId: "note-b" },
    {
      id: "metadata-note", path: "Metadata/index.md", text: "Index-only metadata", chunkId: "metadata-row",
      metadataOnly: true, evidenceEligibility: "metadata-only", indexMetadata: { customFlag: true },
      provenance: { sourceLabel: "synthetic-test" }
    }
  ];
  return { rows, parentReference, childReference };
}

function withGlobalOverrides(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Object.getOwnPropertyDescriptor(global, key));
    Object.defineProperty(global, key, { configurable: true, writable: true, value });
  }
  return Promise.resolve().then(fn).finally(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
}

async function main() {
  const source = fs.readFileSync(candidatePath, "utf8");
  const candidate = loadDecorationApi(candidatePath);
  assert.strictEqual(typeof candidate.decorateSemanticIndexChunks, "function");
  assert.strictEqual(typeof candidate.decorateSemanticIndexChunksCooperative, "function",
    "cooperative decoration API must exist while preserving the synchronous API");

  const gateCallLines = source.split(/\r?\n/).filter((line) => line.includes("this.semanticTaskContextDispatchGate("));
  assert.strictEqual(gateCallLines.length, 6, "the six approved task-context gate call sites should remain present");
  assert(gateCallLines.every((line) => line.includes("await this.semanticTaskContextDispatchGate(")),
    "every async task-context gate caller must await the gate");

  const syncFixture = makeFixture();
  const syncOutput = candidate.decorateSemanticIndexChunks(syncFixture.rows, 42);
  assert.notStrictEqual(syncOutput[0].evidenceId, syncOutput[9].evidenceId,
    "duplicate evidence ordinals must remain unique across later rows");
  assert.match(syncOutput[0].evidenceId, /:0$/);
  assert.match(syncOutput[9].evidenceId, /:1$/);
  assert.strictEqual(syncOutput[1].indexMetadata.extension, "kept");
  assert.strictEqual(syncOutput[1].provenance.extension, "source-preserved");
  assert.strictEqual(syncOutput[10].metadataOnly, true);
  assert.strictEqual(syncOutput[10].evidenceEligibility, "metadata-only");
  assert.deepStrictEqual(syncFixture.parentReference.childEvidenceIds, [syncOutput[2].evidenceId]);
  assert.deepStrictEqual(syncFixture.childReference.childEvidenceIds, []);

  if (baselinePath) {
    const baseline = loadDecorationApi(baselinePath);
    const baselineFixture = makeFixture();
    const before = baseline.decorateSemanticIndexChunks(baselineFixture.rows, 42);
    assert.deepStrictEqual(syncOutput, before, "sync decoration must preserve the before-image output");
    assert.deepStrictEqual(
      { parent: syncFixture.parentReference, child: syncFixture.childReference },
      { parent: baselineFixture.parentReference, child: baselineFixture.childReference },
      "sync decoration must preserve before-image nested input side effects"
    );
  }

  const overrides = {};
  let fakeNow = 0;
  overrides.performance = { now: () => { fakeNow += 9; return fakeNow; } };
  overrides.MessageChannel = undefined;
  overrides.requestIdleCallback = undefined;
  let timerHeartbeat = false;
  const fixture = makeFixture();
  const asyncChecks = await withGlobalOverrides(overrides, async () => {
    setTimeout(() => { timerHeartbeat = true; }, 0);
    const pending = candidate.decorateSemanticIndexChunksCooperative(fixture.rows, 42);
    assert.deepStrictEqual(fixture.parentReference.childEvidenceIds, ["before-parent"],
      "child references must not be resolved before the full row pass finishes");
    assert.deepStrictEqual(fixture.childReference.childEvidenceIds, ["before-child"]);
    const output = await pending;
    assert(timerHeartbeat, "decoration must yield to the host timer queue before completing");
    assert.deepStrictEqual(output, syncOutput, "cooperative and synchronous decoration must match exactly");
    assert.deepStrictEqual(fixture.parentReference.childEvidenceIds, [output[2].evidenceId]);
    assert.deepStrictEqual(fixture.childReference.childEvidenceIds, []);
    return output;
  });
  assert.deepStrictEqual(asyncChecks, syncOutput);

  const concurrentFixtures = [makeFixture(), makeFixture(), makeFixture()];
  const concurrent = await withGlobalOverrides({
    performance: { now: (() => { let now = 0; return () => { now += 9; return now; }; })() },
    MessageChannel: undefined,
    requestIdleCallback: undefined
  }, () => Promise.all([
      candidate.decorateSemanticIndexChunksCooperative(concurrentFixtures[0].rows, 42),
      candidate.decorateSemanticIndexChunksCooperative(concurrentFixtures[1].rows, 42),
      Promise.resolve(candidate.decorateSemanticIndexChunks(concurrentFixtures[2].rows, 42))
    ]));
  assert.deepStrictEqual(concurrent[0], concurrent[1], "concurrent async calls must have fresh duplicate state");
  assert.deepStrictEqual(concurrent[0], concurrent[2], "async and sync calls must not share mutable iterator state");

  const failedFixture = makeFixture();
  await withGlobalOverrides({
    performance: { now: (() => { let now = 0; return () => { now += 9; return now; }; })() },
    setTimeout() { throw new Error("synthetic timer unavailable"); },
    MessageChannel: undefined,
    requestIdleCallback: undefined
  }, async () => {
    await assert.rejects(
      candidate.decorateSemanticIndexChunksCooperative(failedFixture.rows, 42),
      (error) => error && error.code === "semantic-index-read-failed"
    );
    assert.deepStrictEqual(failedFixture.parentReference.childEvidenceIds, ["before-parent"],
      "a failed yield must not expose partial child-reference updates");
  });

  console.log("PASS: synchronous decoration output, duplicate ordinals, metadata and task child references");
  console.log("PASS: cooperative decoration yields to a host timer and matches synchronous output");
  console.log("PASS: concurrent invocations isolate state and failed yields expose no partial result");
  console.log("PASS: all six asynchronous semantic task-context gate call sites await the gate");
  if (baselinePath) console.log("PASS: current synchronous decoration matches the supplied before-image");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => { Module._load = originalLoad; });
