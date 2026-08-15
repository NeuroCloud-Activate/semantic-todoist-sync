"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const repoRoot = path.resolve(__dirname, "..");

function inside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function main() {
  const outputDirectory = path.resolve(process.argv[2] || "");
  const inputPaths = process.argv.slice(3).map((value) => path.resolve(value));
  if (!outputDirectory || inputPaths.length < 2) throw new Error("Usage: merge-model-quality-runs.js <private-output-dir> <base-raw-results> <override-raw-results> [...]");
  if (![path.join(repoRoot, "Testing"), os.tmpdir()].some((root) => inside(root, outputDirectory))) throw new Error("Merged results must stay under private Testing/ or the OS temporary directory.");
  const records = inputPaths.map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")));
  const suiteHashes = new Set(records.map((record) => record.suite_sha256));
  const modelHashes = new Set(records.map((record) => record.model_manifest_sha256));
  if (suiteHashes.size !== 1 || modelHashes.size !== 1) throw new Error("Refusing to merge runs with different frozen suite or model manifests.");
  const byLabel = new Map();
  for (const record of records) for (const result of record.results || []) byLabel.set(result.label, result);
  const base = records[0];
  const merged = {
    ...base,
    started_utc: records.map((record) => record.started_utc).sort()[0],
    completed_utc: records.map((record) => record.completed_utc).sort().slice(-1)[0],
    merged_utc: new Date().toISOString(),
    merged_from: inputPaths.map((filePath) => ({ file: path.basename(path.dirname(filePath)) + "/" + path.basename(filePath), sha256: hash(fs.readFileSync(filePath)) })),
    results: [...byLabel.values()]
  };
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, "raw-results.json");
  fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify({ output: outputPath, models: merged.results.length }, null, 2) + "\n");
}

try { main(); } catch (error) { process.stderr.write(`[merge-benchmark] ${String(error?.message || error)}\n`); process.exitCode = 1; }
