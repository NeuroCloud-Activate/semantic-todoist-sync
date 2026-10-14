"use strict";

// scripts/vault-harness-test.js — Task 1 Step 2: failing-harness test for the
// read-only vault harness. Exercises the REAL harness functions via the
// testModule pattern (Module._compile of scripts/lib/vault-harness.js +
// `module.exports.__testVaultHarness = {...}` suffix) on a temp fixture vault.
// No vault content leaves the temp dir; the fixture is removed in finally.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

const harnessPath = path.join(__dirname, "lib", "vault-harness.js");
const harnessSource = fs.readFileSync(harnessPath, "utf8");
const testModule = new Module(harnessPath, module);
testModule.filename = harnessPath;
testModule.paths = Module._nodeModulePaths(path.dirname(harnessPath));

let harnessExports;
try {
  testModule._compile(
    `${harnessSource}\nmodule.exports.__testVaultHarness = {\n` +
      "  createReadOnlyAdapter, isPluginOwnPath, isVector, vectorLength,\n" +
      "  parseArgs, loadPlugin, cachedQueryEmbeddings,\n" +
      "  writeResult, sha8, pairedBootstrap\n" +
      "};\n",
    harnessPath
  );
  harnessExports = testModule.exports;
} finally {
  delete require.cache[harnessPath];
}

const {
  createReadOnlyAdapter,
  isPluginOwnPath,
  isVector,
  vectorLength,
  parseArgs,
  loadPlugin,
  cachedQueryEmbeddings,
  writeResult,
  sha8,
  pairedBootstrap,
} = harnessExports.__testVaultHarness;

const failures = [];

async function check(name, assertion) {
  try {
    await assertion();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push(`${name}: ${(error && error.message) || error}`);
    console.error(`FAIL: ${name}: ${(error && error.message) || error}`);
  }
}

async function main() {
  const tmpBase = path.join(os.tmpdir(), "opencode");
  fs.mkdirSync(tmpBase, { recursive: true });
  const vaultDir = fs.mkdtempSync(path.join(tmpBase, `vht-${process.pid}-`));
  try {
    const aContent = "# Alpha\n\nSee [[b]] for the follow-up.\n";
    const bContent = "# Beta\n\nStandalone body.\n";
    fs.writeFileSync(path.join(vaultDir, "a.md"), aContent, "utf8");
    fs.writeFileSync(path.join(vaultDir, "b.md"), bContent, "utf8");

    const adapter = createReadOnlyAdapter(vaultDir);

    await check("adapter refuses writes", async () => {
      for (const method of [
        "write",
        "writeBinary",
        "append",
        "remove",
        "rename",
        "mkdir",
        "rmdir",
        "copy",
        "process",
      ]) {
        await assert.rejects(adapter[method]("x.md", "y"), /read-only/);
      }
    });

    await check("adapter reads", async () => {
      assert.equal(await adapter.read("a.md"), aContent);
      assert.equal(await adapter.exists("a.md"), true);
      assert.equal(await adapter.exists("missing.md"), false);
      const listed = await adapter.list("");
      assert.ok(listed.files.includes("a.md"), `files: ${listed.files.join(",")}`);
      assert.ok(listed.files.includes("b.md"), `files: ${listed.files.join(",")}`);
      const stat = await adapter.stat("a.md");
      assert.ok(stat.size > 0);
      const bin = await adapter.readBinary("b.md");
      assert.equal(Buffer.from(bin).toString("utf8"), bContent);
    });

    await check("parseArgs defaults", async () => {
      const parsed = parseArgs(["node", "vault-harness", "--vault", vaultDir]);
      assert.equal(parsed.vault, vaultDir);
      assert.equal(parsed.mode, "exact");
      assert.ok(parsed.out.endsWith("eval-private"), `out: ${parsed.out}`);
      assert.ok(parsed.runtime.endsWith("main.js"), `runtime: ${parsed.runtime}`);
    });

    await check("bootstrap is deterministic and centred", async () => {
      const base = [0.0, 0.25, 0.5, 0.75, 1.0];
      assert.deepEqual(pairedBootstrap(base, base.slice()), { mean: 0, lo: 0, hi: 0 });
      const up = base.map((v) => v + 0.1);
      const res = pairedBootstrap(base, up);
      assert.ok(Math.abs(res.mean - 0.1) < 1e-9, `mean: ${res.mean}`);
      assert.ok(Math.abs(res.lo - 0.1) < 1e-9, `lo: ${res.lo}`);
      assert.ok(Math.abs(res.hi - 0.1) < 1e-9, `hi: ${res.hi}`);
      assert.deepEqual(pairedBootstrap(base, up), pairedBootstrap(base, up));
    });

    await check("writeResult round-trips and sha8 is stable", async () => {
      const outDir = path.join(vaultDir, "out");
      const dest = writeResult(outDir, "probe.json", { hello: "world" });
      assert.deepEqual(JSON.parse(fs.readFileSync(dest, "utf8")), { hello: "world" });
      assert.equal(sha8("abc"), sha8(Buffer.from("abc")));
      assert.equal(sha8("abc").length, 8);
    });

    await check("cached embeddings hit cache offline, miss errors clearly", async () => {
      const outDir = path.join(vaultDir, "eval-out");
      const fake = {
        settings: { embeddingModel: "probe-model" },
        calls: 0,
        async embedTexts(texts, role) {
          this.calls += 1;
          assert.equal(role, "query");
          return texts.map((t) => [t.length]);
        },
      };
      const vectors = await cachedQueryEmbeddings(fake, ["hello", "world"], outDir);
      assert.deepEqual(vectors, [[5], [5]]);
      assert.equal(fake.calls, 1);
      // Second instance, embedding endpoint down: cache serves everything.
      const offline = {
        settings: { embeddingModel: "probe-model" },
        async embedTexts() {
          throw new Error("connect refused");
        },
      };
      assert.deepEqual(await cachedQueryEmbeddings(offline, ["hello"], outDir), [[5]]);
      // First-ever run without cache and no endpoint: clear non-zero failure.
      await assert.rejects(
        cachedQueryEmbeddings(offline, ["brand new query"], path.join(vaultDir, "empty-out")),
        /query embedding unavailable: 1 uncached; start the embedding server once/
      );
    });

    await check("loadPlugin boots the real class on the fixture", async () => {
      const plugin = await loadPlugin({ vault: vaultDir, mode: "exact" });
      assert.equal(plugin.settings.semanticSearchMode, "exact");
      assert.ok(Array.isArray(plugin.semanticIndex));
    });

    await check("default adapter still rejects plugin-path writes (no opt-in)", async () => {
      const strict = createReadOnlyAdapter(vaultDir);
      assert.equal(strict.__inMemoryWrites, false);
      await assert.rejects(
        strict.write(".obsidian/plugins/semantic-todoist-sync/probe.json", "{}"),
        /read-only/
      );
    });

    await check("inMemoryWrites accepts plugin-internal writes, disk stays identical", async () => {
      const pluginDir = path.join(vaultDir, ".obsidian", "plugins", "semantic-todoist-sync");
      fs.mkdirSync(pluginDir, { recursive: true });
      const stableFile = path.join(pluginDir, "stable.json");
      fs.writeFileSync(stableFile, JSON.stringify({ keep: true }), "utf8");
      const snapshotTree = () => {
        const rows = [];
        const walk = (dir) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
            (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(abs);
            else rows.push(`${path.relative(vaultDir, abs)}:${fs.statSync(abs).size}:${sha8(fs.readFileSync(abs))}`);
          }
        };
        walk(vaultDir);
        return rows.join("\n");
      };
      const before = snapshotTree();
      const overlay = createReadOnlyAdapter(vaultDir, { inMemoryWrites: true });
      assert.equal(overlay.__inMemoryWrites, true);
      const pluginRel = ".obsidian/plugins/semantic-todoist-sync/probe.json";
      // write + read-after-write verification (the v4 load-path pattern).
      await overlay.write(pluginRel, JSON.stringify({ hello: "memory" }));
      assert.equal(await overlay.read(pluginRel), JSON.stringify({ hello: "memory" }));
      assert.equal(await overlay.exists(pluginRel), true);
      const listed = await overlay.list(".obsidian/plugins/semantic-todoist-sync");
      assert.ok(listed.files.includes(pluginRel), `overlay list: ${listed.files.join(",")}`);
      // remove hides without deleting disk content (nothing was on disk here).
      await overlay.remove(pluginRel);
      assert.equal(await overlay.exists(pluginRel), false);
      // stale-file cleanup pattern: removing a disk-backed plugin file must
      // hide it from the overlay yet leave the disk bytes alone.
      await overlay.remove(".obsidian/plugins/semantic-todoist-sync/stable.json");
      assert.equal(await overlay.exists(".obsidian/plugins/semantic-todoist-sync/stable.json"), false);
      assert.equal(fs.readFileSync(stableFile, "utf8"), JSON.stringify({ keep: true }));
      // rename/copy/process round-trip inside the overlay.
      await overlay.write(pluginRel, "v1");
      await overlay.rename(pluginRel, ".obsidian/plugins/semantic-todoist-sync/renamed.json");
      assert.equal(await overlay.read(".obsidian/plugins/semantic-todoist-sync/renamed.json"), "v1");
      await overlay.copy(
        ".obsidian/plugins/semantic-todoist-sync/renamed.json",
        ".obsidian/plugins/semantic-todoist-sync/copied.json"
      );
      assert.equal(await overlay.read(".obsidian/plugins/semantic-todoist-sync/copied.json"), "v1");
      await overlay.process(".obsidian/plugins/semantic-todoist-sync/copied.json", (current) => `${current}+p`);
      assert.equal(await overlay.read(".obsidian/plugins/semantic-todoist-sync/copied.json"), "v1+p");
      await overlay.append(".obsidian/plugins/semantic-todoist-sync/copied.json", "+a");
      assert.equal(await overlay.read(".obsidian/plugins/semantic-todoist-sync/copied.json"), "v1+p+a");
      const probe = await overlay.readBinary(".obsidian/plugins/semantic-todoist-sync/copied.json");
      assert.equal(Buffer.from(probe).toString("utf8"), "v1+p+a");
      // NON-plugin paths still throw read-only even with the opt-in.
      for (const [method, args] of [
        ["write", ["notes/evil.md", "x"]],
        ["writeBinary", ["notes/evil.bin", Buffer.from("x")]],
        ["append", ["notes/evil.md", "x"]],
        ["remove", ["a.md"]],
        ["rename", ["a.md", "notes/a.md"]],
        ["mkdir", ["notes/newdir"]],
        ["rmdir", ["notes"]],
        ["copy", ["a.md", "notes/a.md"]],
        ["process", ["a.md", (current) => current]],
      ]) {
        await assert.rejects(overlay[method](...args), /read-only/, `${method} must stay read-only off plugin dir`);
      }
      // Disk is byte-identical: overlay never reached the filesystem.
      assert.equal(snapshotTree(), before);
    });

    await check("typed-array vectors accepted (v4 Float64Array)", async () => {
      assert.equal(isVector([1, 2]), true);
      assert.equal(isVector(new Float64Array([1, 2])), true);
      assert.equal(isVector(new Float32Array([1])), true);
      assert.equal(isVector("nope"), false);
      assert.equal(isVector(42), false);
      assert.equal(vectorLength(new Float64Array(1024)), 1024);
      assert.equal(vectorLength([3]), 1);
      assert.equal(vectorLength(null), 0);
      const { cosine } = require("./retrieval-eval.js");
      const plain = [1, 0, 0];
      const typed = new Float64Array([1, 0, 0]);
      assert.ok(Math.abs(cosine(plain, typed) - 1) < 1e-12, "plain vs typed cosine");
      assert.ok(Math.abs(cosine(typed, typed) - 1) < 1e-12, "typed vs typed cosine");
      assert.equal(cosine(typed, new Float64Array([0, 1, 0])), 0);
      assert.equal(isPluginOwnPath(".obsidian/plugins/semantic-todoist-sync/x.json"), true);
      assert.equal(isPluginOwnPath("notes/x.md"), false);
    });
  } finally {
    fs.rmSync(vaultDir, { recursive: true, force: true });
  }

  if (failures.length) {
    throw new Error(`vault harness test failed (${failures.length}):\n- ${failures.join("\n- ")}`);
  }
  console.log("vault harness test: pass");
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  }
);
