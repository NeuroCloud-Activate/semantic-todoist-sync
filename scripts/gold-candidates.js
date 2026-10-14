"use strict";
// scripts/gold-candidates.js — Task 0 Step 1: mine gold-label CANDIDATES (read-only on vault).
// Runtime: node scripts/gold-candidates.js --vault <path> [--out <dir>] [--limit <n>]
// Writes <out>/gold-candidates.json + <out>/gold-candidates-meta.json. No deps, no network.
// Vault is read-only: the only writes are outDir creation + the 2 JSON files.

const fs = require("fs");
const path = require("path");

const SEED = 20261009;
const SAMPLE_TARGET = 120;
const SERIES_WINDOW = 5;
const ENTITY_CAP = 10;
const JACCARD_MIN = 0.4;
const HARD_NEG_TOP = 3;
const MAX_SERIES_PAIRS = 5000; // safety cap; reported if hit

const ACTION_HEADINGS = new Set(["tasks", "action items", "actions", "next steps", "follow up", "follow-ups", "followups"]);
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

function fail(msg) {
  process.stderr.write("gold-candidates: " + msg + "\n");
  process.exit(1);
}

function parseArgs(argv) {
  const out = { vault: "", out: "", limit: 0 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault") out.vault = argv[++i] || "";
    else if (a === "--out") out.out = argv[++i] || "";
    else if (a === "--limit") out.limit = parseInt(argv[++i] || "0", 10) || 0;
    else fail("unknown arg: " + a);
  }
  if (!out.vault) fail("missing --vault <path>");
  return out;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

const toRel = (vaultRoot, abs) => path.relative(vaultRoot, abs).split(path.sep).join("/");
const norm = (s) => s.toLowerCase();
const basenameNoExt = (p) => {
  const b = p.split("/").pop();
  return b.toLowerCase().endsWith(".md") ? b.slice(0, -3) : b;
};

function listMarkdownFiles(vaultRoot) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === ".obsidian") continue;
        walk(abs);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        found.push(abs);
      }
    }
  };
  walk(vaultRoot);
  return found;
}

function parseAliases(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return [];
  const fm = m[1];
  const out = [];
  const one = fm.match(/^[ \t]*aliases:[ \t]*(\[.*?\])/m);
  if (one) {
    for (const q of one[1].match(/["']([^"']+)["']/g) || []) out.push(q.slice(1, -1));
  } else {
    const multi = fm.match(/^[ \t]*aliases:[ \t]*\r?\n((?:[ \t]*-[^\n]*\r?\n?)+)/m);
    if (multi) {
      for (const line of multi[1].split(/\r?\n/)) {
        const t = line.match(/^[ \t]*-[ \t]*(.+?)[ \t]*$/);
        if (t) out.push(t[1].replace(/^["']|["']$/g, ""));
      }
    }
  }
  return out;
}

function extractWikilinkTargets(text) {
  const targets = [];
  const re = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const t = m[1].trim();
    if (t) targets.push(t);
  }
  return targets;
}

function resolveWikilink(target, byBase, byFull) {
  let t = target.replace(/\.md$/i, "").replace(/\\/g, "/").trim();
  if (!t) return null;
  const tl = norm(t);
  if (byFull.has(tl)) return byFull.get(tl);
  for (const [full, rel] of byFull) {
    if (full === tl || full.endsWith("/" + tl)) return rel;
  }
  const base = norm(t.split("/").pop());
  if (byBase.has(base)) return byBase.get(base);
  return null;
}

function tokenize(s) {
  return (s.match(/[a-z0-9']{3,}/gi) || []).map((t) => t.toLowerCase());
}

function jaccard(aText, bText) {
  const a = new Set(tokenize(aText));
  const b = new Set(tokenize(bText));
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function extractDate(s) {
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(new RegExp("(" + MONTHS + ")\\s+(\\d{1,2}),?\\s+(\\d{4})", "i"));
  if (m) { const d = new Date(m[1] + " " + m[2] + ", " + m[3] + " UTC"); if (!isNaN(d)) return d; }
  m = s.match(new RegExp("(\\d{1,2})\\s+(" + MONTHS + ")\\s+(\\d{4})", "i"));
  if (m) { const d = new Date(m[2] + " " + m[1] + ", " + m[3] + " UTC"); if (!isNaN(d)) return d; }
  return null;
}

function isActionHeading(line) {
  const m = line.match(/^#{1,3}\s+(.+?)\s*$/);
  if (!m) return false;
  // Headings carry emoji/separator prefixes in this vault (e.g. "💠- Action items").
  const t = m[1].replace(/^[^A-Za-z0-9]+/, "").replace(/[:\-–—\s]+$/g, "").trim();
  return ACTION_HEADINGS.has(norm(t));
}

function isAnyHeading(line) {
  return /^#{1,6}\s+/.test(line);
}

// Action lines: {text, line} — open checkbox or line under an action heading.
function extractActionLines(lines) {
  const out = [];
  let inAction = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isAnyHeading(line)) { inAction = isActionHeading(line); continue; }
    const cb = line.match(/^\s*[-*+]\s+\[ \]\s?([\s\S]*)$/);
    if (cb) { out.push({ text: cb[1], line: i + 1 }); continue; }
    if (inAction && line.trim() !== "") out.push({ text: line, line: i + 1 });
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const vaultRoot = path.resolve(args.vault);
  let st;
  try { st = fs.statSync(vaultRoot); }
  catch (e) { fail("vault not found: " + args.vault); }
  if (!st.isDirectory()) fail("vault is not a directory: " + args.vault);

  const pluginDir = path.join(vaultRoot, ".obsidian", "plugins", "semantic-todoist-sync");
  const outDir = args.out ? path.resolve(args.out)
    : path.join(pluginDir, "eval-private");

  // --- Snapshot (todoist queries + dedup pairs). Missing index -> exit 1.
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "task-reference-manifest.json"), "utf8"));
  } catch (e) { fail("task-reference manifest missing/unreadable: " + e.message); }
  if (!manifest.snapshotFile) fail("task-reference manifest has no snapshotFile");
  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(path.join(pluginDir, manifest.snapshotFile), "utf8"));
  } catch (e) { fail("task-reference snapshot missing/unreadable: " + e.message); }
  const cache = snap.taskCache || {};
  const cacheEntries = Object.entries(cache).map(([id, t]) => ({ id, t }));
  const openTasks = cacheEntries.filter((e) => !e.t.isCompleted);

  // --- Walk notes (read-only).
  const files = listMarkdownFiles(vaultRoot);
  if (!files.length) fail("no markdown notes found in vault: " + vaultRoot);
  const notes = files.map((abs) => {
    const rel = toRel(vaultRoot, abs);
    const content = fs.readFileSync(abs, "utf8");
    const lines = content.split(/\r?\n/);
    const mtime = fs.statSync(abs).mtime;
    return { abs, rel, content, lines, mtime, aliases: parseAliases(content) };
  });
  const byRel = new Map(notes.map((n) => [norm(n.rel), n.rel]));
  const byFull = new Map(notes.map((n) => [norm(n.rel.replace(/\.md$/i, "")), n.rel]));
  const byBase = new Map();
  for (const n of notes) {
    const b = norm(basenameNoExt(n.rel));
    if (!byBase.has(b)) byBase.set(b, n.rel);
  }
  // Reverse-link index: target basename-lower -> set of source rels.
  const linkedBy = new Map();
  const noteTargets = new Map();
  for (const n of notes) {
    const set = new Set();
    for (const t of extractWikilinkTargets(n.content)) {
      const key = norm(t.split("/").pop().replace(/\.md$/i, "").trim());
      if (!key) continue;
      set.add(key);
      if (!linkedBy.has(key)) linkedBy.set(key, new Set());
      linkedBy.get(key).add(n.rel);
    }
    noteTargets.set(n.rel, set);
  }

  // --- 1. Query pool.
  const queryPool = [];
  const seenLoc = new Set();
  const pushQuery = (text, sourcePath, sourceLine, kind) => {
    const k = sourcePath + "\n" + sourceLine;
    if (seenLoc.has(k)) return;
    seenLoc.add(k);
    queryPool.push({ id: "q" + (queryPool.length + 1), text, sourcePath, sourceLine, kind });
  };
  for (const n of notes) {
    let inAction = false;
    for (let i = 0; i < n.lines.length; i++) {
      const line = n.lines[i];
      if (isAnyHeading(line)) { inAction = isActionHeading(line); continue; }
      const open = line.match(/^\s*[-*+]\s+\[ \]\s?([\s\S]*)$/);
      if (open) { pushQuery(open[1], n.rel, i + 1, "checkbox"); continue; }
      if (/#todo\b/.test(line)) { pushQuery(line, n.rel, i + 1, "tagged"); continue; }
      if (inAction && line.trim() !== "") pushQuery(line, n.rel, i + 1, "action-heading");
    }
  }
  for (const { t } of openTasks) {
    queryPool.push({
      id: "q" + (queryPool.length + 1),
      text: t.content,
      sourcePath: (t.path || "").split(path.sep).join("/"),
      sourceLine: t.lineNumber,
      kind: "todoist",
      oid: t.oid, projectId: t.projectId, projectName: t.projectName,
      parentId: t.parentId, parentOid: t.parentOid, isSubtask: !!t.isSubtask,
      due_date: t.due_date || null, labels: t.labels || [],
    });
  }

  // --- 2. Stratified sample (mulberry32, seed 20261009).
  const rng = mulberry32(SEED);
  const mtimeByRel = new Map(notes.map((n) => [n.rel, n.mtime]));
  const groupOf = (q) => {
    const seg = q.sourcePath.split("/");
    const top = seg.length > 1 ? seg[0] : "(root)";
    let year = "unknown";
    const mt = mtimeByRel.get(q.sourcePath);
    if (mt) year = String(mt.getFullYear());
    else {
      const d = extractDate(q.sourcePath);
      if (d) year = String(d.getUTCFullYear());
    }
    return top + "|" + year;
  };
  const groups = new Map();
  for (const q of queryPool) {
    const g = groupOf(q);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(q);
  }
  const target = Math.min(SAMPLE_TARGET, queryPool.length);
  const keys = Array.from(groups.keys()).sort();
  const quotas = new Map();
  let assigned = 0;
  for (const k of keys) {
    const b = Math.min(3, groups.get(k).length);
    quotas.set(k, b);
    assigned += b;
  }
  let remaining = target - assigned;
  if (remaining > 0) {
    const total = queryPool.length;
    const frac = keys.map((k) => ({ k, want: remaining * (groups.get(k).length / total) }));
    const floors = frac.map((f) => Math.floor(f.want));
    let used = floors.reduce((a, b) => a + b, 0);
    const rem = frac.map((f, i) => ({ k: f.k, r: f.want - floors[i] })).sort((a, b) => b.r - a.r);
    let li = 0;
    while (used < remaining) {
      const k = (rem.length ? rem[li % rem.length].k : keys[li % keys.length]);
      const room = groups.get(k).length - quotas.get(k);
      if (room > 0) { quotas.set(k, quotas.get(k) + 1); used++; }
      li++;
      if (li > keys.length * 4 + remaining + 10) break; // all groups full
    }
    frac.forEach((f, i) => {
      const room = groups.get(f.k).length - quotas.get(f.k);
      quotas.set(f.k, quotas.get(f.k) + Math.min(floors[i], room));
    });
  }
  let sample = [];
  const picked = new Set();
  for (const k of keys) {
    for (const q of shuffled(groups.get(k), rng).slice(0, quotas.get(k))) {
      sample.push(q); picked.add(q.id);
    }
  }
  if (sample.length < target) {
    for (const q of shuffled(queryPool.filter((q) => !picked.has(q.id)), rng)) {
      if (sample.length >= target) break;
      sample.push(q);
    }
  }
  sample = sample.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  if (args.limit > 0) sample = sample.slice(0, Math.min(args.limit, sample.length));
  const sampledIds = new Set(sample.map((q) => q.id));

  // --- 3. Retrieval candidates per sampled query.
  const retrievalCandidates = [];
  const countsReason = { wikilink: 0, series: 0, entity: 0 };
  const searchBlobs = notes.map((n) => ({ rel: n.rel, blob: norm(n.rel + "\n" + n.aliases.join("\n")) }));
  const notesByDir = new Map();
  for (const n of notes) {
    const dir = n.rel.includes("/") ? n.rel.slice(0, n.rel.lastIndexOf("/")) : "(root)";
    if (!notesByDir.has(dir)) notesByDir.set(dir, []);
    notesByDir.get(dir).push(n);
  }
  for (const q of sample) {
    const cands = new Map(); // rel -> reason (first wins: wikilink > series > entity)
    const setCand = (rel, reason) => {
      if (!rel || rel === q.sourcePath || cands.has(rel)) return;
      cands.set(rel, reason);
    };
    const src = byRel.has(norm(q.sourcePath))
      ? notes.find((n) => n.rel === byRel.get(norm(q.sourcePath)))
      : null;
    // (a) wikilinks both directions.
    if (src) {
      for (const t of noteTargets.get(src.rel) || []) {
        const hit = resolveWikilink(t, byBase, byFull);
        setCand(hit, "wikilink");
      }
      const back = linkedBy.get(norm(basenameNoExt(src.rel))) || new Set();
      for (const rel of Array.from(back).sort()) setCand(rel, "wikilink");
    } else {
      // todoist query whose note may still resolve for reverse links
      const back = linkedBy.get(norm(basenameNoExt(q.sourcePath))) || new Set();
      for (const rel of Array.from(back).sort()) setCand(rel, "wikilink");
    }
    // (b) series: up to 5 earlier notes in same folder by mtime desc.
    const dir = q.sourcePath.includes("/") ? q.sourcePath.slice(0, q.sourcePath.lastIndexOf("/")) : "(root)";
    const srcMt = mtimeByRel.get(q.sourcePath);
    const sibs = (notesByDir.get(dir) || [])
      .filter((n) => n.rel !== q.sourcePath && (srcMt ? n.mtime.getTime() < srcMt.getTime() : true))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, SERIES_WINDOW);
    for (const n of sibs) setCand(n.rel, "series");
    // (c) shared-entity: capitalized tokens vs filename/aliases.
    const toks = Array.from(new Set((q.text.match(/[A-Z][a-zA-Z]+/g) || []).filter((t) => t.length >= 2)));
    let entityAdded = 0;
    for (const tok of toks) {
      if (entityAdded >= ENTITY_CAP) break;
      const tl = norm(tok);
      for (const s of searchBlobs) {
        if (entityAdded >= ENTITY_CAP) break;
        if (s.rel === q.sourcePath || cands.has(s.rel)) continue;
        if (s.blob.includes(tl)) { setCand(s.rel, "entity"); entityAdded++; }
      }
    }
    const list = Array.from(cands.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([p, reason]) => ({ path: p, reason }));
    for (const c of list) countsReason[c.reason]++;
    retrievalCandidates.push({ queryId: q.id, candidates: list });
  }

  // --- 4. Dedup candidates.
  const dedupCandidates = [];
  const countsPair = { "series-carryover": 0, "multi-note": 0, "parent-restatement": 0, "hard-negative-candidate": 0 };
  const pushPair = (a, b, kind) => {
    dedupCandidates.push({ a, b, kind });
    countsPair[kind]++;
  };
  // (a) consecutive dated-note pairs per folder, Jaccard >= 0.4.
  let seriesTruncated = false;
  const datedByDir = new Map();
  for (const n of notes) {
    let d = extractDate(n.rel);
    if (!d) {
      const head = n.content.slice(0, 2000);
      d = extractDate(head);
    }
    if (!d) continue;
    const dir = n.rel.includes("/") ? n.rel.slice(0, n.rel.lastIndexOf("/")) : "(root)";
    if (!datedByDir.has(dir)) datedByDir.set(dir, []);
    datedByDir.get(dir).push({ n, d });
  }
  for (const arr of datedByDir.values()) {
    arr.sort((x, y) => x.d - y.d);
    for (let i = 0; i + 1 < arr.length; i++) {
      const A = extractActionLines(arr[i].n.lines);
      const B = extractActionLines(arr[i + 1].n.lines);
      for (const a of A) {
        for (const b of B) {
          if (dedupCandidates.length >= MAX_SERIES_PAIRS &&
              countsPair["series-carryover"] >= MAX_SERIES_PAIRS) { seriesTruncated = true; break; }
          if (jaccard(a.text, b.text) >= JACCARD_MIN) {
            pushPair(
              { text: a.text, path: arr[i].n.rel, line: a.line },
              { text: b.text, path: arr[i + 1].n.rel, line: b.line },
              "series-carryover"
            );
          }
        }
        if (seriesTruncated) break;
      }
      if (seriesTruncated) break;
    }
    if (seriesTruncated) break;
  }
  // (b) snapshot tasks with >= 2 distinct noteRef paths.
  for (const { t } of cacheEntries) {
    const refs = t.noteRefs || [];
    const distinct = [];
    const seenP = new Set();
    for (const r of refs) {
      const key = (r.path || "") + "\n" + (r.lineNumber ?? "");
      if (!seenP.has(key)) { seenP.add(key); distinct.push(r); }
    }
    const paths = new Set(distinct.map((r) => r.path));
    if (paths.size >= 2) {
      for (let i = 1; i < distinct.length; i++) {
        pushPair(
          { text: distinct[0].content || t.content, path: distinct[0].path, line: distinct[0].lineNumber },
          { text: distinct[i].content || t.content, path: distinct[i].path, line: distinct[i].lineNumber },
          "multi-note"
        );
      }
    }
  }
  // (c) parent/subtask pairs.
  const byKey = new Map(cacheEntries.map(({ id, t }) => [id, t]));
  const byOid = new Map(cacheEntries.map(({ t }) => [t.oid, t]));
  for (const { t } of cacheEntries) {
    if (!t.parentId) continue;
    const parent = byKey.get(t.parentId) || (t.parentOid ? byOid.get(t.parentOid) : null);
    if (!parent) continue;
    pushPair(
      { text: parent.content, path: parent.path, line: parent.lineNumber },
      { text: t.content, path: t.path, line: t.lineNumber },
      "parent-restatement"
    );
  }
  // (d) hard-negative candidates: TF-IDF cosine, top-3 same-project other open tasks.
  // (Embeddings skipped deliberately: TF-IDF is cheap and needs no network.)
  const docs = openTasks.map((e) => e.t);
  const df = new Map();
  const tfList = docs.map((t) => {
    const tf = new Map();
    for (const tok of new Set(tokenize(t.content || ""))) {
      tf.set(tok, (tf.get(tok) || 0) + 1);
      df.set(tok, (df.get(tok) || 0) + 1);
    }
    return tf;
  });
  const N = docs.length;
  const idf = new Map(Array.from(df.entries()).map(([tok, d]) => [tok, Math.log(N / d)]));
  const vecs = tfList.map((tf) => {
    const v = new Map();
    let norm2 = 0;
    for (const [tok, f] of tf) {
      const w = f * (idf.get(tok) || 0);
      v.set(tok, w); norm2 += w * w;
    }
    return { v, n: Math.sqrt(norm2) };
  });
  const cosine = (i, j) => {
    const A = vecs[i], B = vecs[j];
    if (!A.n || !B.n) return 0;
    const [small, big] = A.v.size <= B.v.size ? [A, B] : [B, A];
    let dot = 0;
    for (const [tok, w] of small.v) if (big.v.has(tok)) dot += w * big.v.get(tok);
    return dot / (A.n * B.n);
  };
  docs.forEach((t, i) => {
    const sims = [];
    docs.forEach((u, j) => {
      if (i === j) return;
      if ((u.projectId || "") !== (t.projectId || "")) return;
      sims.push({ j, s: cosine(i, j) });
    });
    sims.sort((a, b) => b.s - a.s);
    for (const { j } of sims.slice(0, HARD_NEG_TOP)) {
      const u = docs[j];
      pushPair(
        { text: t.content, path: t.path, line: t.lineNumber },
        { text: u.content, path: u.path, line: u.lineNumber },
        "hard-negative-candidate"
      );
    }
  });

  // --- Write outputs (only writes allowed).
  const queriesByKind = {};
  for (const q of queryPool) queriesByKind[q.kind] = (queriesByKind[q.kind] || 0) + 1;
  const sampledByKind = {};
  for (const q of sample) sampledByKind[q.kind] = (sampledByKind[q.kind] || 0) + 1;
  const createdAt = new Date().toISOString();
  const payload = {
    version: 1, createdAt, vault: vaultRoot, seed: SEED,
    queryPoolCount: queryPool.length,
    queryPool,
    sample,
    retrievalCandidates,
    dedupCandidates,
  };
  const counts = {
    queriesByKind, sampled: sample.length, sampledByKind,
    retrievalByReason: countsReason,
    retrievalTotal: retrievalCandidates.reduce((a, r) => a + r.candidates.length, 0),
    dedupByKind: countsPair,
    dedupTotal: dedupCandidates.length,
    poolTotal: queryPool.length,
    seriesTruncated,
  };
  const meta = { version: 1, createdAt, vault: vaultRoot, seed: SEED, counts };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "gold-candidates.json"), JSON.stringify(payload));
  fs.writeFileSync(path.join(outDir, "gold-candidates-meta.json"), JSON.stringify(meta, null, 2));

  // --- 5. Stdout summary (counts only; no vault text).
  const lines = [
    "gold-candidates: vault=" + vaultRoot,
    "gold-candidates: out=" + outDir,
    "queries pool=" + queryPool.length + " (" +
      Object.entries(queriesByKind).map(([k, v]) => k + "=" + v).join(", ") + ")",
    "queries sampled=" + sample.length + " (" +
      Object.entries(sampledByKind).map(([k, v]) => k + "=" + v).join(", ") + ")",
    "retrieval candidates total=" +
      counts.retrievalTotal + " (" +
      Object.entries(countsReason).map(([k, v]) => k + "=" + v).join(", ") + ")",
    "dedup pairs total=" + dedupCandidates.length + " (" +
      Object.entries(countsPair).map(([k, v]) => k + "=" + v).join(", ") + ")",
  ];
  process.stdout.write(lines.join("\n") + "\n");
  void sampledIds;
}

main();
