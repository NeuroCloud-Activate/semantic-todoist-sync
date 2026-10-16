"use strict";

/**
 * Context folder source (Task 3).
 *
 * Final signatures (all async):
 * - async resolveContextRoot(app, settings, platform) -> Promise<{ kind: "vault", root: string, notice?: string }>
 * - async listContextFiles(rootInfo, app) -> Promise<Array<{ id, name, size, mtime, skipped? }>>
 * - async readContextFile(rootInfo, app, id) -> Promise<ArrayBuffer>
 * - async ensureVaultContextFolder(app, folder) -> Promise<void>
 *
 * Vault-only: absolute configured folders resolve to the vault default with a
 * notice instead of touching the (Obsidian-flagged) Node filesystem APIs.
 */

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
  return {
    kind: "vault",
    root: DEFAULT_CONTEXT_FOLDER,
    notice: `Context folder "${configured}" is outside the vault and no longer supported; using vault folder "${DEFAULT_CONTEXT_FOLDER}" instead.`,
  };
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

async function listContextFiles(rootInfo, app) {
  const root = rootInfo && rootInfo.kind === "external" ? DEFAULT_CONTEXT_FOLDER : (rootInfo ? rootInfo.root : DEFAULT_CONTEXT_FOLDER);
  return listVaultFiles(app, root);
}

async function readContextFile(rootInfo, app, id) {
  const vaultRoot = normalizeVaultFolder(rootInfo && rootInfo.kind === "external" ? DEFAULT_CONTEXT_FOLDER : (rootInfo ? rootInfo.root : DEFAULT_CONTEXT_FOLDER));
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
