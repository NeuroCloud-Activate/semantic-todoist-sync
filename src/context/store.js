"use strict";

// Embedded context-folder store (Task 4): persists extracted + embedded chunks
// at `<pluginDir>/context-index.json` and serves top-k cosine search.
// CommonJS; never requires "obsidian". `adapter` is vault.adapter
// (`exists`/`read`/`write`); `path` is a vault-relative file path.

const { extractContextFile } = require("./extract.js");
const { baseNameOf, listContextFiles, readContextFile } = require("./source.js");

const STORE_VERSION = 1;
const MAX_CHUNK_CHARS = 1500;
const EMBED_BATCH_SIZE = 32;

// ponytail: brute-force cosine over one JSON file; shard if a folder exceeds ~5k chunks.
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Split a segment longer than MAX_CHUNK_CHARS on paragraph boundaries
// (blank lines), falling back to hard slices; every piece keeps the locator.
function splitSegment(text, locator) {
  const full = String(text);
  if (full.length <= MAX_CHUNK_CHARS) return [{ text: full, locator }];
  const out = [];
  let cur = "";
  const flush = () => {
    if (cur) {
      out.push({ text: cur, locator });
      cur = "";
    }
  };
  for (const para of full.split(/\n\s*\n/)) {
    if (!para) continue;
    if (para.length > MAX_CHUNK_CHARS) {
      flush();
      for (let i = 0; i < para.length; i += MAX_CHUNK_CHARS) {
        out.push({ text: para.slice(i, i + MAX_CHUNK_CHARS), locator });
      }
      continue;
    }
    const next = cur ? cur + "\n\n" + para : para;
    if (next.length > MAX_CHUNK_CHARS) {
      flush();
      cur = para;
    } else {
      cur = next;
    }
  }
  flush();
  return out.length ? out : [{ text: full, locator }];
}

class ContextStore {
  constructor({ adapter, path, embed, embeddingKey, extractDeps }) {
    this._adapter = adapter;
    this._path = path;
    this._embed = embed;
    this._embeddingKey = embeddingKey;
    this._extractDeps = extractDeps || {};
    this._files = {};
    this._chunks = [];
    this._dimensions = null;
  }

  async load() {
    let raw = null;
    try {
      if (await this._adapter.exists(this._path)) raw = await this._adapter.read(this._path);
    } catch {
      raw = null;
    }
    if (!raw) {
      this._files = {};
      this._chunks = [];
      this._dimensions = null;
      return;
    }
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
    // A version or embeddingKey mismatch rebuilds from scratch on next sync,
    // so vectors never mix dimensions/models.
    if (!data || data.version !== STORE_VERSION || data.embeddingKey !== this._embeddingKey
      || !data.files || typeof data.files !== "object" || !Array.isArray(data.chunks)) {
      this._files = {};
      this._chunks = [];
      this._dimensions = null;
      return;
    }
    // Every chunk vector must match the persisted dimensions (falling back to
    // the first chunk for stores written before dimensions existed); any drift
    // discards and rebuilds, same as a key change.
    const dims = (Number.isInteger(data.dimensions) && data.dimensions > 0)
      ? data.dimensions
      : (data.chunks.length
        ? (Array.isArray(data.chunks[0].vector) ? data.chunks[0].vector.length : -1)
        : null);
    if (dims === -1 || (dims != null && data.chunks.some((c) =>
      !Array.isArray(c.vector) || c.vector.length !== dims))) {
      this._files = {};
      this._chunks = [];
      this._dimensions = null;
      return;
    }
    this._files = data.files;
    this._chunks = data.chunks;
    this._dimensions = dims;
  }

  async save() {
    await this._adapter.write(this._path, JSON.stringify({
      version: STORE_VERSION,
      embeddingKey: this._embeddingKey,
      dimensions: this._dimensions,
      files: this._files,
      chunks: this._chunks,
    }));
  }

  async sync(rootInfo, app) {
    const listed = await listContextFiles(rootInfo, app);
    const skipped = [];
    const indexable = [];
    for (const entry of listed) {
      if (entry.skipped) skipped.push({ id: entry.id, reason: entry.skipped });
      else indexable.push(entry);
    }
    const indexableIds = new Set(indexable.map((e) => e.id));
    const prevFiles = this._files;
    const addedEntries = [];
    const changedEntries = [];
    for (const entry of indexable) {
      const prev = prevFiles[entry.id];
      if (!prev) addedEntries.push(entry);
      else if (prev.size !== entry.size || prev.mtime !== entry.mtime) changedEntries.push(entry);
    }
    const removedIds = Object.keys(prevFiles).filter((id) => !indexableIds.has(id));

    // Snapshot for rollback: state is only ever replaced wholesale below, so a
    // failure restores memory by reference and save() is never reached on the
    // embed path; the save path below restores explicitly.
    const snapshotFiles = prevFiles;
    const snapshotChunks = this._chunks;
    const snapshotDimensions = this._dimensions;

    const piecesByFile = new Map();
    const failedIds = new Set();
    for (const entry of [...addedEntries, ...changedEntries]) {
      let bytes = null;
      try {
        bytes = await readContextFile(rootInfo, app, entry.id);
      } catch (err) {
        skipped.push({ id: entry.id, reason: (err && err.code) || (err && err.message) || "read-failed" });
        failedIds.add(entry.id);
        continue;
      }
      let segments = null;
      try {
        segments = await extractContextFile(entry.name, bytes, this._extractDeps);
      } catch (err) {
        skipped.push({ id: entry.id, reason: (err && err.code) || (err && err.message) || "extract-failed" });
        failedIds.add(entry.id);
        continue;
      }
      const pieces = [];
      for (const seg of segments || []) {
        for (const part of splitSegment(seg.text, seg.locator)) pieces.push(part);
      }
      piecesByFile.set(entry.id, pieces);
    }

    const added = addedEntries.filter((e) => !failedIds.has(e.id));
    const changed = changedEntries.filter((e) => !failedIds.has(e.id));
    // Only files absent from the listing count as removed: a file whose
    // read/extract failed this sync keeps its previous entry and chunks
    // (reported in `skipped`) and is retried next sync.
    const removed = removedIds.length;

    if (added.length === 0 && changed.length === 0 && removed === 0) {
      return { added: 0, changed: 0, removed: 0, skipped };
    }

    const texts = [];
    for (const entry of [...added, ...changed]) {
      for (const piece of piecesByFile.get(entry.id) || []) texts.push(piece.text);
    }
    const vectors = [];
    let expectedDims = this._dimensions;
    try {
      for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
        const vecs = await this._embed(batch);
        if (!Array.isArray(vecs) || vecs.length !== batch.length) {
          const err = new Error("embedding count mismatch: expected " + batch.length
            + ", got " + (Array.isArray(vecs) ? vecs.length : typeof vecs));
          err.code = "embedding-count-mismatch";
          throw err;
        }
        for (const v of vecs) vectors.push(v);
      }
      // Every embedded vector must match the store dimensions (the first
      // batch sets them on an empty store); otherwise nothing is saved/changed.
      if (expectedDims == null && vectors.length) {
        expectedDims = (Array.isArray(vectors[0]) && vectors[0].length > 0) ? vectors[0].length : -1;
      }
      for (const v of vectors) {
        if (!Array.isArray(v) || v.length !== expectedDims) {
          const err = new Error("embedding dimension mismatch: expected " + expectedDims
            + ", got " + (Array.isArray(v) ? v.length : typeof v));
          err.code = "embedding-dimension-mismatch";
          throw err;
        }
      }
    } catch (err) {
      this._files = snapshotFiles;
      this._chunks = snapshotChunks;
      this._dimensions = snapshotDimensions;
      throw err;
    }

    const nextFiles = {};
    for (const id of Object.keys(prevFiles)) {
      // Failed files keep their previous entry (new failures stay absent:
      // they have no previous entry to keep).
      if (indexableIds.has(id) && prevFiles[id]) nextFiles[id] = prevFiles[id];
    }
    const freshChunks = [];
    let vi = 0;
    for (const entry of [...added, ...changed]) {
      nextFiles[entry.id] = { size: entry.size, mtime: entry.mtime, name: entry.name };
      const pieces = piecesByFile.get(entry.id) || [];
      pieces.forEach((piece, n) => {
        freshChunks.push({
          id: entry.id + "#" + n,
          file: entry.id,
          locator: piece.locator,
          text: piece.text,
          vector: vectors[vi++],
        });
      });
    }
    // Failed files have no fresh pieces, so their old chunks survive this
    // filter and stay searchable until a retry succeeds.
    const keptChunks = this._chunks.filter(
      (c) => indexableIds.has(c.file) && !piecesByFile.has(c.file));
    this._files = nextFiles;
    this._chunks = [...keptChunks, ...freshChunks];
    this._dimensions = expectedDims;
    try {
      await this.save();
    } catch (err) {
      this._files = snapshotFiles;
      this._chunks = snapshotChunks;
      this._dimensions = snapshotDimensions;
      throw err;
    }
    return { added: added.length, changed: changed.length, removed, skipped };
  }

  search(queryVector, k) {
    if (!Array.isArray(queryVector) || queryVector.length === 0) return [];
    if (!this._chunks.length) return [];
    // A query of a different length matches nothing (never truncate scores).
    const expected = this._dimensions != null ? this._dimensions
      : (Array.isArray(this._chunks[0].vector) ? this._chunks[0].vector.length : -1);
    if (queryVector.length !== expected) return [];
    const limit = Number.isInteger(k) && k > 0 ? k : 8;
    const scored = this._chunks.map((c) => ({
      id: c.id,
      file: c.file,
      name: (this._files[c.file] && this._files[c.file].name) || baseNameOf(c.file),
      locator: c.locator,
      text: c.text,
      score: cosine(queryVector, c.vector),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
}

module.exports = { ContextStore };
