"use strict";

// Task 3 (context folder source) — TDD test, vault-only contract.
// Absolute configured paths are rejected at resolve time (vault default +
// notice); legacy { kind: "external" } rootInfo values are rejected/handled
// without touching Node fs. Static assert below pins the no-fs requirement.
const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const nodePath = require("path");
const ownFs = require("fs");

const source = require("../src/context/source.js");

const tmpRoots = [];

async function makeTempDir(prefix) {
  const dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

// Fake Obsidian vault adapter with immediate-children list() semantics.
function makeVaultApp(fileMap, opts = {}) {
  const mkdirCalls = [];
  const existingFolders = new Set(opts.folders || []);
  const adapter = {
    async list(dir) {
      const prefix = dir ? `${dir}/` : "";
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
      if (!f) throw new Error(`file not found: ${p}`);
      const u = new TextEncoder().encode(f.content || "");
      return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
    },
    async exists(p) {
      if (fileMap[p]) return true;
      return existingFolders.has(p);
    },
    async mkdir(p) {
      mkdirCalls.push(p);
      existingFolders.add(p);
    },
  };
  return { vault: { adapter }, __mkdirCalls: mkdirCalls };
}

function bufToString(ab) {
  return Buffer.from(ab).toString("utf8");
}

const VAULT_DEFAULT = "Semantic Todoist Sync/Context";
const OUTSIDE_NOTICE_RE = /outside the vault.*no longer supported/i;

(async () => {
  // 1. vault mode lists nested files, filters .exe, returns size/mtime
  {
    const app = makeVaultApp({
      "Writing Context/a.md": { size: 12, mtime: 1700000000000, content: "hello a" },
      "Writing Context/sub/b.pdf": { size: 34, mtime: 1700000001000, content: "pdf-bytes" },
      "Writing Context/sub/evil.exe": { size: 56, mtime: 1700000002000, content: "x" },
      "Writing Context/notes/UPPER.JPG": { size: 78, mtime: 1700000003000, content: "img" },
    });
    const rootInfo = await source.resolveContextRoot(app, { writingContextFolder: "Writing Context" }, { isDesktop: true });
    assert.strictEqual(rootInfo.kind, "vault");
    const files = await source.listContextFiles(rootInfo, app);
    const ids = files.map((f) => f.id).sort();
    assert.deepStrictEqual(ids, [
      "Writing Context/a.md",
      "Writing Context/notes/UPPER.JPG",
      "Writing Context/sub/b.pdf",
    ]);
    const a = files.find((f) => f.id === "Writing Context/a.md");
    assert.strictEqual(a.name, "a.md");
    assert.strictEqual(a.size, 12);
    assert.strictEqual(a.mtime, 1700000000000);
    assert.ok(!("skipped" in a));
    const content = bufToString(await source.readContextFile(rootInfo, app, "Writing Context/a.md"));
    assert.strictEqual(content, "hello a");
    console.log("PASS vault mode lists nested files, filters .exe, returns size/mtime");
  }

  // 2. absolute configured path on desktop resolves to the vault default + notice
  {
    const dir = await makeTempDir("writing-source-ext-");
    await fs.writeFile(nodePath.join(dir, "a.md"), "ext hello");
    const app = makeVaultApp({
      "Semantic Todoist Sync/Context/from-vault.md": { size: 9, mtime: 1700000013000, content: "vault wins" },
    });
    const rootInfo = await source.resolveContextRoot(
      app, { writingContextFolder: dir }, { isDesktop: true }
    );
    assert.strictEqual(rootInfo.kind, "vault");
    assert.strictEqual(rootInfo.root, VAULT_DEFAULT);
    assert.ok(rootInfo.notice && OUTSIDE_NOTICE_RE.test(rootInfo.notice), `notice must say outside-vault/no-longer-supported, got: ${rootInfo.notice}`);
    assert.ok(rootInfo.notice.includes(dir), "notice must echo the configured path");
    // The on-disk temp file must NOT leak into the listing: vault wins.
    const files = await source.listContextFiles(rootInfo, app);
    assert.deepStrictEqual(files.map((f) => f.id), ["Semantic Todoist Sync/Context/from-vault.md"]);
    console.log("PASS absolute path on desktop resolves to vault default with notice");
  }

  // 3. absolute path on mobile resolves to the same vault default + notice
  {
    const app = makeVaultApp({});
    const abs = nodePath.join(os.tmpdir(), "writing-source-mobile-absent");
    const rootInfo = await source.resolveContextRoot(
      app, { writingContextFolder: abs }, { isDesktop: false }
    );
    assert.strictEqual(rootInfo.kind, "vault");
    assert.strictEqual(rootInfo.root, VAULT_DEFAULT);
    assert.ok(rootInfo.notice && OUTSIDE_NOTICE_RE.test(rootInfo.notice), `notice must say outside-vault/no-longer-supported, got: ${rootInfo.notice}`);
    console.log("PASS absolute path on mobile resolves to vault default with notice");
  }

  // 4. missing absolute dir -> vault default + notice (no fs probe)
  {
    const app = makeVaultApp({});
    const missing = nodePath.join(os.tmpdir(), `writing-source-gone-${Date.now()}`);
    const rootInfo = await source.resolveContextRoot(
      app, { writingContextFolder: missing }, { isDesktop: true }
    );
    assert.strictEqual(rootInfo.kind, "vault");
    assert.strictEqual(rootInfo.root, VAULT_DEFAULT);
    assert.ok(rootInfo.notice && OUTSIDE_NOTICE_RE.test(rootInfo.notice), `missing absolute dir must produce the outside-vault notice, got: ${rootInfo.notice}`);
    console.log("PASS missing absolute dir resolves to vault default with notice");
  }

  // 5. files > 20MB are returned with skipped too-large and are not readable
  {
    const big = 20 * 1024 * 1024 + 1;
    const app = makeVaultApp({
      "Writing Context/big.pdf": { size: big, mtime: 1700000004000, content: "too big" },
      "Writing Context/small.md": { size: 5, mtime: 1700000005000, content: "ok" },
    });
    const rootInfo = await source.resolveContextRoot(app, { writingContextFolder: "Writing Context" }, { isDesktop: true });
    const files = await source.listContextFiles(rootInfo, app);
    const bigEntry = files.find((f) => f.id === "Writing Context/big.pdf");
    assert.ok(bigEntry, "oversize file must still be listed");
    assert.strictEqual(bigEntry.skipped, "too-large");
    assert.strictEqual(bigEntry.size, big);
    await assert.rejects(
      source.readContextFile(rootInfo, app, "Writing Context/big.pdf"),
      /too-large/,
      "oversize file must not be readable"
    );
    const small = bufToString(await source.readContextFile(rootInfo, app, "Writing Context/small.md"));
    assert.strictEqual(small, "ok");
    console.log("PASS oversize files are skipped and unreadable");
  }

  // 6. ensureVaultContextFolder creates a missing folder, no-ops when present
  {
    const app = makeVaultApp({}, { folders: ["Writing Context"] });
    await source.ensureVaultContextFolder(app, "Writing Context");
    assert.deepStrictEqual(app.__mkdirCalls, [], "existing folder must not be recreated");
    await source.ensureVaultContextFolder(app, "Writing Context/New");
    assert.deepStrictEqual(app.__mkdirCalls, ["Writing Context/New"]);
    console.log("PASS ensureVaultContextFolder creates missing folders only");
    const nested = makeVaultApp({});
    await source.ensureVaultContextFolder(nested, VAULT_DEFAULT);
    assert.deepStrictEqual(nested.__mkdirCalls, ["Semantic Todoist Sync", VAULT_DEFAULT], "parents are created before the context folder");
    console.log("PASS ensureVaultContextFolder creates missing parent folders");
  }

  // 7. CONTEXT_EXTENSIONS covers the spec formats
  {
    assert.ok(Array.isArray(source.CONTEXT_EXTENSIONS));
    for (const ext of ["md", "txt", "docx", "xlsx", "csv", "pdf", "png", "jpg", "jpeg"]) {
      assert.ok(source.CONTEXT_EXTENSIONS.includes(ext), `missing extension: ${ext}`);
    }
    console.log("PASS CONTEXT_EXTENSIONS covers md/txt/docx/xlsx/csv/pdf/images");
  }

  // 8. vault traversal outside the context root is rejected
  {
    const app = makeVaultApp({
      "Writing Context/a.md": { size: 5, mtime: 1700000006000, content: "ok" },
    });
    const rootInfo = await source.resolveContextRoot(app, { writingContextFolder: "Writing Context" }, { isDesktop: true });
    await assert.rejects(
      source.readContextFile(rootInfo, app, "Writing Context/../secret.md"),
      (err) => err && err.code === "outside-context-root",
      "vault ../ traversal must be rejected"
    );
    await assert.rejects(
      source.readContextFile(rootInfo, app, "Other/x.md"),
      (err) => err && err.code === "outside-context-root",
      "vault id outside root must be rejected"
    );
    const content = bufToString(await source.readContextFile(rootInfo, app, "Writing Context/a.md"));
    assert.strictEqual(content, "ok");
    console.log("PASS vault traversal outside context root is rejected");
  }

  // 9. legacy { kind: "external" } rootInfo never touches fs: reads rejected,
  // listing falls back to the vault default
  {
    const dir = await makeTempDir("writing-source-ext-guard-");
    await fs.writeFile(nodePath.join(dir, "a.md"), "ok");
    const vaultApp = makeVaultApp({
      "Semantic Todoist Sync/Context/kept.md": { size: 2, mtime: 1700000014000, content: "kept" },
    });
    const rootInfo = { kind: "external", root: dir };
    await assert.rejects(
      source.readContextFile(rootInfo, vaultApp, nodePath.join(dir, "a.md")),
      (err) => err && (err.code === "outside-context-root" || err.code === "not-found"),
      "legacy external read must be rejected without fs"
    );
    const files = await source.listContextFiles(rootInfo, vaultApp);
    assert.ok(
      files.every((f) => !nodePath.isAbsolute(f.id)),
      "legacy external listing must not return absolute fs ids"
    );
    assert.deepStrictEqual(files.map((f) => f.id), ["Semantic Todoist Sync/Context/kept.md"]);
    console.log("PASS legacy external rootInfo is rejected/handled without fs");
  }

  // 10. vault folder setting is normalised
  {
    const app = makeVaultApp({
      "Writing Context/a.md": { size: 3, mtime: 1700000007000, content: "ok" },
    });
    const slashed = await source.resolveContextRoot(
      app, { writingContextFolder: "Writing Context/" }, { isDesktop: true }
    );
    assert.strictEqual(slashed.root, "Writing Context");
    assert.deepStrictEqual(
      (await source.listContextFiles(slashed, app)).map((f) => f.id),
      ["Writing Context/a.md"]
    );
    const app2 = makeVaultApp({
      "Writing Context/Sub/a.md": { size: 3, mtime: 1700000008000, content: "sub" },
    });
    const backslashed = await source.resolveContextRoot(
      app2, { writingContextFolder: "Writing Context\\Sub" }, { isDesktop: true }
    );
    assert.strictEqual(backslashed.root, "Writing Context/Sub");
    assert.deepStrictEqual(
      (await source.listContextFiles(backslashed, app2)).map((f) => f.id),
      ["Writing Context/Sub/a.md"]
    );
    const blank = await source.resolveContextRoot(app, { writingContextFolder: "   " }, { isDesktop: true });
    assert.strictEqual(blank.root, VAULT_DEFAULT);
    console.log("PASS vault folder setting is normalised");
  }

  // 11. dot folders/files are skipped in vault recursion; absolute roots
  // resolve to the vault default instead of walking fs
  {
    const app = makeVaultApp({
      "Writing Context/a.md": { size: 2, mtime: 1700000009000, content: "ok" },
      "Writing Context/.obsidian/x.md": { size: 2, mtime: 1700000010000, content: "hidden" },
      "Writing Context/.git/y.txt": { size: 2, mtime: 1700000011000, content: "hidden" },
      "Writing Context/.hidden.md": { size: 2, mtime: 1700000012000, content: "hidden" },
    });
    const rootInfo = await source.resolveContextRoot(app, { writingContextFolder: "Writing Context" }, { isDesktop: true });
    assert.deepStrictEqual(
      (await source.listContextFiles(rootInfo, app)).map((f) => f.id),
      ["Writing Context/a.md"]
    );
    const dir = await makeTempDir("writing-source-ext-dot-");
    await fs.writeFile(nodePath.join(dir, ".hidden.md"), "hidden");
    const absRoot = await source.resolveContextRoot(app, { writingContextFolder: dir }, { isDesktop: true });
    assert.strictEqual(absRoot.kind, "vault");
    assert.strictEqual(absRoot.root, VAULT_DEFAULT);
    console.log("PASS dot folders/files are skipped");
  }

  // 12. missing vault files report code not-found
  {
    const app = makeVaultApp({});
    const rootInfo = await source.resolveContextRoot(app, { writingContextFolder: "Writing Context" }, { isDesktop: true });
    await assert.rejects(
      source.readContextFile(rootInfo, app, "Writing Context/missing.md"),
      (err) => err && err.code === "not-found",
      "vault missing file must report not-found"
    );
    console.log("PASS missing files report not-found");
  }

  // 13. source file contains no direct Node filesystem requires
  {
    const srcText = ownFs.readFileSync(nodePath.join(__dirname, "..", "src", "context", "source.js"), "utf8");
    for (const banned of ['require("fs")', "require('fs')", 'require("fs/promises")', "require('fs/promises')", 'require("path")', "require('path')"]) {
      assert.ok(!srcText.includes(banned), `source.js must not contain ${banned}`);
    }
    console.log("PASS source.js has no direct fs/path requires");
  }

  // 13b. resolving an absolute path performs no fs access (missing absolute
  // path still resolves; a real temp file outside the vault is never read)
  {
    const dir = await makeTempDir("writing-source-no-fs-");
    const outsideFile = nodePath.join(dir, "secret.md");
    await fs.writeFile(outsideFile, "secret");
    const app = makeVaultApp({});
    const rootInfo = await source.resolveContextRoot(app, { writingContextFolder: dir }, { isDesktop: true });
    assert.strictEqual(rootInfo.kind, "vault");
    assert.strictEqual(rootInfo.root, VAULT_DEFAULT);
    await assert.rejects(
      source.readContextFile(rootInfo, app, outsideFile),
      (err) => err && err.code === "outside-context-root",
      "absolute id under a vault root must be rejected without fs"
    );
    console.log("PASS absolute paths resolve without fs access");
  }

  // 14. vault adapter stat throwing yields not-found
  {
    const throwingApp = { vault: { adapter: { async stat() { throw new Error("boom"); } } } };
    const rootInfo = await source.resolveContextRoot(throwingApp, { writingContextFolder: "Writing Context" }, { isDesktop: true });
    await assert.rejects(
      source.readContextFile(rootInfo, throwingApp, "Writing Context/a.md"),
      (err) => err && err.code === "not-found",
      "vault stat throw must yield not-found"
    );
    console.log("PASS vault adapter stat throw yields not-found");
  }

  process.stdout.write(JSON.stringify({ passed: 15, failed: 0 }) + "\n");
})().catch((err) => {
  console.error("FAIL writing-source-test:", err && err.message ? err.message : err);
  process.exit(1);
}).finally(async () => {
  for (const dir of tmpRoots) {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  }
});
