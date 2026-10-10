"use strict";

// scripts/semantic-embedding-parallel-test.js — Task 4: parallel embedding batches.
// Compiling trick: Module._compile of main.js + module.exports.__testEmbeddingParallel
// suffix that binds embedSemanticChunks over a fake `this`.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const crypto = require("node:crypto");

const mainPath = path.join(__dirname, "..", "main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");

// Minimal obsidian stub (same shape as vault-harness-test).
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

let pluginExports;
try {
  const testModule = new Module(mainPath, module);
  testModule.filename = mainPath;
  testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
  testModule._compile(
    `${mainSource}\n` +
    `module.exports.__testEmbeddingParallel = { embedSemanticChunks: null };\n`,
    mainPath
  );
  pluginExports = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const PluginClass = pluginExports || (require(mainPath) && require(mainPath));
// Re-compile cleanly so we get the actual Plugin class.
function compileFresh() {
  const freshModule = new Module(mainPath, module);
  freshModule.filename = mainPath;
  freshModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
  const loadBackup = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request !== "obsidian") return loadBackup.call(this, request, parent, isMain);
    class Empty {}
    return {
      ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty,
      Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty,
      TFile: Empty, setIcon() {}, requestUrl() { throw new Error("network disabled"); },
    };
  };
  try {
    freshModule._compile(mainSource, mainPath);
    return freshModule.exports;
  } finally {
    Module._load = loadBackup;
    delete require.cache[mainPath];
  }
}

ensureNodeGlobals();
const Plugin = compileFresh();
const embedMethod = Plugin.prototype ? Plugin.prototype.embedSemanticChunks : (Plugin.__testEmbeddingParallel && Plugin.__testEmbeddingParallel.embedSemanticChunks);

// We'll build a fake instance manually rather than using the constructor.
function ensureNodeGlobals() {
  const g = globalThis;
  const timers = {
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    setInterval: (...args) => setInterval(...args),
    clearInterval: (...args) => clearInterval(...args),
  };
  if (typeof g.window === "undefined" || !g.window) {
    g.window = Object.assign({}, timers);
    return;
  }
  for (const [key, fn] of Object.entries(timers)) {
    if (typeof g.window[key] !== "function") g.window[key] = fn;
  }
}

function buildFakeThis(overrides = {}) {
  const delays = [30, 5, 15, 1, 30, 5, 15, 1, 30, 5];
  let callIndex = 0;
  let maxInFlight = 0;
  let currentInFlight = 0;
  let resolveMap = new Map();
  let rejectedBatch = null;

  const settings = Object.assign({
    embeddingBatchSize: 2,
    embeddingModel: "test-embedding-model",
    semanticIndexEmbeddingPrecision: 4,
    semanticEmbeddingBatchSize: 2,
    semanticEmbeddingProvider: () => "customopenai",
    embeddingBatchSize: 2,
  }, overrides.settings || {});

  const embedTexts = async function(texts, role) {
    const currentCall = ++callIndex;
    currentInFlight += 1;
    if (currentInFlight > maxInFlight) maxInFlight = currentInFlight;
    const delayMs = delays[(currentCall - 1) % delays.length];
    await new Promise((resolve, reject) => {
      setTimeout(() => {
        currentInFlight -= 1;
        if (rejectedBatch !== null && currentCall > rejectedBatch) {
          resolve();
        } else if (rejectedBatch !== null && currentCall === rejectedBatch) {
          reject(new Error("fake embedTexts throws on batch 2"));
        } else {
          resolve();
        }
      }, delayMs);
    });
    return texts.map((text) => {
      const hash = crypto.createHash("sha256").update(String(text || "")).digest("hex");
      // Return a unit-ish vector (length 4, values near 1/4) so normalization works.
      return [1 / 4, 2 / 4, 3 / 4, 4 / 4];
    });
  };

  return {
    settings,
    setSidebarStatus() {},
    embedTexts,
    get maxInFlight() { return maxInFlight; },
    get callIndex() { return callIndex; },
    get currentInFlight() { return currentInFlight; },
    setRejectedBatch(idx) { rejectedBatch = idx; },
    // Minimal stubs for anything else embedSemanticChunks touches.
    app: { vault: { adapter: { getBasePath: () => "/fake" } } },
    manifest: { dir: ".obsidian/plugins/semantic-todoist-sync" },
  };
}

// Helper to run the original serial loop logic (before my edit) for comparison.
async function serialEmbedSemanticChunks(chunks, reuseMap = new Map(), label = "semantic chunks", onProgress = null, fakeThis) {
  const indexed = new Array(chunks.length);
  const pending = [];
  let reused = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    // Minimal reuse logic: reuse only if same index and reuseMap has embedding.
    // For this test, reuseMap is always empty, so no reuse.
    if (reuseMap && reuseMap.has(chunk)) {
      indexed[index] = reuseMap.get(chunk);
      reused += 1;
    } else {
      pending.push({ chunk, index });
    }
  }
  // Simplified serial loop mimicking original logic.
  const pendingGroups = [];
  const pendingByKey = new Map();
  for (const item of pending) {
    const text = item.chunk.text || "";
    const requestKey = crypto.createHash("sha256").update("v4\0note\0" + text).digest("hex");
    const existing = pendingByKey.get(requestKey);
    if (existing) {
      existing.items.push(item);
    } else {
      const group = { requestKey, chunk: item.chunk, items: [item] };
      pendingByKey.set(requestKey, group);
      pendingGroups.push(group);
    }
  }
  const batchSize = fakeThis.settings.embeddingBatchSize || 2;
  let embedded = 0;
  let providerInputs = 0;
  let chunksProcessed = reused;
  for (let i = 0; i < pendingGroups.length; i += batchSize) {
    const batch = pendingGroups.slice(i, i + batchSize);
    const embeddings = await fakeThis.embedTexts(batch.map((group) => group.chunk.text || ""), "document");
    const batchEmbedded = [];
    for (let j = 0; j < batch.length; j += 1) {
      const group = batch[j];
      const embedding = embeddings[j];
      for (const item of group.items) {
        indexed[item.index] = Object.assign({}, item.chunk, {
          embedding,
          embeddingProvider: fakeThis.settings.semanticEmbeddingProvider ? fakeThis.settings.semanticEmbeddingProvider() : "customopenai",
          embeddingModel: fakeThis.settings.embeddingModel,
          embeddingDimension: embedding ? embedding.length : 0,
          embeddingContentVersion: 4,
          embeddingRequestFingerprint: group.requestKey,
          indexMetadata: {
            schemaVersion: 1,
            contentVersion: 4,
            provider: fakeThis.settings.semanticEmbeddingProvider ? fakeThis.settings.semanticEmbeddingProvider() : "customopenai",
            model: fakeThis.settings.embeddingModel,
            dimension: embedding ? embedding.length : 0,
            requestFingerprint: group.requestKey,
          }
        });
        batchEmbedded.push(indexed[item.index]);
        embedded += 1;
        chunksProcessed += 1;
      }
    }
    providerInputs += batch.length;
    if (onProgress) {
      await onProgress({ chunksProcessed, totalChunks: chunks.length, providerInputs, embedded, reused, batchEmbedded });
    }
    await new Promise((r) => setTimeout(r, 25)); // idlePause equivalent
  }
  return {
    indexed,
    embedded,
    reused,
    providerInputs,
    deduplicatedInputs: Math.max(0, pending.length - pendingGroups.length),
    inputRecords: pending.length,
  };
}

const failures = [];
async function check(name, assertion) {
  try {
    await assertion();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error && error.message ? error.message : error}`);
    console.error(`FAIL: ${name}: ${error && error.message ? error.message : error}`);
  }
}

async function main() {
  // Build 10 chunks (2 batches of 2 -> 5 batches total with batchSize=2).
  const chunks = [];
  for (let i = 0; i < 10; i++) {
    chunks.push({ text: `chunk text number ${i}`, sourceKind: "note" });
  }

  await check("output identical to serial", async () => {
    const fakeSerial = buildFakeThis({ settings: { embeddingBatchSize: 2 } });
    const serialResult = await serialEmbedSemanticChunks(chunks, new Map(), "test", null, fakeSerial);

    const fakeParallel = buildFakeThis({ settings: { embeddingBatchSize: 2 } });
    // Manually bind the real method from the compiled plugin class.
    const boundParallel = Plugin.prototype.embedSemanticChunks.bind(fakeParallel);
    const parallelResult = await boundParallel(chunks, new Map(), "test", null);

    assert.equal(parallelResult.indexed.length, chunks.length);
    for (let i = 0; i < chunks.length; i++) {
      assert.deepEqual(parallelResult.indexed[i].embedding, serialResult.indexed[i].embedding, `chunk ${i} embedding differs`);
    }
    assert.deepEqual(
      { embedded: parallelResult.embedded, providerInputs: parallelResult.providerInputs, reused: parallelResult.reused, deduplicatedInputs: parallelResult.deduplicatedInputs, inputRecords: parallelResult.inputRecords },
      { embedded: serialResult.embedded, providerInputs: serialResult.providerInputs, reused: serialResult.reused, deduplicatedInputs: serialResult.deduplicatedInputs, inputRecords: serialResult.inputRecords },
      "count fields differ between parallel and serial"
    );
  });

  await check("runs batches concurrently", async () => {
    const fake = buildFakeThis({ settings: { embeddingBatchSize: 2 } });
    const bound = Plugin.prototype.embedSemanticChunks.bind(fake);
    await bound(chunks, new Map(), "test", null);
    assert.equal(fake.maxInFlight, 3, `expected max in-flight 3, got ${fake.maxInFlight}`);
  });

  await check("progress is contiguous prefix", async () => {
    const fake = buildFakeThis({ settings: { embeddingBatchSize: 2 } });
    const progressEvents = [];
    const bound = Plugin.prototype.embedSemanticChunks.bind(fake);
    await bound(chunks, new Map(), "test", async (progress) => {
      progressEvents.push({ chunksProcessed: progress.chunksProcessed, totalChunks: progress.totalChunks });
    });
    // Progress must be non-decreasing and equal sum of fully completed batches.
    for (let i = 1; i < progressEvents.length; i++) {
      assert.ok(progressEvents[i].chunksProcessed >= progressEvents[i - 1].chunksProcessed, `progress decreased at event ${i}`);
    }
    // Each progress event should report chunksProcessed equal to the number of fully completed batches * batch items (minus reused).
    // With no reuse and batchSize 2, the completed batches are: 2, 4, 6, 8, 10.
    // But since batches run in parallel and may complete out of order, progress should only advance when all batches up to some k are done.
    // For simplicity, we just verify the final event equals chunks.length.
    assert.equal(progressEvents[progressEvents.length - 1].chunksProcessed, chunks.length, `final chunksProcessed should equal ${chunks.length}`);
    assert.deepEqual(
      progressEvents.map((event) => event.chunksProcessed),
      [2, 4, 6, 8, 10],
      `expected contiguous-prefix chunksProcessed sequence [2,4,6,8,10], got [${progressEvents.map((event) => event.chunksProcessed).join(",")}]`
    );
  });

  await check("first failure rejects", async () => {
    const fake = buildFakeThis({ settings: { embeddingBatchSize: 2 } });
    fake.setRejectedBatch(2);
    const progressEvents = [];
    const bound = Plugin.prototype.embedSemanticChunks.bind(fake);
    await assert.rejects(async () => {
      await bound(chunks, new Map(), "test", async (progress) => {
        progressEvents.push(progress.chunksProcessed);
      });
    }, /fake embedTexts throws on batch 2/);
    for (const val of progressEvents) {
      assert.ok(val < 4, `no progress event should report chunks >= 4 (batch 2 or later) but got ${val}`);
    }
  });

  await check("gemini outer concurrency 1", async () => {
    // For the gemini branch, the outer loop concurrency should be 1.
    // This test verifies by simulating what embedTexts would receive: 
    // the method passes batch descriptors through embedTexts; for gemini, 
    // the call pattern should be serial (one batch at a time in the outer loop).
    // We simulate by using a settings override that tells the method it's gemini.
    const fake = buildFakeThis({ settings: { embeddingBatchSize: 2, embeddingModel: "gemini-embedding-001", embeddingBatchSize: 2, embeddingProvider: "gemini" } });
    // The real method uses provider === "gemini" for concurrency.
    // Since we don't modify the method yet, this test will fail (currently serial anyway).
    // After implementation with the new constant, we expect the same behavior for gemini (outer === 1).
    const bound = Plugin.prototype.embedSemanticChunks.bind(fake);
    await bound(chunks.slice(0, 4), new Map(), "test", null);
    // With the new feature, gemini should still have maxInFlight === 1 for the outer loop.
    assert.equal(fake.maxInFlight, 1, `gemini max in-flight should be 1, got ${fake.maxInFlight}`);
  });
}

main().then(
  () => {
    if (failures.length) {
      console.error(`\nTest failed (${failures.length}):\n- ${failures.join("\n- ")}`);
      process.exit(1);
    }
    console.log("semantic-embedding-parallel-test: pass");
  },
  (err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  }
);
