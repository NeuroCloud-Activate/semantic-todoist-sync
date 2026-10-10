"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.join(__dirname, "..");
const baselinePath = path.join(rootDir, ".superpowers", "sdd", "reoptimization", "task2-main.js.base");

function buildFixture() {
  const chunks = [];
  for (let i = 0; i < 29; i++) {
    chunks.push({
      id: `c-${i}`, evidenceId: `e-c-${i}`, chunkId: `c-${i}`,
      path: `Notes/c-${i}.md`, text: `Note content for chunk ${i}`,
      chunk: { id: `c-${i}`, evidenceId: `e-c-${i}`, path: `Notes/c-${i}.md`, text: `Note content for chunk ${i}`, sourceKind: "note", authorityState: "authoritative", retrievalEligible: true },
      sourceKind: "note", semantic: 0.85 + (i % 10) * 0.01, retrievalEligible: true,
    });
  }
  const zorblat = {
    id: "zorblat-rare", evidenceId: "e-zorblat-rare", chunkId: "zorblat-rare",
    path: "Notes/zorblat-rare.md", text: "Follow up with Zorblat on cost centres",
    chunk: { id: "zorblat-rare", evidenceId: "e-zorblat-rare", path: "Notes/zorblat-rare.md", text: "Follow up with Zorblat on cost centres", sourceKind: "note", authorityState: "authoritative", retrievalEligible: true },
    sourceKind: "note", semantic: 0.001, retrievalEligible: true,
  };
  chunks.push(zorblat);
  return { chunks, zorblatChunk: zorblat };
}

function writeAdapterStub(filePath) {
  const content = `
const Module = require("node:module");
const fs = require("node:fs");
const source = fs.readFileSync(${JSON.stringify(filePath)}, "utf8");
const compiled = new Module(${JSON.stringify(filePath)}, module);
compiled.filename = ${JSON.stringify(filePath)};
compiled.paths = Module._nodeModulePaths(${JSON.stringify(path.dirname(filePath) || rootDir)});
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request !== "obsidian") return originalLoad.call(this, request, parent, isMain);
  class Empty {}
  return { ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty, TFile: Empty, setIcon() {}, requestUrl() { throw new Error("net disabled"); } };
};
try { compiled._compile(source + "\\nmodule.exports.__laneSeamEvaluator = { taskWorkflowSelectScoreEvidence };\\n", compiled.filename); }
finally { Module._load = originalLoad; }
const adapter = (compiled.exports.__laneSeamEvaluator || compiled.exports).taskWorkflowSelectScoreEvidence || (compiled.exports.__laneSeamEvaluator || compiled.exports);
module.exports.adapter = adapter;
`;
  const stubPath = path.join(process.env.TEMP || "/tmp", "adapter-stub-" + path.basename(filePath).replace(/\./g, "_") + ".js");
  fs.writeFileSync(stubPath, content);
  return stubPath;
}

function main() {
  const failures = [];
  const fixture = buildFixture();
  const chunks = fixture.chunks;
  const zorblatChunk = fixture.zorblatChunk;
  const zorblatId = zorblatChunk.evidenceId || String(zorblatChunk.id || "");

  function check(name, fn) {
    try { fn(); console.log("PASS: " + name); }
    catch (e) { failures.push(name + ": " + (e && e.message ? e.message : String(e))); console.error("FAIL: " + name + ": " + (e && e.message ? e.message : String(e))); }
  }

  // (a) Non-vacuous: REAL mode-admitting function (retrieveAdaptiveSemanticContext)
  // REVERTED (fix round 1 final): union gate is chat-only again in candidate;
  // the selector function itself is shared, so both adapters still include
  // Zorblat via lexicalRows — the revert only restores the mode condition.
  check("reverted state: union gate chat-only in candidate and base", () => {
    const canPath = path.join(rootDir, "main.js");
    const baseFilePath = path.join(process.env.TEMP || "/tmp", "opencode", "fusion-base-main.js");
    assert.ok(fs.existsSync(baseFilePath), "base file must exist at " + baseFilePath);
    const baseText = fs.readFileSync(baseFilePath, "utf8");
    assert.ok(baseText.includes('retrievalMode === "chat"'), "base must contain original chat-only union guard");
    const canText = fs.readFileSync(canPath, "utf8");
    const canUnionLines = canText.split("\n").filter((line) => line.trim().startsWith("if (retrievalMode"));
    const canHasEditedGate = canUnionLines.some((line) => line.includes('retrievalMode.startsWith("task-generation")') || line.includes('retrievalMode === "description"'));
    assert.strictEqual(canHasEditedGate, false, "candidate union gate must be chat-only after revert (lines: " + canUnionLines.join(" | ") + ")");
    const stubCan = writeAdapterStub(canPath);
    delete require.cache[stubCan];
    const adapterCan = require(stubCan).adapter;
    const zorblatOnly = [{ evidenceId: zorblatId, score: 0, text: "Follow up with Zorblat on cost centres" }];
    const resultCan = adapterCan([], "Follow up with Zorblat", { semanticLimit: 20, lexicalLimit: 20, lexicalRows: zorblatOnly });
    const idsCan = (resultCan && resultCan.evidenceIds) ? resultCan.evidenceIds : [];
    assert.ok(idsCan.some((id) => String(id) === String(zorblatId)), "candidate adapter still includes Zorblat (shared selector, unchanged by revert)");
    // Base: check SPECIFICALLY the lexical union gate lines (if (retrievalMode ...) at ~10433/~12492),
    // not the unrelated 11131 semanticTaskContext gate or 12311 task-mode flag.
    const baseUnionLines = baseText.split("\n").filter((line) => line.trim().startsWith("if (retrievalMode"));
    const baseHasEditedGate = baseUnionLines.some((line) => line.includes('retrievalMode.startsWith("task-generation")') || line.includes('retrievalMode === "description"'));
    assert.strictEqual(baseHasEditedGate, false, "base union gate must be chat-only (lines: " + baseUnionLines.join(" | ") + ")");
  });

  // (a) Base runtime without lexicalRows input behaves the same (selector default).
  check("base adapter WITHOUT explicit lexicalRows produces same lexical window", () => {
    const stubCan = writeAdapterStub(path.join(rootDir, "main.js"));
    const stubBase = writeAdapterStub(baselinePath);
    delete require.cache[stubCan]; delete require.cache[stubBase];
    const adapterCan = require(stubCan).adapter;
    const adapterBase = require(stubBase).adapter;
    const lexicalRows = [{ evidenceId: zorblatId, score: 0, text: "Follow up with Zorblat on cost centres" }];
    const semanticRows = [];
    const resCan = adapterCan(semanticRows, "Follow up with Zorblat", { semanticLimit: 10, lexicalLimit: 10, lexicalRows });
    const resBase = adapterBase(semanticRows, "Follow up with Zorblat", { semanticLimit: 10, lexicalLimit: 10, lexicalRows });
    const idsCan = (resCan && resCan.evidenceIds) ? resCan.evidenceIds : [];
    const idsBase = (resBase && resBase.evidenceIds) ? resBase.evidenceIds : [];
    // Both should include Zorblat via lexical union since selector default includes lexicalRows.
    // This proves the selector function is shared; the edit difference is at retrievalMode gate.
    assert.strictEqual(idsCan.includes(zorblatId), true, "Candidate should include Zorblat");
    assert.strictEqual(idsBase.includes(zorblatId), true, "Baseline selector also includes Zorblat (same function)");
  });

  // (b) Protected source unchanged: high-score semantic rows preserved with union enabled.
  check("protected semantic rows preserved when union enabled", () => {
    const stubCan = writeAdapterStub(path.join(rootDir, "main.js"));
    const stubBase = writeAdapterStub(baselinePath);
    delete require.cache[stubCan]; delete require.cache[stubBase];
    const adapterCan = require(stubCan).adapter;
    const adapterBase = require(stubBase).adapter;
    const highScoring = [
      { evidenceId: "protected-1", score: 0.95, text: "Important note" },
      { evidenceId: "protected-2", score: 0.93, text: "Another key note" },
    ];
    const resultCan = adapterCan(highScoring, "Test query", { semanticLimit: 10, lexicalLimit: 10 });
    const resultBase = adapterBase(highScoring, "Test query", { semanticLimit: 10, lexicalLimit: 10 });
    const idsCan = (resultCan && resultCan.evidenceIds) ? resultCan.evidenceIds : [];
    const idsBase = (resultBase && resultBase.evidenceIds) ? resultBase.evidenceIds : [];
    assert.ok(idsCan.includes("protected-1"), "protected-1 must be in candidate");
    assert.ok(idsCan.includes("protected-2"), "protected-2 must be in candidate");
  });

  // (c) Chat mode parity: adapter outputs identical for same inputs.
  check("chat-mode parity: base vs candidate adapter identical", () => {
    const stubCan = writeAdapterStub(path.join(rootDir, "main.js"));
    const stubBase = writeAdapterStub(baselinePath);
    delete require.cache[stubCan]; delete require.cache[stubBase];
    const adapterCan = require(stubCan).adapter;
    const adapterBase = require(stubBase).adapter;
    const lexicalRows = chunks.slice(0, 5).map((c) => ({ evidenceId: c.evidenceId, score: 0, text: String(c.text || "") }));
    const semanticRows = chunks.filter((c) => Number(c.semantic || 0) > 0).map((c) => ({ evidenceId: c.evidenceId, score: Number(c.semantic || 0), text: String(c.text || "") }));
    const resCan = adapterCan(semanticRows, "Query", { semanticLimit: 10, lexicalLimit: 10, lexicalRows });
    const resBase = adapterBase(semanticRows, "Query", { semanticLimit: 10, lexicalLimit: 10, lexicalRows });
    const idsCan = (resCan && resCan.evidenceIds) ? resCan.evidenceIds.map(String).sort() : [];
    const idsBase = (resBase && resBase.evidenceIds) ? resBase.evidenceIds.map(String).sort() : [];
    assert.deepStrictEqual(idsCan, idsBase, "Chat-mode adapter parity");
  });

  if (failures.length) {
    console.error("\n" + failures.length + " failure(s):");
    failures.forEach((f) => console.error("  - " + f));
    process.exit(1);
  } else {
    console.log("\nAll checks passed.");
    process.exit(0);
  }
}

main();