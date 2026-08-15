"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function fail(message) {
  process.stderr.write(`[prepare-judging] ${message}\n`);
  process.exitCode = 1;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function inside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function main() {
  const rawPath = path.resolve(process.argv[2] || "");
  if (!rawPath || !fs.existsSync(rawPath)) throw new Error("Pass the private raw-results.json path.");
  const outputDirectory = path.dirname(rawPath);
  const repoRoot = path.resolve(__dirname, "..");
  const allowed = [path.join(repoRoot, "Testing"), require("os").tmpdir()];
  if (!allowed.some((root) => inside(root, outputDirectory))) throw new Error("Judging packets must remain in a private Testing/ or OS-temporary directory.");
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  const suite = JSON.parse(fs.readFileSync(path.join(__dirname, "model-quality-benchmark-cases.json"), "utf8"));
  const salt = crypto.randomBytes(32).toString("hex");
  const identities = raw.results.map((result) => ({ blind_id: `candidate-${hash(`${salt}:${result.label}`).slice(0, 10)}`, label: result.label }));
  const byLabel = new Map(identities.map((item) => [item.label, item.blind_id]));
  const candidates = raw.results.map((result) => ({
    blind_id: byLabel.get(result.label),
    availability_status: result.status === "not-evaluated-unavailable" ? "not-evaluated-unavailable" : "evaluated",
    cases: suite.cases.map((testCase) => {
      const observed = (result.cases || []).find((item) => item.case_id === testCase.id);
      return {
        case_id: testCase.id,
        operation: testCase.operation,
        maximum_points: testCase.points,
        status: observed?.status || (result.status === "not-evaluated-unavailable" ? "not-evaluated-unavailable" : "missing"),
        output: observed?.output || ""
      };
    })
  })).sort((left, right) => hash(`${salt}:${left.blind_id}`).localeCompare(hash(`${salt}:${right.blind_id}`)));
  const packet = {
    schema_version: 1,
    suite_version: suite.version,
    instructions: "Judge only the final AI output holistically for intent fidelity, factual accuracy, relevance, completeness/actionability, and clarity/usability against the frozen evidence and reference. Required-fact lists are context aids, not coverage checklists: do not count facts or require every supplied fact to be repeated. Candidate identity, provider, latency, cost, schema/citation mechanics, and prior scores are intentionally excluded from quality scoring.",
    rubric: suite.score_contract,
    cases: suite.cases,
    candidates
  };
  fs.writeFileSync(path.join(outputDirectory, "blind-judging-packet.json"), JSON.stringify(packet, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(outputDirectory, "blind-identity-key.json"), JSON.stringify({ salt, identities }, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify({ candidates: candidates.length, cases: suite.cases.length, packet: path.join(outputDirectory, "blind-judging-packet.json"), identity_key: path.join(outputDirectory, "blind-identity-key.json") }, null, 2) + "\n");
}

try { main(); } catch (error) { fail(String(error?.message || error)); }
