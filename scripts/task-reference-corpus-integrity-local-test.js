"use strict";

// Task 1 focused harness (TDD): semantic corpus authoritative + diagnostics exact.
// Covers: pending exclusion/preservation, exact missing-vs-unexpected reasons,
// true cross-ID OID collision fail-closed, same-identity multi-location continuity.
// No live data, no network, no Obsidian runtime.

const assert = require("assert");
const Module = require("module");
const path = require("path");

const originalLoad = Module._load;
function blockedNetwork() {
  throw new Error("Network access is forbidden during task-reference corpus integrity test.");
}
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
    requestUrl: blockedNetwork,
  };
};
global.window = global;
global.fetch = async () => blockedNetwork();
global.requestUrl = blockedNetwork;

const Plugin = require(path.join(__dirname, "..", "main.js"));

const {
  semanticTaskReferenceRecords,
  semanticTaskReferenceExpectedSnapshotIds,
  semanticTaskReferenceCorpusIntegrity,
} = Plugin;

function cacheTask(id, oid, content, extra = {}) {
  return Object.assign(
    {
      id,
      todoistId: id,
      oid,
      content,
      description: "",
      isSubtask: false,
      parentId: "",
      parentOid: "",
    },
    extra
  );
}

function settingsFor(taskCache, pendingTaskReferences) {
  return {
    indexedFolders: [],
    excludedFolders: [],
    taskCache,
    pendingTaskReferences,
  };
}

// 1. Pending rows produce no top-level record/chunk source and stay unchanged
//    persisted workflow state (cache-only authoritative records).
function verifiesPendingExclusionAndPreservation() {
  const pending = {
    "pending-1": cacheTask("pending-1", "OID-PENDING-1", "Pending reference payload"),
  };
  const pendingBefore = JSON.parse(JSON.stringify(pending));
  const settings = settingsFor(
    { "task-a": cacheTask("task-a", "OID-A", "Cached task A") },
    pending
  );
  const records = semanticTaskReferenceRecords(settings, "", null);
  assert.strictEqual(records.length, 1, "only the cached task becomes a top-level record");
  assert.ok(
    records.every((record) => record.source !== "pending"),
    "no record may carry the pending source"
  );
  assert.ok(
    records.every((record) => String(record.task?.todoistId || record.task?.id || record.id) !== "pending-1"),
    "pending identity must not appear as a top-level record"
  );
  assert.ok(
    records.every((record) => (record.task?.content || "") !== "Pending reference payload"),
    "pending content must not appear as record/chunk source text"
  );
  assert.deepStrictEqual(settings.pendingTaskReferences, pendingBefore, "pending payload must be preserved unchanged");
  assert.deepStrictEqual(pending, pendingBefore, "pending object identity payload must be unchanged");
}

// 2. Extra-only emits unexpected without falsely emitting missing.
function verifiesExtraOnlyEmitsUnexpectedWithoutMissing() {
  const settings = settingsFor(
    { "task-a": cacheTask("task-a", "OID-A", "Cached task A") },
    { "pending-1": cacheTask("pending-1", "OID-PENDING-1", "Pending reference payload") }
  );
  const expectedIds = semanticTaskReferenceExpectedSnapshotIds(settings);
  assert.strictEqual(expectedIds.size, 1, "expected IDs derive from the cache only");
  const records = semanticTaskReferenceRecords(settings, "", null);
  // Simulate one extra record beyond the expected cache set (the pending
  // projection path must never be the source of such an extra record).
  const integrity = semanticTaskReferenceCorpusIntegrity(
    [...records, { sourceId: "todoist:extra-row", sourceKind: "todoist-snapshot-reference-row", task: {}, children: [] }],
    [],
    { settings }
  );
  assert.strictEqual(integrity.telemetry.missingSnapshotRows, 0, "extra-only must report zero missing rows");
  assert.ok(integrity.telemetry.unexpectedSnapshotRows > 0, "extra-only must report unexpected rows");
  assert.ok(
    integrity.reasonCodes.includes("unexpected-snapshot-row"),
    "extra-only must emit unexpected-snapshot-row"
  );
  assert.ok(
    !integrity.reasonCodes.includes("missing-snapshot-row"),
    "extra-only must NOT emit missing-snapshot-row"
  );
}

// 3. A missing expected ID emits missing (conditional on actual absence).
function verifiesMissingExpectedIdEmitsMissing() {
  const settings = settingsFor({
    "task-a": cacheTask("task-a", "OID-A", "Cached task A"),
    "task-b": cacheTask("task-b", "OID-B", "Cached task B"),
  }, {});
  const expectedIds = semanticTaskReferenceExpectedSnapshotIds(settings);
  assert.strictEqual(expectedIds.size, 2, "two cached tasks yield two expected IDs");
  const records = semanticTaskReferenceRecords(settings, "", null);
  assert.strictEqual(records.length, 2, "both cached tasks become records");
  const kept = records.filter(
    (record) => !expectedIds.has(String(record.sourceId)) || String(record.sourceId) === records[0].sourceId
  );
  const dropped = records.filter((record) => !kept.includes(record));
  assert.strictEqual(dropped.length, 1, "test setup drops exactly one expected record");
  const integrity = semanticTaskReferenceCorpusIntegrity(kept, [], { settings });
  assert.strictEqual(integrity.telemetry.missingSnapshotRows, 1, "one absent expected ID reports one missing row");
  assert.ok(integrity.reasonCodes.includes("missing-snapshot-row"), "absent expected ID must emit missing-snapshot-row");
}

// 4. True cross-ID OID collisions remain fail-closed.
function verifiesCrossIdOidCollisionFailClosed() {
  const settings = settingsFor({
    "task-a": cacheTask("task-a", "OID-SHARED", "Cached task A"),
    "task-b": cacheTask("task-b", "OID-SHARED", "Cached task B"),
  }, {});
  const records = semanticTaskReferenceRecords(settings, "", null);
  assert.strictEqual(records.length, 2, "distinct Todoist IDs yield distinct records");
  const integrity = semanticTaskReferenceCorpusIntegrity(records, [], { settings });
  assert.strictEqual(integrity.ok, false, "OID collision must not report ok");
  assert.ok(
    integrity.reasonCodes.includes("task-reference-identity-collision"),
    "OID collision must emit task-reference-identity-collision"
  );
}

// 5. Same-ID/OID multi-location continuity is not a collision.
function verifiesSameIdentityMultiLocationContinuity() {
  const settings = settingsFor(
    {
      "task-a": cacheTask("task-a", "OID-A", "Cached task A", {
        currentLocations: [
          { path: "Notes/A.md", lineNumber: 1, oid: "OID-A", todoistId: "task-a" },
          { path: "Notes/B.md", lineNumber: 7, oid: "OID-A", todoistId: "task-a" },
        ],
      }),
    },
    {}
  );
  const records = semanticTaskReferenceRecords(settings, "", null);
  assert.strictEqual(records.length, 1, "one identity in many locations stays one record");
  assert.ok(!records[0].hierarchyIssue, "multi-location continuity must not flag a hierarchy issue");
  const integrity = semanticTaskReferenceCorpusIntegrity(records, [], { settings });
  assert.ok(
    !integrity.reasonCodes.includes("task-reference-identity-collision"),
    "multi-location continuity must NOT emit task-reference-identity-collision"
  );
}

function main() {
  assert.strictEqual(typeof semanticTaskReferenceRecords, "function", "semanticTaskReferenceRecords seam must be exported");
  assert.strictEqual(typeof semanticTaskReferenceExpectedSnapshotIds, "function", "semanticTaskReferenceExpectedSnapshotIds seam must be exported");
  assert.strictEqual(typeof semanticTaskReferenceCorpusIntegrity, "function", "semanticTaskReferenceCorpusIntegrity seam must be exported");
  verifiesPendingExclusionAndPreservation();
  console.log("PASS pending exclusion/preservation");
  verifiesExtraOnlyEmitsUnexpectedWithoutMissing();
  console.log("PASS extra-only unexpected without missing");
  verifiesMissingExpectedIdEmitsMissing();
  console.log("PASS missing expected ID emits missing");
  verifiesCrossIdOidCollisionFailClosed();
  console.log("PASS cross-ID OID collision fail-closed");
  verifiesSameIdentityMultiLocationContinuity();
  console.log("PASS same-identity multi-location continuity");
  console.log("Task-reference corpus integrity contracts passed.");
}

main();
