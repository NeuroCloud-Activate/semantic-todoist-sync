"use strict";
// scripts/retrieval-eval-seed-embeddings.js — seed query embeddings once (network allowed here only).
// CLI: node scripts/retrieval-eval-seed-embeddings.js --vault <path> --out <dir> --runtime <main.js>
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const https = require("node:https");

function fail(msg) { process.stderr.write(`retrieval-eval-seed-embeddings: ${msg}\n`); process.exit(1); }

function parseArgs(argv) {
  const args = { vault: "", out: "", runtime: "", textsFile: "" };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--vault") args.vault = argv[++i];
    else if (flag === "--out") args.out = argv[++i];
    else if (flag === "--runtime") args.runtime = argv[++i];
    else if (flag === "--texts-file") args.textsFile = argv[++i];
    else fail(`unknown arg: ${flag}`);
  }
  if (!args.vault) fail("missing --vault <path>");
  args.vault = path.resolve(args.vault);
  if (!args.out) args.out = path.join(args.vault, ".obsidian", "plugins", "semantic-todoist-sync", "eval-private");
  else args.out = path.resolve(args.out);
  if (!args.runtime) args.runtime = path.resolve(__dirname, "..", "main.js");
  else args.runtime = path.resolve(args.runtime);
  return args;
}

function loadPluginSettings(dataPath) {
  const raw = fs.readFileSync(dataPath, "utf8");
  const data = JSON.parse(raw);
  return {
    provider: String(data.embeddingProvider || data.embeddingModelReference?.provider || ""),
    model: String(data.embeddingModel || data.embeddingModelReference?.model || ""),
    baseUrl: String(data.customOpenAIBaseUrl || "").trim(),
    apiKey: String(data.customOpenAIApiKey || data.openaiApiKey || "").trim(),
  };
}

function readGoldTexts(goldPath) {
  const raw = fs.readFileSync(goldPath, "utf8");
  const gold = JSON.parse(raw);
  const setTexts = new Set();
  for (const q of Array.isArray(gold.queries) ? gold.queries : []) setTexts.add(String(q.text ?? ""));
  for (const s of Array.isArray(gold.self) ? gold.self : []) setTexts.add(String(s.text ?? ""));
  const texts = [...setTexts].map((t) => String(t)).filter((t) => t.trim().length > 0);
  if (!texts.length) fail("gold file has no non-empty texts");
  return texts;
}

function keyFor(model, text) {
  return crypto.createHash("sha256").update(`${model}\n${text}`, "utf8").digest("hex");
}

function postEmbeddings(urlStr, apiKey, texts, model) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const body = JSON.stringify({ model, input: texts });
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300 && parsed && Array.isArray(parsed.data)) {
            const result = parsed.data.map((row) => {
              const vec = Array.isArray(row.embedding) ? row.embedding : Array.isArray(row.values) ? row.values : [];
              return Array.isArray(vec) ? vec.map(Number) : [];
            });
            resolve({ status: res.statusCode, result, raw: parsed, text: data });
          } else {
            resolve({ status: res.statusCode, error: parsed?.error || parsed, text: data, result: null });
          }
        } catch {
          resolve({ status: res.statusCode, error: data, text: data, result: null });
        }
      });
    });
    req.on("error", (e) => reject(e));
    req.write(body);
    req.end();
  });
}

async function runBatch(urlStr, apiKey, texts, model, label) {
  // Retry once on 5xx / 429 with 2s backoff
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const resp = await postEmbeddings(urlStr, apiKey, texts, model);
      if (resp.status >= 500 || resp.status === 429) {
        if (attempt === 0) {
          console.log(`batch ${label}: retry after 2s for status ${resp.status}`);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        throw new Error(`embedding endpoint returned status ${resp.status}: ${resp.text?.slice(0, 200)}`);
      }
      if (!resp.result || resp.result.length !== texts.length) {
        throw new Error(`embedding count mismatch: expected ${texts.length}, got ${resp.result ? resp.result.length : "null"}`);
      }
      return resp.result;
    } catch (err) {
      if (attempt === 0) {
        console.log(`batch ${label}: retry after 2s for error ${err.message}`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`batch ${label}: failed after retry`);
}

async function main() {
  const args = parseArgs(process.argv);
  const goldPath = path.join(args.out, "retrieval-gold.json");
  if (!fs.existsSync(goldPath)) fail(`gold file missing: ${goldPath}`);

  const texts = readGoldTexts(goldPath);
  console.log(`seed: ${texts.length} unique texts from gold (${goldPath})`);
  if (args.textsFile) {
    const resolved = path.resolve(args.textsFile);
    let extra;
    try {
      extra = JSON.parse(fs.readFileSync(resolved, "utf8"));
    } catch (error) {
      fail(`texts file unreadable: ${resolved}: ${error.message}`);
    }
    if (!Array.isArray(extra)) fail(`texts file must be a JSON array: ${resolved}`);
    const seen = new Set(texts);
    for (const entry of extra) {
      const text = String(entry ?? "");
      if (!text.trim() || seen.has(text)) continue;
      seen.add(text);
      texts.push(text);
    }
    console.log(`seed: +${texts.length} total unique texts after ${resolved}`);
  }

  const pluginDir = path.join(args.vault, ".obsidian", "plugins", "semantic-todoist-sync");
  const settingsPath = path.join(pluginDir, "data.json");
  if (!fs.existsSync(settingsPath)) fail(`plugin data.json missing: ${settingsPath}`);
  const settings = loadPluginSettings(settingsPath);
  console.log(`settings: provider=${settings.provider} model=${settings.model} baseUrl=${settings.baseUrl ? "set(" + settings.baseUrl.slice(0, 30) + "...)" : "MISSING"}`);
  if (!settings.baseUrl) fail("customOpenAIBaseUrl missing from data.json");
  if (!settings.apiKey) fail("customOpenAIApiKey missing from data.json (required for bearer token)");
  if (!settings.model) fail("embeddingModel / embeddingModelReference.model missing from data.json");

  const urlStr = settings.baseUrl.replace(/\/$/, "") + "/embeddings";
  const batchSize = 16;
  const concurrency = 2;
  const allResults = [];
  let completed = 0;

  // Process batches with concurrency 2 using simple promise pool
  const batches = [];
  for (let i = 0; i < texts.length; i += batchSize) batches.push(texts.slice(i, i + batchSize));

  const resultsByBatch = []; // parallel array
  async function processPool() {
    let index = 0;
    async function worker() {
      while (index < batches.length) {
        const currentIndex = index++;
        const batch = batches[currentIndex];
        const label = `batch-${currentIndex + 1}-${batch.length}`;
        const vectors = await runBatch(urlStr, settings.apiKey, batch, settings.model, label);
        completed += 1;
        console.log(`seed: completed ${completed}/${batches.length} batches (${batch.length} texts)`);
        resultsByBatch[currentIndex] = { batch, vectors };
      }
    }
    await Promise.all([worker(), worker()]);
  }
  await processPool();

  // Assemble results in batch order
  for (const item of resultsByBatch) {
    for (let i = 0; i < item.batch.length; i += 1) allResults.push({ text: item.batch[i], vector: item.vectors[i] });
  }

  // Verify vector lengths
  const dims = new Set(allResults.map((r) => (Array.isArray(r.vector) ? r.vector.length : 0)).filter(Boolean));
  const expectedDim = 1024;
  if (dims.has(expectedDim) && dims.size === 1) {
    console.log(`seed: all vectors length=${expectedDim}`);
  } else {
    console.log(`seed: WARNING vector dimensions vary: ${[...dims].join(", ")} (expected ${expectedDim})`);
  }
  for (const d of dims) {
    if (d !== expectedDim) console.log(`seed: MISMATCH dimension ${d} (expected ${expectedDim})`);
  }

  // Build / merge cache file
  const outFile = path.join(args.out, "query-embeddings.json");
  let entries = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(outFile, "utf8"));
    if (parsed && typeof parsed.entries === "object" && parsed.entries) entries = parsed.entries;
  } catch { entries = {}; }

  const modelUsed = settings.model;
  const newEntries = {};
  for (const item of allResults) {
    const k = keyFor(modelUsed, item.text);
    newEntries[k] = item.vector;
  }

  // Merge: keep prior entries; overwrite with new for same keys
  const mergedEntries = Object.assign({}, entries, newEntries);
  const output = {
    version: 1,
    model: modelUsed,
    entries: mergedEntries,
  };
  fs.mkdirSync(args.out, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2), "utf8");
  console.log(`seed: wrote ${outFile} — entries=${Object.keys(mergedEntries).length} (new=${Object.keys(newEntries).length}, existing=${Object.keys(entries).length})`);
  const stats = fs.statSync(outFile);
  console.log(`seed: file size=${stats.size} bytes`);
}

main().catch((e) => fail(String(e.message || e)));
