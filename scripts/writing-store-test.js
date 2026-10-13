"use strict";

// Task 4 (embedded context store) — TDD test. Requires src/context/store.js.
// Style: plain node + assert, prints `PASS <case>` lines, exits non-zero on failure.

const assert = require("assert");

const { ContextStore } = require("../src/context/store.js");

const IDX = ".obsidian/plugins/writing-test/context-index.json";
const ROOT = { kind: "vault", root: "Writing Context" };

function toBytes(str) {
  const u = new TextEncoder().encode(str);
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
}

// Fake Obsidian vault adapter with immediate-children list() semantics,
// mirroring scripts/writing-source-test.js.
function makeVaultApp(fileMap) {
  const adapter = {
    async list(dir) {
      const prefix = dir ? dir + "/" : "";
      const filesOut = [];
      const folderSet = new Set();
      for (const p of Object.keys(fileMap)) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        if (!rest) continue;
        const slash = rest.indexOf("/");
        if (slash === -1) filesOut.push(p);
        else folderSet.add(prefix + rest.slice(0, slash));
      }
      return { files: filesOut, folders: [...folderSet] };
    },
    async stat(p) {
      const f = fileMap[p];
      if (!f) return null;
      return { type: "file", size: f.size, mtime: f.mtime, ctime: f.mtime };
    },
    async readBinary(p) {
      const f = fileMap[p];
      if (!f) throw new Error("file not found: " + p);
      return toBytes(f.content || "");
    },
  };
  return { vault: { adapter } };
}

// In-memory stand-in for vault.adapter's file side (exists/read/write).
function makeMemAdapter() {
  const files = new Map();
  const adapter = {
    writeCount: 0,
    async exists(p) { return files.has(p); },
    async read(p) {
      if (!files.has(p)) throw new Error("ENOENT: " + p);
      return files.get(p);
    },
    async write(p, data) { adapter.writeCount++; files.set(p, String(data)); },
    __readRaw(p) { return files.get(p); },
  };
  return adapter;
}

// Deterministic keyword embed: BASEBALL -> [1,0,0], PHOTOSYNTHESIS -> [0,1,0], else [0,0,1].
function keywordEmbed(texts) {
  return Promise.resolve(texts.map((t) =>
    t.includes("BASEBALL") ? [1, 0, 0]
      : t.includes("PHOTOSYNTHESIS") ? [0, 1, 0]
        : [0, 0, 1]));
}

function makeCountingEmbed(fn) {
  const calls = [];
  const embed = async (texts) => { calls.push(texts.length); return fn(texts); };
  embed.calls = calls;
  return embed;
}

function makeStore(memAdapter, embed, embeddingKey, extractDeps) {
  return new ContextStore({
    adapter: memAdapter,
    path: IDX,
    embed,
    embeddingKey,
    extractDeps: extractDeps || {},
  });
}

function persisted(memAdapter) {
  return JSON.parse(memAdapter.__readRaw(IDX));
}

async function main() {
  assert.strictEqual(typeof ContextStore, "function", "ContextStore must be a class");

  // 1. first sync adds all; second sync with unchanged stat is a no-op.
  {
    const fileMap = {
      "Writing Context/a.md": { size: 30, mtime: 1000, content: "# Alpha\nBASEBALL notes here\n" },
      "Writing Context/b.txt": { size: 40, mtime: 1000, content: "plain PHOTOSYNTHESIS text\n" },
    };
    const app = makeVaultApp(fileMap);
    const mem = makeMemAdapter();
    const embed = makeCountingEmbed(keywordEmbed);
    const store = makeStore(mem, embed, "k1");
    await store.load();
    const r1 = await store.sync(ROOT, app);
    assert.deepStrictEqual(r1, { added: 2, changed: 0, removed: 0, skipped: [] });
    assert.deepStrictEqual(embed.calls, [2], "one embed batch for 2 chunks");
    assert.strictEqual(mem.writeCount, 1, "sync saves when changed");
    const data = persisted(mem);
    assert.strictEqual(data.version, 1);
    assert.strictEqual(data.embeddingKey, "k1");
    assert.deepStrictEqual(Object.keys(data.files).sort(),
      ["Writing Context/a.md", "Writing Context/b.txt"]);
    assert.strictEqual(data.files["Writing Context/a.md"].name, "a.md");
    for (const c of data.chunks) {
      assert.ok(c.id.startsWith(c.file + "#"), "chunk id prefixed: " + c.id);
      assert.strictEqual(c.vector.length, 3);
    }

    const r2 = await store.sync(ROOT, app);
    assert.deepStrictEqual(r2, { added: 0, changed: 0, removed: 0, skipped: [] });
    assert.deepStrictEqual(embed.calls, [2], "unchanged sync must not call embed");
    assert.strictEqual(mem.writeCount, 1, "no-op sync must not save");
    console.log("PASS first sync adds all; second sync is a no-op");

    // 2. changed mtime re-extracts only that file; deleted file's chunks removed.
    fileMap["Writing Context/a.md"] = { size: 31, mtime: 2000, content: "# Alpha\nBASEBALL updated notes\n" };
    delete fileMap["Writing Context/b.txt"];
    const r3 = await store.sync(ROOT, app);
    assert.deepStrictEqual(r3, { added: 0, changed: 1, removed: 1, skipped: [] });
    assert.deepStrictEqual(embed.calls, [2, 1], "only the changed file is re-embedded");
    const data3 = persisted(mem);
    assert.ok(!data3.files["Writing Context/b.txt"], "deleted file dropped from files");
    assert.ok(data3.chunks.every((c) => c.file !== "Writing Context/b.txt"),
      "deleted file chunks removed");
    console.log("PASS changed mtime re-extracts only that file; deleted file removed");

    // 3. different embeddingKey on load rebuilds everything (no mixed vectors).
    const embed2 = makeCountingEmbed(keywordEmbed);
    const store2 = makeStore(mem, embed2, "k2");
    await store2.load();
    const r4 = await store2.sync(ROOT, app);
    assert.strictEqual(r4.added, 1, "key change rebuilds all, got " + JSON.stringify(r4));
    assert.deepStrictEqual(embed2.calls, [1], "rebuild re-embeds every file");
    assert.strictEqual(persisted(mem).embeddingKey, "k2");
    const rebuilt = store2.search([1, 0, 0], 5);
    assert.strictEqual(rebuilt.length, 1);
    assert.strictEqual(rebuilt[0].score, 1);
    console.log("PASS embeddingKey change rebuilds without mixed vectors");
  }

  // 4. embed rejection keeps the same error/code and leaves disk + memory untouched.
  {
    const fileMap = {
      "Writing Context/a.md": { size: 30, mtime: 1000, content: "# Alpha\nBASEBALL notes\n" },
    };
    const app = makeVaultApp(fileMap);
    const mem = makeMemAdapter();
    const good = makeStore(mem, makeCountingEmbed(keywordEmbed), "k1");
    await good.load();
    await good.sync(ROOT, app);
    const before = mem.__readRaw(IDX);
    const writesBefore = mem.writeCount;
    fileMap["Writing Context/a.md"] = { size: 31, mtime: 2000, content: "# Alpha\nBASEBALL changed\n" };
    const failingEmbed = async () => {
      const err = new Error("no embedding access");
      err.code = "embedding-access-unavailable";
      throw err;
    };
    const bad = makeStore(mem, failingEmbed, "k1");
    await bad.load();
    await assert.rejects(bad.sync(ROOT, app),
      (err) => err && err.code === "embedding-access-unavailable",
      "sync must reject with the embed error/code");
    assert.strictEqual(mem.__readRaw(IDX), before, "disk untouched after embed failure");
    assert.strictEqual(mem.writeCount, writesBefore, "save not called after embed failure");
    const still = bad.search([1, 0, 0], 5);
    assert.strictEqual(still.length, 1, "in-memory state restored");
    assert.ok(still[0].text.includes("BASEBALL notes"), "old text kept, got: " + still[0].text);
    console.log("PASS embed failure rejects and leaves the store untouched");
  }

  // 5. extraction error for one file lands in skipped; others still indexed.
  {
    const fileMap = {
      "Writing Context/ok.md": { size: 10, mtime: 1000, content: "# Ok\nBASEBALL fine\n" },
      "Writing Context/bad.pdf": { size: 12, mtime: 1000, content: "not a pdf" },
      "Writing Context/ok2.txt": { size: 14, mtime: 1000, content: "PHOTOSYNTHESIS fine\n" },
    };
    const app = makeVaultApp(fileMap);
    const mem = makeMemAdapter();
    const store = makeStore(mem, makeCountingEmbed(keywordEmbed), "k1", {
      loadPdfJs: async () => {
        const err = new Error("bad pdf");
        err.code = "pdf-parse-failed";
        throw err;
      },
    });
    await store.load();
    const r = await store.sync(ROOT, app);
    assert.strictEqual(r.added, 2, "good files indexed, got " + JSON.stringify(r));
    assert.strictEqual(r.skipped.length, 1);
    assert.strictEqual(r.skipped[0].id, "Writing Context/bad.pdf");
    assert.strictEqual(r.skipped[0].reason, "pdf-parse-failed");
    const hits = store.search([1, 0, 0], 5);
    assert.ok(hits.some((h) => h.file.endsWith("ok.md")), "good files still indexed");
    assert.ok(hits.every((h) => h.file !== "Writing Context/bad.pdf"), "bad file not indexed");
    console.log("PASS extraction error skipped, others indexed");
  }

  // 6. search returns top-k by cosine, descending; empty store searches empty.
  {
    const mem0 = makeMemAdapter();
    const empty = makeStore(mem0, makeCountingEmbed(keywordEmbed), "k");
    await empty.load();
    assert.deepStrictEqual(empty.search([1, 0, 0], 3), [], "empty store searches empty");
    const fileMap = {
      "Writing Context/cats.md": { size: 10, mtime: 1000, content: "BASEBALL BASEBALL BASEBALL\n" },
      "Writing Context/dogs.md": { size: 10, mtime: 1000, content: "PHOTOSYNTHESIS PHOTOSYNTHESIS\n" },
      "Writing Context/other.md": { size: 10, mtime: 1000, content: "nothing distinctive here\n" },
    };
    const app = makeVaultApp(fileMap);
    const mem = makeMemAdapter();
    const store = makeStore(mem, makeCountingEmbed(keywordEmbed), "k");
    await store.load();
    await store.sync(ROOT, app);
    const top2 = store.search([1, 0, 0], 2);
    assert.strictEqual(top2.length, 2);
    assert.ok(top2[0].file.endsWith("cats.md"), "best match first, got " + top2[0].file);
    assert.ok(top2[0].score >= top2[1].score, "scores descending");
    assert.strictEqual(top2[0].score, 1);
    assert.strictEqual(top2[0].name, "cats.md");
    for (const h of top2) {
      assert.ok(h.id && h.file && h.name && h.text !== undefined && h.locator !== undefined
        && typeof h.score === "number", "hit shape: " + JSON.stringify(h));
    }
    console.log("PASS search returns top-k by cosine descending");
  }

  // 7. segments longer than ~1500 chars split into chunks with the same locator.
  {
    const fileMap = {
      "Writing Context/big.md": { size: 5000, mtime: 1000, content: "# Big\n" + "x".repeat(4000) + "\n" },
      "Writing Context/paras.md": {
        size: 4000,
        mtime: 1000,
        content: "# P\n" + "a".repeat(1000) + "\n\n" + "b".repeat(1000) + "\n\n" + "c".repeat(1000) + "\n",
      },
    };
    const app = makeVaultApp(fileMap);
    const mem = makeMemAdapter();
    const store = makeStore(mem, makeCountingEmbed(keywordEmbed), "k");
    await store.load();
    const r = await store.sync(ROOT, app);
    assert.deepStrictEqual(r.skipped, []);
    const data = persisted(mem);
    const big = data.chunks.filter((c) => c.file.endsWith("big.md"));
    assert.strictEqual(big.length, 3, "4000 chars -> 3 chunks, got " + big.length);
    assert.deepStrictEqual(big.map((c) => c.id), big.map((c) => c.file + "#" + big.indexOf(c)));
    assert.ok(big.every((c) => c.locator === "Big"), "hard-split pieces keep the locator");
    assert.ok(big.every((c) => c.text.length <= 1500), "each piece <= 1500 chars");
    assert.strictEqual(big.map((c) => c.text).join("").length, 4000, "no text lost in hard split");
    const paras = data.chunks.filter((c) => c.file.endsWith("paras.md"));
    assert.strictEqual(paras.length, 3, "paragraph split, got " + paras.length);
    assert.ok(paras.every((c) => c.locator === "P"), "paragraph pieces keep the locator");
    assert.ok(paras.every((c) => c.text.length <= 1500), "each piece <= 1500 chars");
    console.log("PASS long segments split with the same locator");
  }

  // 8. oversize listing entries go to skipped with reason and are never extracted.
  {
    const bigSize = 20 * 1024 * 1024 + 1;
    const fileMap = {
      "Writing Context/huge.pdf": { size: bigSize, mtime: 1000, content: "tiny stand-in" },
      "Writing Context/small.md": { size: 10, mtime: 1000, content: "BASEBALL small\n" },
    };
    const app = makeVaultApp(fileMap);
    const mem = makeMemAdapter();
    const embed = makeCountingEmbed(keywordEmbed);
    const store = makeStore(mem, embed, "k");
    await store.load();
    const r = await store.sync(ROOT, app);
    assert.strictEqual(r.added, 1);
    assert.deepStrictEqual(r.skipped, [{ id: "Writing Context/huge.pdf", reason: "too-large" }]);
    assert.deepStrictEqual(embed.calls, [1], "oversize file never embedded");
    assert.ok(!persisted(mem).files["Writing Context/huge.pdf"], "oversize file not indexed");
    console.log("PASS oversize listing skipped with reason");
  }

  // 9. embed is called in batches of 32.
  {
    let md = "";
    for (let i = 0; i < 70; i++) md += "# h" + i + "\nbody " + i + "\n";
    const fileMap = {
      "Writing Context/many.md": { size: md.length, mtime: 1000, content: md },
    };
    const app = makeVaultApp(fileMap);
    const mem = makeMemAdapter();
    const embed = makeCountingEmbed(keywordEmbed);
    const store = makeStore(mem, embed, "k");
    await store.load();
    const r = await store.sync(ROOT, app);
    assert.deepStrictEqual(r, { added: 1, changed: 0, removed: 0, skipped: [] });
    assert.deepStrictEqual(embed.calls, [32, 32, 6], "embed batches of 32, got " + JSON.stringify(embed.calls));
    assert.strictEqual(persisted(mem).chunks.length, 70);
    console.log("PASS embed batches of 32");
  }

  console.log("writing-store-test: PASS");
}

main().catch((err) => { console.error("FAIL", err); process.exit(1); });
