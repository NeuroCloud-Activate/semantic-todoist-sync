"use strict";

/**
 * Context folder source (Task 3).
 *
 * Final signatures (all async — every function may touch I/O; resolveContextRoot
 * is async because it stats the external dir to detect a missing path):
 * - async resolveContextRoot(app, settings, platform) -> Promise<{ kind: "vault" | "external", root: string, notice?: string }>
 * - async listContextFiles(rootInfo, app) -> Promise<Array<{ id, name, size, mtime, skipped? }>>
 * - async readContextFile(rootInfo, app, id) -> Promise<ArrayBuffer>
 * - async ensureVaultContextFolder(app, folder) -> Promise<void>
 *
 * `platform` is Obsidian's Platform ({ isDesktop }); `app` is the Obsidian app.
 * Node builtins (fs/promises, path) are required lazily inside the external
 * branches only, so mobile (no Node) never loads them.
 */

// Defined locally to avoid a cross-task dependency on Task 2's
// src/context/extract.js; the controller dedupes at integration.
const CONTEXT_EXTENSIONS = ["md", "txt", "docx", "xlsx", "csv", "pdf", "png", "jpg", "jpeg"];

const DEFAULT_CONTEXT_FOLDER = "Semantic Todoist Sync/Context";
const MAX_CONTEXT_FILE_BYTES = 20 * 1024 * 1024;

function isAbsoluteContextPath(p) {
  return typeof p === "string" && /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(p);
}

function extensionOf(name) {
  const base = String(name).split(/[\\/]/).pop();
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

function baseNameOf(p) {
  return String(p).split(/[\\/]/).pop();
}

function normalizeVaultFolder(folder) {
  const slashed = typeof folder === "string" ? folder.replace(/\\/g, "/").trim() : "";
  const collapsed = slashed.replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "").trim();
  return collapsed || DEFAULT_CONTEXT_FOLDER;
}

function normalizeVaultId(id) {
  return String(id).replace(/\\/g, "/").replace(/\/+/g, "/");
}

function outsideRootError(id) {
  const err = new Error(`context file outside context root: ${id}`);
  err.code = "outside-context-root";
  return err;
}

function notFoundError(id) {
  const err = new Error(`context file not found: ${id}`);
  err.code = "not-found";
  return err;
}

function toMtimeMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function withSkipped(entry) {
  if (entry.size > MAX_CONTEXT_FILE_BYTES) entry.skipped = "too-large";
  return entry;
}

async function resolveContextRoot(app, settings, platform) {
  const configured =
    settings && typeof settings.writingContextFolder === "string" && settings.writingContextFolder.trim()
      ? settings.writingContextFolder.trim()
      : DEFAULT_CONTEXT_FOLDER;
  if (!isAbsoluteContextPath(configured)) {
    return { kind: "vault", root: normalizeVaultFolder(configured) };
  }
  if (!platform || !platform.isDesktop) {
    return {
      kind: "vault",
      root: DEFAULT_CONTEXT_FOLDER,
      notice: `External context folder "${configured}" is not available on mobile; using vault folder "${DEFAULT_CONTEXT_FOLDER}" instead.`,
    };
  }
  // Desktop only from here: lazy Node requires so mobile never loads them.
  const fsp = require("fs/promises");
  try {
    const st = await fsp.stat(configured);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch (err) {
    return {
      kind: "vault",
      root: DEFAULT_CONTEXT_FOLDER,
      notice: `External context folder "${configured}" was not found; using vault folder "${DEFAULT_CONTEXT_FOLDER}" instead.`,
    };
  }
  return { kind: "external", root: configured };
}

async function listVaultFiles(app, root) {
  root = normalizeVaultFolder(root);
  const out = [];
  const adapter = app.vault.adapter;
  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const dir = queue.pop();
    if (seen.has(dir)) continue;
    seen.add(dir);
    let listed;
    try {
      listed = await adapter.list(dir);
    } catch (err) {
      continue;
    }
    const files = (listed && listed.files) || [];
    const folders = (listed && listed.folders) || [];
    for (const folder of folders) {
      if (baseNameOf(folder).startsWith(".")) continue;
      queue.push(folder);
    }
    for (const file of files) {
      if (baseNameOf(file).startsWith(".")) continue;
      if (!CONTEXT_EXTENSIONS.includes(extensionOf(file))) continue;
      let st = null;
      try {
        st = await adapter.stat(file);
      } catch (err) {
        st = null;
      }
      if (!st) continue;
      out.push(withSkipped({
        id: file,
        name: baseNameOf(file),
        size: st.size,
        mtime: toMtimeMs(st.mtime),
      }));
    }
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

async function listExternalFiles(root) {
  // Desktop only: lazy Node requires so mobile never loads them.
  const fsp = require("fs/promises");
  const path = require("path");
  const out = [];
  const queue = [root];
  while (queue.length) {
    const dir = queue.pop();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      // Dirent.isDirectory() is false for symlinks, so listing never follows them
      // (readContextFile still resolves realpath below, since stat/readFile follow links).
      if (entry.isDirectory()) {
        queue.push(full);
      } else if (entry.isFile()) {
        if (!CONTEXT_EXTENSIONS.includes(extensionOf(entry.name))) continue;
        let st;
        try {
          st = await fsp.stat(full);
        } catch (err) {
          continue;
        }
        out.push(withSkipped({
          id: full,
          name: entry.name,
          size: st.size,
          mtime: toMtimeMs(st.mtimeMs),
        }));
      }
    }
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

async function listContextFiles(rootInfo, app) {
  if (rootInfo && rootInfo.kind === "external") return listExternalFiles(rootInfo.root);
  return listVaultFiles(app, rootInfo ? rootInfo.root : DEFAULT_CONTEXT_FOLDER);
}

async function readContextFile(rootInfo, app, id) {
  if (rootInfo && rootInfo.kind === "external") {
    // Desktop only: lazy Node requires so mobile never loads them.
    const fsp = require("fs/promises");
    const path = require("path");
    const resolvedRoot = path.resolve(rootInfo.root);
    const resolved = path.resolve(id);
    const rel = path.relative(resolvedRoot, resolved);
    if (rel.split(/[\\/]/)[0] === ".." || path.isAbsolute(rel)) throw outsideRootError(id);
    // stat/readFile follow symlinks, so re-check containment on real paths
    // (covers a link inside the root pointing outside, or a symlinked parent dir).
    let realResolved;
    try {
      const realRoot = await fsp.realpath(resolvedRoot);
      realResolved = await fsp.realpath(resolved);
      const realRel = path.relative(realRoot, realResolved);
      if (realRel.split(/[\\/]/)[0] === ".." || path.isAbsolute(realRel)) throw outsideRootError(id);
    } catch (err) {
      if (err && err.code === "outside-context-root") throw err;
      if (err && err.code === "ENOENT") throw notFoundError(id);
      throw err;
    }
    let st;
    try {
      st = await fsp.stat(realResolved);
    } catch (err) {
      if (err && err.code === "ENOENT") throw notFoundError(id);
      throw err;
    }
    if (st.isDirectory()) throw notFoundError(id);
    if (st.size > MAX_CONTEXT_FILE_BYTES) {
      throw new Error(`context file too-large: ${id}`);
    }
    let buf;
    try {
      buf = await fsp.readFile(realResolved);
    } catch (err) {
      if (err && err.code === "ENOENT") throw notFoundError(id);
      throw err;
    }
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const vaultRoot = normalizeVaultFolder(rootInfo ? rootInfo.root : DEFAULT_CONTEXT_FOLDER);
  const normId = normalizeVaultId(id);
  if (!normId.startsWith(`${vaultRoot}/`) || normId.split("/").includes("..")) {
    throw outsideRootError(id);
  }
  let st;
  try {
    st = await app.vault.adapter.stat(id);
  } catch (err) {
    throw notFoundError(id);
  }
  if (!st || st.type === "folder") throw notFoundError(id);
  if (st.size > MAX_CONTEXT_FILE_BYTES) {
    throw new Error(`context file too-large: ${id}`);
  }
  return app.vault.adapter.readBinary(id);
}

async function ensureVaultContextFolder(app, folder) {
  const target = normalizeVaultFolder(folder);
  const adapter = app.vault.adapter;
  let current = "";
  for (const part of target.split("/").filter(Boolean)) {
    current = current ? current + "/" + part : part;
    if (!(await adapter.exists(current))) await adapter.mkdir(current);
  }
}

module.exports = {
  CONTEXT_EXTENSIONS,
  DEFAULT_CONTEXT_FOLDER,
  MAX_CONTEXT_FILE_BYTES,
  baseNameOf,
  isAbsoluteContextPath,
  resolveContextRoot,
  listContextFiles,
  readContextFile,
  ensureVaultContextFolder,
};
