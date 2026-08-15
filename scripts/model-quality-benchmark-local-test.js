"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

let blockedNetworkCallAttempts = 0;
global.fetch = async () => {
  blockedNetworkCallAttempts += 1;
  throw new Error("Network disabled in model-quality benchmark local test.");
};

const benchmark = require("./model-quality-benchmark.js");
const suite = JSON.parse(fs.readFileSync(path.join(__dirname, "model-quality-benchmark-cases.json"), "utf8"));
let passedAssertions = 0;

function check(condition, message) {
  assert.ok(condition, message);
  passedAssertions += 1;
}

function throws(work, pattern, message) {
  assert.throws(work, pattern, message);
  passedAssertions += 1;
}

function run() {
  benchmark.validateSuite(suite);
  check(suite.requested_max_output_tokens === benchmark.REQUESTED_MAX_OUTPUT_TOKENS, "The suite manifest must define the shared 12,288-token output ceiling.");

  const descriptionCase = suite.cases.find((item) => item.id === "solaris-description");
  const prompt = benchmark.makePrompt(descriptionCase, "openrouter", "deepseek/deepseek-v4-flash");
  const requestBodies = benchmark.providerRequestBodies("synthetic-model", prompt, benchmark.REQUESTED_MAX_OUTPUT_TOKENS, "high");
  check(requestBodies.openrouter.max_tokens === 12288, "OpenRouter must receive the common requested output ceiling.");
  check(requestBodies.openai.max_completion_tokens === 12288, "OpenAI must receive the common requested output ceiling.");
  check(requestBodies.gemini.generationConfig.maxOutputTokens === 12288, "Gemini must receive the common requested output ceiling.");
  check(requestBodies.openwebui.options.num_predict === 12288, "OpenWebUI must receive the common requested output ceiling.");
  check(benchmark.usageFrom({ usage: { completion_tokens: 37 } }).provider_reported_output_tokens === 37, "Provider-reported output usage must be preserved per result.");
  check(benchmark.usageFrom({ usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 17, thoughtsTokenCount: 19 } }).provider_reported_output_tokens === 36, "Gemini output usage must include provider-reported thinking tokens before applying an output rate that includes thinking.");
  check(benchmark.usageFrom({}).provider_reported_output_tokens === null, "Unavailable provider output usage must remain unavailable rather than becoming an invented value.");

  const pricingMetadata = benchmark.loadPricingMetadata();
  const gemini37Rate = benchmark.pricingRateFor("gemini", "gemini-3.7-flash", pricingMetadata);
  check(gemini37Rate !== null && gemini37Rate.pricing_tier === "standard-paid" && gemini37Rate.effective_through === "2026-12-31", "Gemini 3.7 pricing metadata must identify the Standard paid rate term.");
  check(gemini37Rate.input_usd_per_million_tokens === 0.75 && gemini37Rate.output_usd_per_million_tokens === 3.75 && gemini37Rate.output_includes === "thinking", "Gemini 3.7 pricing metadata must retain the official input/output rates, including thinking in output.");
  check(benchmark.calculatedCostFromUsage({ input_tokens: 1000000, output_tokens: 1000000 }, gemini37Rate) === 4.5, "Gemini 3.7 cost must use actual input and output tokens with the published per-million rates.");
  check(benchmark.calculatedCostFromUsage({ input_tokens: 1000000, output_tokens: null }, gemini37Rate) === null, "Gemini 3.7 cost must remain unavailable when provider output usage is absent.");
  const pricedGeminiUsage = benchmark.applyPricingRate({ input_tokens: 250000, output_tokens: 100000, provider_reported_output_tokens: 100000, total_tokens: 350000, cost: null }, gemini37Rate);
  check(pricedGeminiUsage.cost === 0.5625 && pricedGeminiUsage.cost_basis === "official-rate-calculated", "A direct Gemini cost must be machine-calculated only from reported token counts.");
  const unavailableAggregate = benchmark.aggregateUsage([{ usage: pricedGeminiUsage }, { usage: { input_tokens: null, provider_reported_output_tokens: null, total_tokens: null, cost: null } }]);
  check(unavailableAggregate.input_tokens === null && unavailableAggregate.output_tokens === null && unavailableAggregate.cost === null && unavailableAggregate.cost_status === "unavailable-provider-usage", "Aggregate totals and cost must not substitute zero when provider token usage is absent.");

  const focus = benchmark.resolveProviderFocus("openrouter", "deepseek/deepseek-v4-flash", "task-description");
  check(JSON.stringify(prompt.focus.profile) === JSON.stringify(focus.profile) && prompt.focus.operation === "task-description", "Prompt focus profile must come from the exact production provider/model/operation resolution.");
  check(!focus.text.includes("Aurora") && !focus.text.includes("Solaris"), "Provider focus hints must not duplicate benchmark-specific proper nouns.");
  check(!focus.text || prompt.system.split(focus.text).length === 2, "Production provider focus text must appear exactly once in the system prompt.");

  const reversedCase = { ...descriptionCase, evidence: descriptionCase.evidence.slice().reverse() };
  const ordered = benchmark.stableEvidenceRows(reversedCase.evidence);
  check(JSON.stringify(ordered.map((item) => item.lane)) === JSON.stringify(["current_action", "required_current", "material_current", "superseded_history", "unrelated"]), "Evidence lanes must serialize in stable authority-first order.");
  const orderedPrompt = benchmark.makePrompt(reversedCase, "openai", "gpt-5.6-luna");
  check(orderedPrompt.user.indexOf("[current_action | S0]") < orderedPrompt.user.indexOf("[required_current | S1]")
    && orderedPrompt.user.indexOf("[required_current | S1]") < orderedPrompt.user.indexOf("[material_current | S2]")
    && orderedPrompt.user.indexOf("[material_current | S2]") < orderedPrompt.user.indexOf("[superseded_history | S3]")
    && orderedPrompt.user.indexOf("[superseded_history | S3]") < orderedPrompt.user.indexOf("[unrelated | S4]"), "Prompt evidence serialization must preserve authority-first lane order.");
  check(orderedPrompt.system.includes("unrelated lane is excluded") && orderedPrompt.system.includes("superseded history cannot override current evidence"), "Prompt instructions must enforce lane authority semantics.");

  const invalidClassification = { ...suite, classification: "private-fixture" };
  throws(() => benchmark.validateSuite(invalidClassification), /synthetic-public-fixture/, "A non-synthetic suite must fail before catalog or provider work.");
  const invalidProvenance = { ...suite, cases: suite.cases.map((item, index) => index ? item : { ...item, evidence: [{ ...item.evidence[0], synthetic_provenance: "unknown" }, ...item.evidence.slice(1)] }) };
  throws(() => benchmark.validateSuite(invalidProvenance), /provenance/, "Evidence with missing synthetic provenance must be rejected.");
  const invalidLane = { ...suite, cases: suite.cases.map((item, index) => index ? item : { ...item, evidence: [{ ...item.evidence[0], lane: "private" }, ...item.evidence.slice(1)] }) };
  throws(() => benchmark.validateSuite(invalidLane), /authority lane/, "Evidence outside the allowlisted lanes must be rejected.");

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "model-quality-benchmark-local-test-"));
  try {
    benchmark.assertPrivateOutput(path.join(temporaryRoot, "safe-output"));
    check(true, "A normal OS temporary output path must be accepted.");
    const target = path.join(temporaryRoot, "target");
    const link = path.join(temporaryRoot, "reparse-link");
    fs.mkdirSync(target);
    try {
      fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
      throws(() => benchmark.assertPrivateOutput(path.join(link, "raw")), /symlink, junction, or reparse point/, "A symlink or junction traversal must be rejected.");
    } catch (error) {
      if (!/EPERM|EACCES|operation not permitted/i.test(String(error?.code || error?.message || error))) throw error;
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }

  check(blockedNetworkCallAttempts === 0, "The local benchmark test must make no network calls.");
  process.stdout.write(JSON.stringify({
    passed: passedAssertions,
    failed: 0,
    blockedNetworkCallAttempts,
    fixtureAccess: "none",
    checks: [
      "12288-provider-output-budget-parity",
      "gemini37-official-rate-metadata-and-exact-token-costing",
      "unavailable-provider-usage-preserves-n-a-totals-and-cost",
      "production-focus-single-placement-and-profile",
      "authority-first-evidence-lane-ordering",
      "synthetic-provenance-and-classification-rejection",
      "canonical-private-output-path-rejection"
    ]
  }, null, 2) + "\n");
}

run();
