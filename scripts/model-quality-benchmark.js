"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const Module = require("module");

const repoRoot = path.resolve(__dirname, "..");
const casesPath = path.join(__dirname, "model-quality-benchmark-cases.json");
const modelsPath = path.join(__dirname, "model-quality-benchmark-models.json");
const pricingPath = path.join(__dirname, "model-quality-benchmark-pricing.json");
const REQUESTED_MAX_OUTPUT_TOKENS = 12288;
const SYNTHETIC_PUBLIC_FIXTURE = "synthetic-public-fixture";
const EVIDENCE_LANE_ORDER = Object.freeze([
  "current_action",
  "required_current",
  "material_current",
  "superseded_history",
  "unrelated"
]);
const EVIDENCE_LANES = new Set(EVIDENCE_LANE_ORDER);
let productionProviderFocus = null;

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      index += 1;
    } else out[key] = true;
  }
  return out;
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validatePricingMetadata(metadata) {
  if (!metadata || metadata.schema_version !== 1 || !Array.isArray(metadata.rates)) {
    throw new Error("Benchmark pricing metadata must be a schema_version 1 object with rates.");
  }
  for (const rate of metadata.rates) {
    if (!rate || typeof rate.provider !== "string" || typeof rate.model !== "string"
      || !Number.isFinite(rate.input_usd_per_million_tokens) || rate.input_usd_per_million_tokens < 0
      || !Number.isFinite(rate.output_usd_per_million_tokens) || rate.output_usd_per_million_tokens < 0
      || rate.currency !== "USD" || typeof rate.source_url !== "string" || !rate.source_url) {
      throw new Error("Benchmark pricing metadata contains an invalid rate.");
    }
  }
  return metadata;
}

function loadPricingMetadata() {
  return validatePricingMetadata(readJson(pricingPath));
}

function pricingRateFor(provider, model, metadata = loadPricingMetadata()) {
  return metadata.rates.find((rate) => rate.provider === provider && rate.model === model) || null;
}

function inside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function realPath(filePath) {
  return fs.realpathSync.native ? fs.realpathSync.native(filePath) : fs.realpathSync(filePath);
}

function lstatMaybe(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function isReparseTraversalEntry(stat) {
  return Boolean(stat?.isSymbolicLink?.());
}

function existingPathAndStat(filePath) {
  let current = path.resolve(filePath);
  let stat = lstatMaybe(current);
  while (!stat) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Could not resolve an existing output-path parent.");
    current = parent;
    stat = lstatMaybe(current);
  }
  return { path: current, stat };
}

function assertCanonicalDescendant(root, candidate) {
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(candidate);
  if (!inside(absoluteRoot, absoluteCandidate)) throw new Error("Raw benchmark output is outside its permitted root.");
  const existingRoot = existingPathAndStat(absoluteRoot);
  if (isReparseTraversalEntry(existingRoot.stat)) throw new Error("Raw benchmark output may not traverse a symlink, junction, or reparse point.");
  const canonicalRoot = realPath(existingRoot.path);
  let current = existingRoot.path;
  const segments = path.relative(existingRoot.path, absoluteCandidate).split(path.sep).filter(Boolean);
  for (const segment of segments) {
    current = path.join(current, segment);
    const currentStat = lstatMaybe(current);
    if (!currentStat) break;
    if (isReparseTraversalEntry(currentStat)) throw new Error("Raw benchmark output may not traverse a symlink, junction, or reparse point.");
    const canonicalCurrent = realPath(current);
    if (!inside(canonicalRoot, canonicalCurrent)) throw new Error("Raw benchmark output escapes its permitted canonical root.");
  }
  const existingParent = existingPathAndStat(absoluteCandidate);
  if (isReparseTraversalEntry(existingParent.stat)) throw new Error("Raw benchmark output may not traverse a symlink, junction, or reparse point.");
  if (!inside(canonicalRoot, realPath(existingParent.path))) throw new Error("Raw benchmark output escapes its permitted canonical root.");
}

function assertPrivateOutput(outputDirectory) {
  const absoluteOutput = path.resolve(outputDirectory);
  const publicShare = path.join(repoRoot, "public-share");
  if (inside(publicShare, absoluteOutput)) throw new Error("Raw benchmark output must never be written to public-share/.");
  const allowed = [path.join(repoRoot, "Testing"), os.tmpdir()];
  for (const root of allowed) {
    if (!inside(root, absoluteOutput)) continue;
    assertCanonicalDescendant(root, absoluteOutput);
    return;
  }
  throw new Error("Raw benchmark output must stay under the ignored Testing/ tree or the OS temporary directory.");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function stableEvidenceRows(evidence) {
  return evidence.map((item, index) => ({ ...item, index })).sort((left, right) => {
    const laneDelta = EVIDENCE_LANE_ORDER.indexOf(left.lane) - EVIDENCE_LANE_ORDER.indexOf(right.lane);
    return laneDelta || left.index - right.index;
  });
}

function providerOperation(testCase) {
  return String(testCase.provider_operation || "");
}

function loadProductionProviderFocus() {
  if (productionProviderFocus) return productionProviderFocus;
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request !== "obsidian") return originalLoad.call(this, request, parent, isMain);
    class Empty {}
    return {
      ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice: Empty,
      Plugin: Empty, PluginSettingTab: Empty, Setting: Empty, TFile: Empty, setIcon() {},
      requestUrl() { throw new Error("Network disabled while loading benchmark production focus."); }
    };
  };
  try {
    global.window = global.window || global;
    const Plugin = require(path.join(repoRoot, "main.js"));
    const focus = Plugin?.__multiProvider;
    if (!focus || typeof focus.providerOperationFocus !== "function" || typeof focus.providerOperationFocusSystemText !== "function") {
      throw new Error("Production provider focus helpers are unavailable from main.js.");
    }
    productionProviderFocus = focus;
    return focus;
  } finally {
    Module._load = originalLoad;
  }
}

function resolveProviderFocus(provider, model, operation) {
  const focusApi = loadProductionProviderFocus();
  const focus = focusApi.providerOperationFocus(provider, model, operation);
  if (!focus || typeof focus.text !== "string" || !Array.isArray(focus.profile)) throw new Error("Production provider focus returned an invalid profile.");
  return focus;
}

function makePrompt(testCase, provider, model) {
  const evidence = stableEvidenceRows(testCase.evidence).map((item) => `[${item.lane} | ${item.id}] ${item.text}`).join("\n");
  const focus = resolveProviderFocus(provider, model, providerOperation(testCase));
  const baseSystem = [
    "You are the generation stage of a local-first task and semantic-context plugin.",
    "Use only the supplied evidence. Current evidence is authoritative; superseded history cannot override current evidence.",
    "Evidence in the unrelated lane is excluded. Do not invent missing facts, tasks, people, dates, or requirements.",
    `Evidence is serialized in authority-first lane order: ${EVIDENCE_LANE_ORDER.join(", ")}.`,
    `Return one valid JSON object with exactly one string property named \"${testCase.output_key}\".`,
    "Do not return markdown, citations, evidence IDs, analysis, or additional properties."
  ].join(" ");
  const system = loadProductionProviderFocus().providerOperationFocusSystemText(baseSystem, focus);
  if (focus.text && system.split(focus.text).length !== 2) throw new Error("Production provider focus must be appended exactly once.");
  return {
    system,
    user: `Operation: ${providerOperation(testCase)}\nRequest: ${testCase.request}\n\nEvidence lanes:\n${evidence}`,
    focus: { provider: focus.provider, model: focus.model, operation: focus.operation, profile: focus.profile.slice() }
  };
}

function parseJsonObject(text, outputKey) {
  const raw = String(text || "").trim();
  const candidates = [raw];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed[outputKey] === "string") {
        return { valid: true, value: parsed[outputKey].trim(), parsed };
      }
    } catch {}
  }
  return { valid: false, value: "", parsed: null };
}

function credentialSummary(settings) {
  return {
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY || settings.openaiApiKey),
    gemini: Boolean(process.env.GEMINI_API_KEY || settings.googleApiKey),
    openwebui: Boolean(process.env.OPENWEBUI_BASE_URL || settings.openwebuiBaseUrl)
  };
}

async function fetchJson(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = process.hrtime.bigint();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const bodyText = await response.text();
    let payload = null;
    try { payload = JSON.parse(bodyText); } catch {}
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.providerCode = String(payload?.error?.code || payload?.code || "");
      error.providerType = String(payload?.error?.type || "");
      error.elapsedMs = elapsedMs;
      throw error;
    }
    return { payload, bodyText, elapsedMs };
  } finally {
    clearTimeout(timer);
  }
}

function chatContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => typeof item === "string" ? item : item?.text || "").join("");
  return "";
}

function reportedNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function usageFrom(payload) {
  const usage = payload?.usage || payload?.usageMetadata || {};
  const inputTokens = reportedNumber(usage.prompt_tokens, usage.promptTokenCount, usage.input_tokens, payload?.prompt_eval_count);
  const geminiCandidateTokens = reportedNumber(usage.candidatesTokenCount);
  const geminiThoughtTokens = reportedNumber(usage.thoughtsTokenCount);
  const geminiOutputTokens = geminiCandidateTokens === null ? null : geminiCandidateTokens + Number(geminiThoughtTokens || 0);
  const outputTokens = reportedNumber(usage.completion_tokens, geminiOutputTokens, usage.output_tokens, payload?.eval_count);
  const totalTokens = reportedNumber(usage.total_tokens, usage.totalTokenCount, payload?.prompt_eval_count !== undefined || payload?.eval_count !== undefined
    ? Number(payload?.prompt_eval_count || 0) + Number(payload?.eval_count || 0) : undefined);
  const providerReportedCost = reportedNumber(usage.cost);
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    provider_reported_output_tokens: outputTokens,
    provider_reported_thinking_tokens: geminiThoughtTokens,
    total_tokens: totalTokens,
    provider_reported_cost: providerReportedCost,
    cost: providerReportedCost,
    cost_basis: providerReportedCost === null ? "unavailable-provider-usage" : "provider-reported"
  };
}

function calculatedCostFromUsage(usage, rate) {
  if (!rate || usage?.input_tokens === null || usage?.input_tokens === undefined
    || usage?.output_tokens === null || usage?.output_tokens === undefined) return null;
  const inputTokens = Number(usage.input_tokens);
  const outputTokens = Number(usage.output_tokens);
  if (!Number.isFinite(inputTokens) || inputTokens < 0 || !Number.isFinite(outputTokens) || outputTokens < 0) return null;
  return (inputTokens * rate.input_usd_per_million_tokens + outputTokens * rate.output_usd_per_million_tokens) / 1000000;
}

function applyPricingRate(usage, rate) {
  if (!rate) return usage;
  const cost = calculatedCostFromUsage(usage, rate);
  return {
    ...usage,
    cost,
    cost_basis: cost === null ? "unavailable-provider-usage" : "official-rate-calculated",
    pricing_rate: rate
  };
}

function aggregateUsage(results) {
  const usages = results.map((item) => item?.usage || null);
  const hasExactTokens = usages.length > 0 && usages.every((usage) => usage
    && Number.isFinite(usage.input_tokens) && usage.input_tokens >= 0
    && Number.isFinite(usage.provider_reported_output_tokens) && usage.provider_reported_output_tokens >= 0);
  const hasExactCost = usages.length > 0 && usages.every((usage) => usage && Number.isFinite(usage.cost) && usage.cost >= 0);
  return {
    input_tokens: hasExactTokens ? usages.reduce((sum, usage) => sum + usage.input_tokens, 0) : null,
    output_tokens: hasExactTokens ? usages.reduce((sum, usage) => sum + usage.provider_reported_output_tokens, 0) : null,
    total_tokens: hasExactTokens ? usages.reduce((sum, usage) => sum + Number(usage.total_tokens || 0), 0) : null,
    cost: hasExactCost ? usages.reduce((sum, usage) => sum + usage.cost, 0) : null,
    token_usage_status: hasExactTokens ? "exact" : "unavailable-provider-usage",
    cost_status: hasExactCost ? "exact" : "unavailable-provider-usage"
  };
}

function providerRequestBodies(model, prompt, requestedMaxOutputTokens, reasoningEffort = "") {
  return {
    openrouter: {
      model,
      messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
      stream: false,
      max_tokens: requestedMaxOutputTokens
    },
    openai: {
      model,
      messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
      stream: false,
      max_completion_tokens: requestedMaxOutputTokens,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {})
    },
    gemini: {
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: "user", parts: [{ text: prompt.user }] }],
      generationConfig: { temperature: 0, maxOutputTokens: requestedMaxOutputTokens, responseMimeType: "application/json" }
    },
    openwebui: {
      model,
      messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
      stream: false,
      think: false,
      format: "json",
      options: { temperature: 0, num_predict: requestedMaxOutputTokens }
    }
  };
}

async function callOpenRouter(model, prompt, key, requestedMaxOutputTokens) {
  const result = await fetchJson("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "http-referer": "http://localhost",
      "x-title": "Semantic Todoist Sync private benchmark"
    },
    body: JSON.stringify(providerRequestBodies(model, prompt, requestedMaxOutputTokens).openrouter)
  });
  return { text: chatContent(result.payload), payload: result.payload, elapsedMs: result.elapsedMs, servedModel: String(result.payload?.model || model) };
}

async function callOpenAI(model, prompt, key, reasoningEffort, requestedMaxOutputTokens) {
  const result = await fetchJson("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(providerRequestBodies(model, prompt, requestedMaxOutputTokens, reasoningEffort).openai)
  });
  return { text: chatContent(result.payload), payload: result.payload, elapsedMs: result.elapsedMs, servedModel: String(result.payload?.model || model) };
}

async function callGemini(model, prompt, key, requestedMaxOutputTokens) {
  const result = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify(providerRequestBodies(model, prompt, requestedMaxOutputTokens).gemini)
  });
  const text = (result.payload?.candidates?.[0]?.content?.parts || []).map((part) => part?.text || "").join("");
  return { text, payload: result.payload, elapsedMs: result.elapsedMs, servedModel: model };
}

async function callOpenWebUI(model, prompt, settings, requestedMaxOutputTokens) {
  const baseUrl = String(process.env.OPENWEBUI_BASE_URL || settings.openwebuiBaseUrl || "").replace(/\/+$/, "");
  const key = String(process.env.OPENWEBUI_API_KEY || settings.openwebuiApiKey || "");
  const headers = { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) };
  const result = await fetchJson(`${baseUrl}/ollama/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(providerRequestBodies(model, prompt, requestedMaxOutputTokens).openwebui)
  }, 120000);
  return { text: String(result.payload?.message?.content || ""), payload: result.payload, elapsedMs: result.elapsedMs, servedModel: String(result.payload?.model || model) };
}

async function providerCatalogs(settings) {
  const catalogs = { openrouter: new Set(), openwebui: new Set() };
  const metadata = { openrouter: {}, checked_utc: new Date().toISOString() };
  const openRouterKey = String(process.env.OPENROUTER_API_KEY || "");
  if (openRouterKey) {
    const result = await fetchJson("https://openrouter.ai/api/v1/models", { headers: { authorization: `Bearer ${openRouterKey}` } }, 60000);
    for (const model of result.payload?.data || []) {
      catalogs.openrouter.add(String(model.id));
      metadata.openrouter[model.id] = {
        context_length: Number(model.context_length || 0),
        prompt_price: String(model.pricing?.prompt || ""),
        completion_price: String(model.pricing?.completion || "")
      };
    }
  }
  const baseUrl = String(process.env.OPENWEBUI_BASE_URL || settings.openwebuiBaseUrl || "").replace(/\/+$/, "");
  const openWebUIKey = String(process.env.OPENWEBUI_API_KEY || settings.openwebuiApiKey || "");
  if (baseUrl) {
    const result = await fetchJson(`${baseUrl}/api/models`, { headers: openWebUIKey ? { authorization: `Bearer ${openWebUIKey}` } : {} }, 30000);
    for (const model of result.payload?.data || []) catalogs.openwebui.add(String(model.id));
  }
  return { catalogs, metadata };
}

function modelAvailability(spec, credentials, catalogs) {
  if (spec.enabled === false) return { available: false, reason: spec.unavailable_reason || "Disabled by frozen model manifest." };
  if (!credentials[spec.provider]) return { available: false, reason: `No ${spec.provider} credential or endpoint is configured.` };
  if (catalogs[spec.provider] instanceof Set && !catalogs[spec.provider].has(spec.model)) {
    return { available: false, reason: `Model was not present in the ${spec.provider} catalog at run time.` };
  }
  return { available: true, reason: "" };
}

function validateSuite(suite) {
  if (!suite || typeof suite !== "object") throw new Error("Benchmark suite must be a JSON object.");
  if (suite.classification !== SYNTHETIC_PUBLIC_FIXTURE) throw new Error("Benchmark suite must be classified synthetic-public-fixture before any provider call.");
  if (suite.synthetic_provenance?.fixture !== SYNTHETIC_PUBLIC_FIXTURE || suite.synthetic_provenance?.synthetic_only !== true) {
    throw new Error("Benchmark suite must carry the required synthetic-public-fixture provenance assertion before any provider call.");
  }
  if (suite.requested_max_output_tokens !== REQUESTED_MAX_OUTPUT_TOKENS) {
    throw new Error(`Benchmark suite requested_max_output_tokens must be ${REQUESTED_MAX_OUTPUT_TOKENS}.`);
  }
  if (!Array.isArray(suite.cases) || suite.cases.length === 0) throw new Error("Benchmark suite must contain cases.");
  for (const testCase of suite.cases) {
    if (!providerOperation(testCase)) throw new Error(`Benchmark case ${testCase?.id || "(unknown)"} lacks a production provider operation.`);
    if (!Array.isArray(testCase.evidence) || testCase.evidence.length === 0) throw new Error(`Benchmark case ${testCase?.id || "(unknown)"} lacks evidence.`);
    for (const evidence of testCase.evidence) {
      if (!EVIDENCE_LANES.has(evidence?.lane)) throw new Error(`Benchmark evidence ${testCase?.id || "(unknown)"}/${evidence?.id || "(unknown)"} has an invalid authority lane.`);
      if (evidence.synthetic_provenance !== SYNTHETIC_PUBLIC_FIXTURE) {
        throw new Error(`Benchmark evidence ${testCase?.id || "(unknown)"}/${evidence?.id || "(unknown)"} lacks synthetic-public-fixture provenance.`);
      }
    }
  }
  return suite;
}

async function runCase(spec, testCase, settings, requestedMaxOutputTokens) {
  const prompt = makePrompt(testCase, spec.provider, spec.model);
  const startedUtc = new Date().toISOString();
  try {
    let response;
    if (spec.provider === "openrouter") response = await callOpenRouter(spec.model, prompt, process.env.OPENROUTER_API_KEY, requestedMaxOutputTokens);
    else if (spec.provider === "openai") response = await callOpenAI(spec.model, prompt, process.env.OPENAI_API_KEY || settings.openaiApiKey, spec.reasoning_effort, requestedMaxOutputTokens);
    else if (spec.provider === "gemini") response = await callGemini(spec.model, prompt, process.env.GEMINI_API_KEY || settings.googleApiKey, requestedMaxOutputTokens);
    else if (spec.provider === "openwebui") response = await callOpenWebUI(spec.model, prompt, settings, requestedMaxOutputTokens);
    else throw new Error(`Unsupported provider: ${spec.provider}`);
    const parsed = parseJsonObject(response.text, testCase.output_key);
    const usage = applyPricingRate(usageFrom(response.payload), pricingRateFor(spec.provider, spec.model));
    return {
      case_id: testCase.id,
      operation: testCase.operation,
      provider_operation: providerOperation(testCase),
      status: parsed.valid && parsed.value ? "completed" : "invalid-output",
      started_utc: startedUtc,
      elapsed_ms: Math.round(response.elapsedMs),
      served_model: response.servedModel,
      requested_max_output_tokens: requestedMaxOutputTokens,
      provider_reported_output_tokens: usage.provider_reported_output_tokens,
      provider_focus: prompt.focus,
      output: parsed.value,
      raw_output: response.text,
      usage,
      finish_reason: String(response.payload?.choices?.[0]?.finish_reason || response.payload?.candidates?.[0]?.finishReason || ""),
      parse_valid: parsed.valid
    };
  } catch (error) {
    return {
      case_id: testCase.id,
      operation: testCase.operation,
      provider_operation: providerOperation(testCase),
      status: error?.name === "AbortError" ? "timeout" : "failed",
      started_utc: startedUtc,
      elapsed_ms: Math.round(Number(error?.elapsedMs || 0)),
      requested_max_output_tokens: requestedMaxOutputTokens,
      provider_reported_output_tokens: null,
      provider_focus: prompt.focus,
      error: { name: String(error?.name || "Error"), message: String(error?.message || "").slice(0, 240), status: Number(error?.status || 0), provider_code: String(error?.providerCode || ""), provider_type: String(error?.providerType || "") }
    };
  }
}

async function runModel(spec, cases, settings, availability, requestedMaxOutputTokens) {
  if (!availability.available) return { label: spec.label, provider: spec.provider, requested_model: spec.model, status: "not-evaluated-unavailable", unavailable_reason: availability.reason, cases: [] };
  const results = [];
  for (const testCase of cases) {
    process.stderr.write(`[benchmark] ${spec.label}: ${testCase.id}\n`);
    results.push(await runCase(spec, testCase, settings, requestedMaxOutputTokens));
  }
  const completed = results.filter((item) => item.status === "completed").length;
  return {
    label: spec.label,
    provider: spec.provider,
    requested_model: spec.model,
    status: completed === results.length ? "completed" : completed ? "partial" : "failed",
    completed_cases: completed,
    total_cases: results.length,
    total_elapsed_ms: results.reduce((sum, item) => sum + Number(item.elapsed_ms || 0), 0),
    pricing_rate: pricingRateFor(spec.provider, spec.model),
    usage: aggregateUsage(results),
    cases: results
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function lane() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadDotEnv(path.resolve(args.env || path.join(repoRoot, ".env")));
  const settingsPath = args.settings ? path.resolve(args.settings) : "";
  const settings = settingsPath ? readJson(settingsPath) : {};
  const suite = validateSuite(readJson(casesPath));
  const modelManifest = readJson(modelsPath);
  const pricingMetadata = loadPricingMetadata();
  const requestedMaxOutputTokens = suite.requested_max_output_tokens;
  const providerFilter = new Set(String(args.providers || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  const labelFilter = String(args["label-regex"] || "").trim();
  const labelPattern = labelFilter ? new RegExp(labelFilter, "i") : null;
  const selectedModels = modelManifest.models.filter((spec) => (!providerFilter.size || providerFilter.has(spec.provider)) && (!labelPattern || labelPattern.test(spec.label)));
  if (!selectedModels.length) throw new Error("The model filters selected no benchmark configurations.");
  const outputDirectory = path.resolve(args.output || path.join(repoRoot, "Testing", "benchmark-runs", nowStamp()));
  assertPrivateOutput(outputDirectory);
  fs.mkdirSync(outputDirectory, { recursive: true });
  assertPrivateOutput(outputDirectory);

  const credentials = credentialSummary(settings);
  const { catalogs, metadata } = await providerCatalogs(settings);
  const availability = Object.fromEntries(selectedModels.map((spec) => [spec.label, modelAvailability(spec, credentials, catalogs)]));
  const startedUtc = new Date().toISOString();
  const checkpointDirectory = path.join(outputDirectory, "checkpoints");
  fs.mkdirSync(checkpointDirectory, { recursive: true });
  const results = await mapLimit(selectedModels, Number(args.concurrency || 2), async (spec) => {
    const result = await runModel(spec, suite.cases, settings, availability[spec.label], requestedMaxOutputTokens);
    const checkpointName = `${sha256(spec.label).slice(0, 16)}.json`;
    fs.writeFileSync(path.join(checkpointDirectory, checkpointName), JSON.stringify(result, null, 2) + "\n", "utf8");
    return result;
  });
  const record = {
    schema_version: 1,
    suite_version: suite.version,
    model_manifest_version: modelManifest.version,
    requested_max_output_tokens: requestedMaxOutputTokens,
    started_utc: startedUtc,
    completed_utc: new Date().toISOString(),
    suite_sha256: sha256(fs.readFileSync(casesPath)),
    model_manifest_sha256: sha256(fs.readFileSync(modelsPath)),
    pricing_metadata: {
      path: path.relative(repoRoot, pricingPath).replace(/\\/g, "/"),
      sha256: sha256(fs.readFileSync(pricingPath)),
      schema_version: pricingMetadata.schema_version,
      rates: pricingMetadata.rates
    },
    filters: { providers: [...providerFilter], label_regex: labelFilter },
    credentials_present: credentials,
    catalog_metadata: metadata,
    reference: suite.score_contract,
    results
  };
  const rawPath = path.join(outputDirectory, "raw-results.json");
  fs.writeFileSync(rawPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  const summary = results.map((item) => ({
    label: item.label,
    status: item.status,
    completed_cases: Number(item.completed_cases || 0),
    total_cases: Number(item.total_cases || 0),
    total_elapsed_ms: Number(item.total_elapsed_ms || 0),
    input_tokens: item.usage?.input_tokens ?? null,
    provider_reported_output_tokens: item.usage?.output_tokens ?? null,
    provider_reported_cost: item.usage?.provider_reported_cost ?? null,
    api_cost_usd: item.usage?.cost ?? null,
    token_usage_status: item.usage?.token_usage_status || "unavailable-provider-usage",
    cost_status: item.usage?.cost_status || "unavailable-provider-usage",
    pricing_rate: item.pricing_rate || null,
    unavailable_reason: item.unavailable_reason || ""
  }));
  fs.writeFileSync(path.join(outputDirectory, "run-summary.json"), JSON.stringify({ started_utc: startedUtc, completed_utc: record.completed_utc, requested_max_output_tokens: requestedMaxOutputTokens, results: summary }, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify({ output_directory: outputDirectory, raw_results: rawPath, models: summary }, null, 2) + "\n");
}

module.exports = {
  REQUESTED_MAX_OUTPUT_TOKENS,
  SYNTHETIC_PUBLIC_FIXTURE,
  EVIDENCE_LANE_ORDER,
  assertPrivateOutput,
  aggregateUsage,
  applyPricingRate,
  calculatedCostFromUsage,
  loadPricingMetadata,
  makePrompt,
  pricingRateFor,
  providerRequestBodies,
  resolveProviderFocus,
  stableEvidenceRows,
  usageFrom,
  validateSuite
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[benchmark] fatal: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
