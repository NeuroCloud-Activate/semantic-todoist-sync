"use strict";

// Task 7 (evidence-based write orchestrator) — TDD test. Requires src/writing/write.js.
// Style: plain node + assert, prints `PASS <case>` lines, exits non-zero on failure.
// The final case loads the built plugin (Module._load obsidian mock pattern from
// scripts/web-research-local-test.js) and checks the context-folder index exclusion.

const assert = require("assert");

const { writeWithEvidence } = require("../src/writing/write.js");

function vaultChunk(i) {
  return { path: `Notes/vault-${i}.md`, title: `vault-${i}`, section: `H${i}`, text: `vault text ${i}` };
}

function contextHit(i) {
  return { id: `Writing Context/c-${i}.md#0`, file: `Writing Context/c-${i}.md`, name: `c-${i}.md`, locator: `p. ${i}`, text: `context text ${i}`, score: 1 - i / 100 };
}

// Stub plugin; every method records its call order in `calls`.
function makeStub({ vault = 8, context = 8, syncResult = null, syncError = null, modelText = "draft" } = {}) {
  const calls = [];
  const captured = {};
  const store = {
    async sync(rootInfo, app) {
      calls.push("sync");
      captured.rootInfo = rootInfo;
      captured.app = app;
      if (syncError) throw syncError;
      return syncResult || { added: 0, changed: 0, removed: 0, skipped: [] };
    },
    search(queryVector, k) {
      calls.push("search");
      captured.queryVector = queryVector;
      captured.k = k;
      return Array.from({ length: context }, (_, i) => contextHit(i + 1));
    },
  };
  const plugin = {
    calls,
    captured,
    app: { vault: {} },
    async getContextStore() {
      calls.push("getContextStore");
      return { store, rootInfo: { kind: "vault", root: "Writing Context" } };
    },
    async retrieveSemanticContext(query, limit) {
      calls.push("retrieve");
      captured.query = query;
      captured.limit = limit;
      return Array.from({ length: vault }, (_, i) => vaultChunk(i + 1));
    },
    async embedTexts(texts, role) {
      calls.push("embed");
      captured.embedRole = role;
      return texts.map(() => [1, 0, 0]);
    },
    aiModelForRequest(mode) {
      calls.push("model:" + mode);
      captured.modelMode = mode;
      return { model: "fictional-write-model" };
    },
    async openaiResponse(request) {
      calls.push("generate");
      captured.request = request;
      return modelText;
    },
  };
  return plugin;
}

const ACTIVE = { path: "Notes/active.md", text: "active note body", selection: "", cursorOffset: 5 };

async function main() {
  assert.strictEqual(typeof writeWithEvidence, "function", "writeWithEvidence must be exported");

  // 1. merges 8 vault + 8 context with ids E1..E16, vault first; sync before retrieval.
  {
    const plugin = makeStub({ modelText: "draft [E1] plus [E16]" });
    const result = await writeWithEvidence(plugin, { instruction: "Draft it", length: "standard", active: ACTIVE });
    assert.deepStrictEqual(
      plugin.calls,
      ["getContextStore", "sync", "retrieve", "embed", "search", "model:write", "generate"],
      "sync runs before retrieval, got " + JSON.stringify(plugin.calls));
    assert.strictEqual(result.evidenceCount, 16, "8 vault + 8 context");
    assert.strictEqual(result.sources.length, 16);
    assert.deepStrictEqual(result.sources.map((s) => s.eid),
      Array.from({ length: 16 }, (_, i) => `E${i + 1}`), "ids E1..E16 in order");
    assert.ok(result.sources[0].path === "Notes/vault-1.md", "vault first");
    assert.ok(result.sources[8].path === "Writing Context/c-1.md", "context after vault");
    assert.ok(result.markdown.includes("[^1]") && result.markdown.includes("[^2]"), "rewrite applied");
    assert.ok(!result.markdown.includes("[E1]"), "[En] rewritten");
    assert.strictEqual(result.dropped, 0);
    console.log("PASS merges 8 vault + 8 context as E1..E16 with sync before retrieval");
  }

  // 2. vault-only when the store is empty.
  {
    const plugin = makeStub({ context: 0 });
    const result = await writeWithEvidence(plugin, { instruction: "Draft it", length: "standard", active: ACTIVE });
    assert.strictEqual(result.evidenceCount, 8, "vault-only");
    assert.deepStrictEqual(result.sources.map((s) => s.eid),
      Array.from({ length: 8 }, (_, i) => `E${i + 1}`));
    assert.ok(result.sources.every((s) => String(s.path || "").startsWith("Notes/")), "all vault");
    console.log("PASS vault-only when the store is empty");
  }

  // 3. sync embed failure surfaces with its code; per-file skips do not block.
  {
    const err = new Error("no embedding access");
    err.code = "embedding-access-unavailable";
    const failing = makeStub({ syncError: err });
    await assert.rejects(
      writeWithEvidence(failing, { instruction: "Draft it", length: "standard", active: ACTIVE }),
      (e) => e && e.code === "embedding-access-unavailable", "sync error surfaces");
    const skipped = makeStub({ syncResult: { added: 1, changed: 0, removed: 0, skipped: [{ id: "Writing Context/bad.pdf", reason: "pdf-parse-failed" }] } });
    const result = await writeWithEvidence(skipped, { instruction: "Draft it", length: "standard", active: ACTIVE });
    assert.strictEqual(result.evidenceCount, 16, "skips do not block writing");
    console.log("PASS sync embed failure surfaces; per-file skips do not block");
  }

  // 4. prompt carries instruction, selection, bounded note context, every id, and the rules.
  {
    const selection = "SELECTION-MARKER-ABC";
    const filler = "x".repeat(9000) + "CURSOR-NEIGHBOURHOOD-MARKER" + "y".repeat(11000);
    const plugin = makeStub({});
    await writeWithEvidence(plugin, {
      instruction: "INSTRUCTION-MARKER-XYZ",
      length: "standard",
      active: { path: "Notes/a.md", text: filler, selection, cursorOffset: 9000 + 14 },
    });
    const { request } = plugin.captured;
    assert.ok(request.system.includes("only the evidence supplied") || request.system.includes("Only the evidence supplied"), "rule: only supplied evidence");
    assert.ok(request.system.includes("[En]") || request.system.includes("[E1]"), "rule: cite with [En]");
    assert.ok(/explicitly/i.test(request.system), "rule: state missing evidence explicitly");
    assert.ok(request.user.includes("INSTRUCTION-MARKER-XYZ"), "instruction present");
    assert.ok(request.user.includes(selection), "selection present");
    for (let i = 1; i <= 16; i++) assert.ok(request.user.includes(`[E${i}]`), `evidence id [E${i}] listed`);
    const contextSection = request.user.split("Surrounding note context")[1].split("Evidence (cite by id)")[0];
    assert.ok(contextSection.includes("CURSOR-NEIGHBOURHOOD-MARKER"), "context centred near the cursor");
    assert.ok(contextSection.length <= 6000 + 200, `note context bounded, got ${contextSection.length}`);
    assert.ok(plugin.captured.query.includes("INSTRUCTION-MARKER-XYZ"), "retrieval query has the instruction");
    assert.ok(plugin.captured.query.includes(selection.slice(0, 500)), "retrieval query has the selection");
    console.log("PASS prompt carries instruction selection bounded-context ids and rules");
  }

  // 5. zero evidence still calls the model and says so.
  {
    const plugin = makeStub({ vault: 0, context: 0, modelText: "nothing found" });
    const result = await writeWithEvidence(plugin, { instruction: "Draft it", length: "brief", active: ACTIVE });
    assert.strictEqual(plugin.calls.filter((c) => c === "generate").length, 1, "model still called");
    assert.ok(plugin.captured.request.user.includes("No evidence was found"), "prompt states the gap");
    assert.strictEqual(result.evidenceCount, 0);
    assert.strictEqual(result.markdown, "nothing found");
    console.log("PASS zero evidence still calls the model and states the gap");
  }

  // 6. result passes through rewriteCitations (unknown ids dropped and counted).
  {
    const plugin = makeStub({ vault: 1, context: 0, modelText: "a [E1] b [E99]" });
    const result = await writeWithEvidence(plugin, { instruction: "Draft it", length: "standard", active: ACTIVE });
    assert.ok(result.markdown.includes("[^1]"), "known id rewritten");
    assert.ok(!result.markdown.includes("[E99]"), "unknown id removed");
    assert.strictEqual(result.dropped, 1);
    assert.ok(result.footnotes.startsWith("[^1]:"), "footnote defined");
    console.log("PASS result passes through rewriteCitations");
  }

  // 7. length maps to word targets; unknown defaults to standard.
  {
    for (const [length, marker] of [["brief", "150"], ["standard", "400"], ["detailed", "900"]]) {
      const plugin = makeStub({ vault: 0, context: 0 });
      await writeWithEvidence(plugin, { instruction: "Draft it", length, active: ACTIVE });
      assert.ok(plugin.captured.request.user.includes(marker), `${length} target mentions ${marker}`);
    }
    const fallback = makeStub({ vault: 0, context: 0 });
    await writeWithEvidence(fallback, { instruction: "Draft it", length: "fictional", active: ACTIVE });
    assert.ok(fallback.captured.request.user.includes("400"), "unknown length defaults to standard");
    console.log("PASS length maps to word targets with a standard default");
  }

  // 8. generation uses the write operation on the primary model.
  {
    const plugin = makeStub({ vault: 0, context: 0 });
    await writeWithEvidence(plugin, { instruction: "Draft it", length: "standard", active: ACTIVE });
    assert.strictEqual(plugin.captured.modelMode, "write", "primary model resolved for write");
    assert.strictEqual(plugin.captured.request.operation, "write", "operation is write");
    assert.strictEqual(plugin.captured.request.model, "fictional-write-model", "resolved model used");
    console.log("PASS generation uses the write operation on the primary model");
  }

  // 9. built plugin excludes the context folder from the vault index; other paths unchanged.
  {
    const Module = require("module");
    const path = require("path");
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request !== "obsidian") return originalLoad.call(this, request, parent, isMain);
      class Empty {}
      return {
        ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty,
        Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty,
        TFile: Empty, setIcon() {},
        requestUrl: async () => { throw new Error("network disabled"); },
      };
    };
    global.window = global.window || { setTimeout, clearTimeout, requestIdleCallback: null };
    let Plugin;
    try {
      Plugin = require(path.join(__dirname, "..", "main.js"));
    } finally {
      Module._load = originalLoad;
    }
    const plugin = Object.create(Plugin.prototype);
    plugin.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS);
    assert.strictEqual(plugin.isIndexablePath("Writing Context/a.md"), false, "default context folder excluded");
    assert.strictEqual(plugin.isIndexablePath("Writing Context"), false, "folder itself excluded");
    assert.strictEqual(plugin.isIndexablePath("Writing Contextual/a.md"), true, "prefix sibling still indexed");
    assert.strictEqual(plugin.isIndexablePath("Notes/a.md"), true, "normal path unchanged");
    plugin.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { writingContextFolder: "Research/Ctx/" });
    assert.strictEqual(plugin.isIndexablePath("Research/Ctx/f.md"), false, "custom folder excluded");
    assert.strictEqual(plugin.isIndexablePath("Writing Context/a.md"), true, "default no longer excluded when customised");
    plugin.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { writingContextFolder: "C:/ext" });
    assert.strictEqual(plugin.isIndexablePath("Writing Context/a.md"), true, "external config excludes nothing vault-side");
    console.log("PASS built plugin excludes the context folder from the vault index");
  }

  console.log("writing-write-test: PASS");
}

main().catch((err) => { console.error("FAIL", err); process.exit(1); });
