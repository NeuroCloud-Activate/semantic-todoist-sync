"use strict";

// Task 3 (context folder source) — TDD test. Requires src/context/source.js.
const assert = require("assert");
const fs = require("fs/promises");
const os = require("os");
const nodePath = require("path");

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

(async () => {
  // 1. vault mode lists nested files, filters .exe, returns size/mtime
  {
    const app = makeVaultApp({
      "Writing Context/a.md": { size: 12, mtime: 1700000000000, content: "hello a" },
      "Writing Context/sub/b.pdf": { size: 34, mtime: 1700000001000, content: "pdf-bytes" },
      "Writing Context/sub/evil.exe": { size: 56, mtime: 1700000002000, content: "x" },
      "Writing Context/notes/UPPER.JPG": { size: 78, mtime: 1700000003000, content: "img" },
    });
    const rootInfo = await source.resolveContextRoot(app, {}, { isDesktop: true });
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

  // 2. external mode on desktop lists files from a real temp dir via fs
  {
    const dir = await makeTempDir("writing-source-ext-");
    await fs.writeFile(nodePath.join(dir, "a.md"), "ext hello");
    await fs.mkdir(nodePath.join(dir, "sub"), { recursive: true });
    await fs.writeFile(nodePath.join(dir, "sub", "b.csv"), "x,y\n1,2\n");
    await fs.writeFile(nodePath.join(dir, "sub", "evil.exe"), "nope");
    const app = makeVaultApp({});
    const rootInfo = await source.resolveContextRoot(
      app, { writingContextFolder: dir }, { isDesktop: true }
    );
    assert.strictEqual(rootInfo.kind, "external");
    assert.strictEqual(rootInfo.root, dir);
    const files = await source.listContextFiles(rootInfo, app);
    const names = files.map((f) => f.name).sort();
    assert.deepStrictEqual(names, ["a.md", "b.csv"]);
    for (const f of files) {
      assert.ok(nodePath.isAbsolute(f.id), `id must be absolute: ${f.id}`);
      assert.strictEqual(typeof f.size, "number");
      assert.strictEqual(typeof f.mtime, "number");
    }
    const target = files.find((f) => f.name === "a.md");
    const content = bufToString(await source.readContextFile(rootInfo, app, target.id));
    assert.strictEqual(content, "ext hello");
    console.log("PASS external mode on desktop lists files from a real temp dir");
  }

  // 3. absolute path with isDesktop:false -> kind vault, notice mentions mobile
  {
    const app = makeVaultApp({});
    const abs = nodePath.join(os.tmpdir(), "writing-source-mobile-absent");
    const rootInfo = await source.resolveContextRoot(
      app, { writingContextFolder: abs }, { isDesktop: false }
    );
    assert.strictEqual(rootInfo.kind, "vault");
    assert.strictEqual(rootInfo.root, "Writing Context");
    assert.ok(rootInfo.notice && /mobile/i.test(rootInfo.notice), "notice must mention mobile");
    console.log("PASS absolute path on mobile falls back to vault with mobile notice");
  }

  // 4. missing external dir -> kind vault + notice
  {
    const app = makeVaultApp({});
    const missing = nodePath.join(os.tmpdir(), `writing-source-gone-${Date.now()}`);
    const rootInfo = await source.resolveContextRoot(
      app, { writingContextFolder: missing }, { isDesktop: true }
    );
    assert.strictEqual(rootInfo.kind, "vault");
    assert.strictEqual(rootInfo.root, "Writing Context");
    assert.ok(rootInfo.notice && rootInfo.notice.length > 0, "missing dir must produce a notice");
    console.log("PASS missing external dir falls back to vault with notice");
  }

  // 5. files > 20MB are returned with skipped too-large and are not readable
  {
    const big = 20 * 1024 * 1024 + 1;
    const app = makeVaultApp({
      "Writing Context/big.pdf": { size: big, mtime: 1700000004000, content: "too big" },
      "Writing Context/small.md": { size: 5, mtime: 1700000005000, content: "ok" },
    });
    const rootInfo = await source.resolveContextRoot(app, {}, { isDesktop: true });
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
  }

  // 7. CONTEXT_EXTENSIONS covers the spec formats
  {
    assert.ok(Array.isArray(source.CONTEXT_EXTENSIONS));
    for (const ext of ["md", "txt", "docx", "xlsx", "csv", "pdf", "png", "jpg", "jpeg"]) {
      assert.ok(source.CONTEXT_EXTENSIONS.includes(ext), `missing extension: ${ext}`);
    }
    console.log("PASS CONTEXT_EXTENSIONS covers md/txt/docx/xlsx/csv/pdf/images");
  }

  process.stdout.write(JSON.stringify({ passed: 7, failed: 0 }) + "\n");
})().catch((err) => {
  console.error("FAIL writing-source-test:", err && err.message ? err.message : err);
  process.exit(1);
}).finally(async () => {
  for (const dir of tmpRoots) {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  }
});
