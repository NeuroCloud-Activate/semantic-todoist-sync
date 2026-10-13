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

  // 8. vault traversal outside the context root is rejected
  {
    const app = makeVaultApp({
      "Writing Context/a.md": { size: 5, mtime: 1700000006000, content: "ok" },
    });
    const rootInfo = await source.resolveContextRoot(app, {}, { isDesktop: true });
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

  // 9. external absolute path outside the root is rejected
  {
    const dir = await makeTempDir("writing-source-ext-guard-");
    await fs.writeFile(nodePath.join(dir, "a.md"), "ok");
    const outside = nodePath.join(nodePath.dirname(dir), `writing-source-outside-${Date.now()}.md`);
    await fs.writeFile(outside, "evil");
    try {
      const rootInfo = { kind: "external", root: dir };
      await assert.rejects(
        source.readContextFile(rootInfo, makeVaultApp({}), outside),
        (err) => err && err.code === "outside-context-root",
        "external path outside root must be rejected"
      );
      const target = nodePath.join(dir, "a.md");
      const content = bufToString(await source.readContextFile(rootInfo, makeVaultApp({}), target));
      assert.strictEqual(content, "ok");
    } finally {
      try { await fs.rm(outside, { force: true }); } catch { /* cleanup best-effort */ }
    }
    console.log("PASS external path outside context root is rejected");
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
    assert.strictEqual(blank.root, "Writing Context");
    console.log("PASS vault folder setting is normalised");
  }

  // 11. dot folders/files are skipped in vault and external recursion
  {
    const app = makeVaultApp({
      "Writing Context/a.md": { size: 2, mtime: 1700000009000, content: "ok" },
      "Writing Context/.obsidian/x.md": { size: 2, mtime: 1700000010000, content: "hidden" },
      "Writing Context/.git/y.txt": { size: 2, mtime: 1700000011000, content: "hidden" },
      "Writing Context/.hidden.md": { size: 2, mtime: 1700000012000, content: "hidden" },
    });
    const rootInfo = await source.resolveContextRoot(app, {}, { isDesktop: true });
    assert.deepStrictEqual(
      (await source.listContextFiles(rootInfo, app)).map((f) => f.id),
      ["Writing Context/a.md"]
    );
    const dir = await makeTempDir("writing-source-ext-dot-");
    await fs.writeFile(nodePath.join(dir, "a.md"), "ok");
    await fs.mkdir(nodePath.join(dir, ".obsidian"), { recursive: true });
    await fs.writeFile(nodePath.join(dir, ".obsidian", "x.md"), "hidden");
    await fs.mkdir(nodePath.join(dir, ".git"), { recursive: true });
    await fs.writeFile(nodePath.join(dir, ".git", "y.txt"), "hidden");
    await fs.writeFile(nodePath.join(dir, ".hidden.md"), "hidden");
    assert.deepStrictEqual(
      (await source.listContextFiles({ kind: "external", root: dir }, makeVaultApp({}))).map((f) => f.name),
      ["a.md"]
    );
    console.log("PASS dot folders/files are skipped");
  }

  // 12. missing files report code not-found
  {
    const dir = await makeTempDir("writing-source-ext-missing-");
    await assert.rejects(
      source.readContextFile({ kind: "external", root: dir }, makeVaultApp({}), nodePath.join(dir, "missing.md")),
      (err) => err && err.code === "not-found",
      "external missing file must report not-found"
    );
    await assert.rejects(
      source.readContextFile({ kind: "external", root: dir }, makeVaultApp({}), dir),
      (err) => err && err.code === "not-found",
      "external directory id must report not-found"
    );
    const app = makeVaultApp({});
    const rootInfo = await source.resolveContextRoot(app, {}, { isDesktop: true });
    await assert.rejects(
      source.readContextFile(rootInfo, app, "Writing Context/missing.md"),
      (err) => err && err.code === "not-found",
      "vault missing file must report not-found"
    );
    console.log("PASS missing files report not-found");
  }

  // 13. symlink inside the external root pointing outside is rejected
  {
    const dir = await makeTempDir("writing-source-ext-link-");
    const outsideDir = await makeTempDir("writing-source-ext-link-outside-");
    const target = nodePath.join(outsideDir, "secret.md");
    await fs.writeFile(target, "secret");
    const link = nodePath.join(dir, "link.md");
    let linked = false;
    try {
      await fs.symlink(target, link, "file");
      linked = true;
    } catch (err) {
      if (err && (err.code === "EPERM" || err.code === "EACCES")) {
        console.log("SKIP symlink (EPERM)");
      } else {
        throw err;
      }
    }
    if (linked) {
      await assert.rejects(
        source.readContextFile({ kind: "external", root: dir }, makeVaultApp({}), link),
        (err) => err && err.code === "outside-context-root",
        "symlink escaping the root must be rejected"
      );
      console.log("PASS symlink inside external root pointing outside is rejected");
    }
  }

  // 14. vault adapter stat throwing yields not-found
  {
    const throwingApp = { vault: { adapter: { async stat() { throw new Error("boom"); } } } };
    const rootInfo = await source.resolveContextRoot(throwingApp, {}, { isDesktop: true });
    await assert.rejects(
      source.readContextFile(rootInfo, throwingApp, "Writing Context/a.md"),
      (err) => err && err.code === "not-found",
      "vault stat throw must yield not-found"
    );
    console.log("PASS vault adapter stat throw yields not-found");
  }

  process.stdout.write(JSON.stringify({ passed: 14, failed: 0 }) + "\n");
})().catch((err) => {
  console.error("FAIL writing-source-test:", err && err.message ? err.message : err);
  process.exit(1);
}).finally(async () => {
  for (const dir of tmpRoots) {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  }
});
