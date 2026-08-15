"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const repoRoot = path.resolve(__dirname, "..");
const publicRoot = path.join(repoRoot, "public-share");
const PUBLIC_RESULTS_PATH = "docs/end-to-end-model-quality-results.json";
const PUBLIC_SCORECARD_PATH = "docs/model-quality-benchmark-scorecard-2026-08-09.json";
const HISTORICAL_SCORECARD_IDENTITIES = new Set([
  "openrouter\0openrouter/free\0default",
  "openrouter\0tencent/hy3\0high",
  "gemini\0gemini-3.5-flash-lite\0high",
  "openrouter\0qwen/qwen3.7-plus\0default",
  "openrouter\0xiaomi/mimo-v2.5\0default",
  "openrouter\0deepseek/deepseek-v4-flash-0731\0high",
  "openwebui\0gemma4:e4b\0default",
  "openwebui\0gemma4:26b\0default",
  "openwebui\0hf.co/HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive\0default",
  "openwebui\0hf.co/DavidAU/Qwen3.5-9B-The-Defiant-Fable-Uncensored-Heretic-NEO-IMATRIX-MAX-MTP-GGUF:IQ3_M\0default",
  "openrouter\0openai/gpt-5.6-luna\0high"
]);
const HISTORICAL_COMPLETED_WITH_FAILURES_IDENTITY = "openwebui\0gemma4:26b\0default";

const COPY_ALLOWLIST = Object.freeze([
  ".env.example",
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "docs/daily-scheduler-plan.md",
  "docs/end-to-end-model-quality-benchmark.md",
  "docs/model-quality-benchmark.md",
  "docs/model-quality-benchmark-results-2026-08-06.md",
  "docs/model-quality-benchmark-scorecard-2026-08-06.json",
  "docs/model-quality-benchmark-scorecard-2026-08-09.json",
  "main.js",
  "manifest.json",
  "scripts/build-public-share.js",
  "scripts/model-quality-benchmark-cases.json",
  "scripts/model-quality-benchmark-models.json",
  "scripts/model-quality-benchmark.js",
  "scripts/model-quality-benchmark-local-test.js",
  "scripts/merge-model-quality-runs.js",
  "scripts/openwebui-carrier-recovery-local-test.js",
  "scripts/prepare-model-quality-judging.js",
  "scripts/semantic-retrieval-local-ab.js",
  "styles.css",
  "versions.json"
]);

const GENERATED_FILES = Object.freeze({
  ".gitignore": `# Private/local state\n.env\n.env.*\n!.env.example\n/Testing/\n/public-share/\nnode_modules/\n*.log\ndata.json\nsemantic-index*.json\n*.key\n*.pem\n*.p12\n*.pfx\n*.token\n*.tokens\n*.sqlite\n*.sqlite3\n*.db\n`,
  "SECURITY.md": `# Security and privacy\n\nNever commit API keys, credentials, tokens, personally identifiable information, personal data, private vault content, local semantic indexes, raw private benchmark output, or local absolute paths. Use a synthetic fixture for public examples. Populated \`.env\`, \`Testing/\`, provider run output, Obsidian \`data.json\`, and semantic-index files are local-only.\n\nBefore publishing, run \`node scripts/build-public-share.js\` from a private development checkout and publish only the generated, reviewed \`public-share/\` tree. A scanner finding blocks publication and must not be bypassed.\n`
});

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const localUserIdentifier = String(process.env.USERNAME || process.env.USER || "").trim();
const LOCAL_IDENTITY_RULES = localUserIdentifier.length >= 3
  ? [["KNOWN_PRIVATE_USER", new RegExp(`\\b${escapeRegex(localUserIdentifier)}\\b`, "i")]]
  : [];

const RULES = Object.freeze([
  ["PRIVATE_KEY", /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/i],
  ["OPENROUTER_KEY", /\bsk-or-v1-[A-Za-z0-9_-]{20,}\b/i],
  ["OPENAI_KEY", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/i],
  ["GITHUB_TOKEN", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/i],
  ["AWS_ACCESS_KEY", /\bAKIA[0-9A-Z]{16}\b/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ["CREDENTIAL_URL", /(?:https?|wss?):\/\/[^/\s:@]+:[^/\s@]+@/i],
  ["EMAIL_ADDRESS", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ["PERSONAL_WINDOWS_PATH", /[A-Z]:\\(?:Users|Documents and Settings)\\[^\\/\s]+/i],
  ["PERSONAL_POSIX_PATH", /\/(?:Users|home)\/[^/\s]+/i],
  ...LOCAL_IDENTITY_RULES,
  ["CANADIAN_SIN", /\b\d{3}[ -]?\d{3}[ -]?\d{3}\b/],
  ["US_SSN", /\b\d{3}-\d{2}-\d{4}\b/],
  ["PHONE_NUMBER", /(?<![\w.])(?:\+?1[\s.-]?)?(?:\(?[2-9]\d{2}\)?[\s.-])\d{3}[\s.-]\d{4}(?![\w.])/],
  ["CANADIAN_POSTAL_CODE", /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ][ -]?\d[ABCEGHJ-NPRSTVWXYZ]\d\b/i],
  ["PRIVATE_ARTIFACT_CLASSIFICATION", /(?:raw-private-\x6cive-vault|private-(?:production|frozen|opaque|raw|live|benchmark)|privateLiveData\s*[":=]\s*true)/i],
  ["PRIVATE_INDEX_PAYLOAD", /"(?:embedding|vector)"\s*:\s*\[[+-]?(?:\d|\.)/i]
]);

function inside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") throw new Error("Invalid canonical public value.");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function assertSanitizedAggregate(buffer) {
  const value = JSON.parse(Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer));
  const topKeys = ["schema_version", "classification", "benchmark_date", "methodology", "reference", "results", "privacy", "payload_sha256"];
  if (!exactKeys(value, topKeys) || value.schema_version !== 1 || value.classification !== "public-sanitized-end-to-end-model-quality-results" || !/^\d{4}-\d{2}-\d{2}$/.test(value.benchmark_date) || !/^[a-f0-9]{64}$/.test(String(value.payload_sha256))) throw new Error("Sanitized benchmark aggregate top-level contract failed.");
  const preimage = { ...value }; delete preimage.payload_sha256;
  if (hash(Buffer.from(canonical(preimage), "utf8")) !== value.payload_sha256) throw new Error("Sanitized benchmark aggregate payload hash failed.");
  const methodologyKeys = ["reference", "reference_score", "score_scope", "raw_live_vault_and_production_semantic_index_used", "sanitized_or_synthetic_test_substitute_used", "oracle_contributes_quality_points", "identity_blinded_session_judging", "requested_max_output_tokens", "cases", "operations_per_case", "conditions"];
  if (!exactKeys(value.methodology, methodologyKeys) || value.methodology.reference !== "GPT-5.6 Sol High Codex session" || value.methodology.reference_score !== 100 || value.methodology.score_scope !== "final-rendered-ai-model-output-only" || value.methodology.raw_live_vault_and_production_semantic_index_used !== true || value.methodology.sanitized_or_synthetic_test_substitute_used !== false || value.methodology.oracle_contributes_quality_points !== false || value.methodology.identity_blinded_session_judging !== true || value.methodology.requested_max_output_tokens !== 12288 || value.methodology.cases !== 12 || value.methodology.operations_per_case !== 3 || value.methodology.conditions !== 2) throw new Error("Sanitized benchmark methodology contract failed.");
  if (!exactKeys(value.reference, ["provider", "model", "quality_score"]) || value.reference.provider !== "Codex session" || value.reference.model !== "GPT-5.6 Sol High" || value.reference.quality_score !== 100) throw new Error("Sanitized benchmark reference contract failed.");
  if (!exactKeys(value.privacy, ["aggregate_only", "raw_inputs_included", "raw_outputs_included", "note_names_or_paths_included", "evidence_ids_included", "credentials_included"]) || value.privacy.aggregate_only !== true || ["raw_inputs_included", "raw_outputs_included", "note_names_or_paths_included", "evidence_ids_included", "credentials_included"].some((key) => value.privacy[key] !== false)) throw new Error("Sanitized benchmark privacy contract failed.");
  if (!Array.isArray(value.results) || !value.results.length) throw new Error("Sanitized benchmark results are required.");
  const resultKeys = ["provider", "model", "reasoning_effort", "served_identity_policy", "benchmark_status", "quality_score", "quality_label", "critical_failure", "operation_scores", "completed_final_outputs", "failed_final_outputs", "expected_final_outputs", "oracle_output_quality_diagnostic", "oracle_contributes_quality_points", "causal_diagnostic_counts", "relevant_evidence_discarded_rows", "live_query_embedding_calls", "requested_max_output_tokens", "generation_usage", "generation_elapsed_seconds", "workflow_elapsed_seconds", "served_models_observed"];
  const operations = ["chat", "task_plan", "task_description"];
  const causes = ["none", "retrieval-or-index", "context-selection-or-projection", "generation-reasoning-or-writing", "schema-or-render", "mixed", "indeterminate"];
  const usageKeys = new Set(["inputTokens", "cachedInputTokens", "cacheWriteTokens", "outputTokens", "reasoningTokens", "totalTokens"]);
  const labels = new Set(["fully-meets-final-output-requirement", "high-quality-with-measured-gap", "material-improvement-required", "substantial-gaps", "unreliable-final-output"]);
  const finiteRange = (number, minimum, maximum) => Number.isFinite(number) && number >= minimum && number <= maximum;
  for (const row of value.results) {
    if (!exactKeys(row, resultKeys) || typeof row.provider !== "string" || !row.provider || typeof row.model !== "string" || !row.model || typeof row.reasoning_effort !== "string" || !["exact", "provider-managed-dynamic-route"].includes(row.served_identity_policy) || !["completed", "failed"].includes(row.benchmark_status) || !finiteRange(row.quality_score, 0, 100) || !labels.has(row.quality_label) || typeof row.critical_failure !== "boolean") throw new Error("Sanitized benchmark result identity or score contract failed.");
    if (!exactKeys(row.operation_scores, operations) || operations.some((key) => !finiteRange(row.operation_scores[key], 0, 100))) throw new Error("Sanitized benchmark operation-score contract failed.");
    for (const key of ["completed_final_outputs", "failed_final_outputs", "expected_final_outputs", "relevant_evidence_discarded_rows", "live_query_embedding_calls", "requested_max_output_tokens"]) if (!Number.isInteger(row[key]) || row[key] < 0) throw new Error("Sanitized benchmark count contract failed.");
    if (row.completed_final_outputs + row.failed_final_outputs !== row.expected_final_outputs || row.expected_final_outputs !== 36 || row.requested_max_output_tokens !== 12288 || !finiteRange(row.oracle_output_quality_diagnostic, 0, 100) || row.oracle_contributes_quality_points !== false || !finiteRange(row.generation_elapsed_seconds, 0, Number.MAX_SAFE_INTEGER) || !finiteRange(row.workflow_elapsed_seconds, 0, Number.MAX_SAFE_INTEGER)) throw new Error("Sanitized benchmark aggregate metric contract failed.");
    if (!exactKeys(row.causal_diagnostic_counts, causes) || causes.some((key) => !Number.isInteger(row.causal_diagnostic_counts[key]) || row.causal_diagnostic_counts[key] < 0) || Object.values(row.causal_diagnostic_counts).reduce((sum, count) => sum + count, 0) !== 36) throw new Error("Sanitized benchmark causal-diagnostic contract failed.");
    if (!(row.generation_usage === null || (row.generation_usage && typeof row.generation_usage === "object" && !Array.isArray(row.generation_usage) && Object.keys(row.generation_usage).every((key) => usageKeys.has(key) && Number.isFinite(row.generation_usage[key]) && row.generation_usage[key] >= 0)))) throw new Error("Sanitized benchmark usage contract failed.");
    if (!Array.isArray(row.served_models_observed) || row.served_models_observed.some((item) => typeof item !== "string" || !item)) throw new Error("Sanitized benchmark served-model contract failed.");
  }
  return value;
}

function assertSanitizedBenchmarkScorecard(buffer) {
  const value = JSON.parse(Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer));
  const topKeys = ["schema_version", "classification", "benchmark_date", "publishable", "privacy_reviewed", "reference", "benchmark", "scoring", "results", "current_code_validation"];
  if (!exactKeys(value, topKeys)
    || value.schema_version !== 2
    || value.classification !== "sanitized-public-raw-live-model-quality-benchmark-scorecard"
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(value.benchmark_date || ""))
    || value.publishable !== true
    || value.privacy_reviewed !== true) throw new Error("Sanitized benchmark scorecard top-level contract failed.");
  if (!exactKeys(value.reference, ["label", "quality_score", "scope"])
    || value.reference.label !== "Codex GPT-5.6 Sol (high) judging-session reference"
    || value.reference.quality_score !== 100
    || value.reference.scope !== "final-rendered-ai-model-output-only") throw new Error("Sanitized benchmark scorecard reference contract failed.");

  const benchmarkKeys = ["private_live_note_count", "configured_action_scopes_per_note", "candidate_count", "operation_rows", "condition_count", "repetitions", "requested_max_output_tokens", "maximum_generation_requests_per_logical_operation", "semantic_index_record_count", "retrieval_ready_clean_rows", "retrieval_ready_quarantined_rows", "retrieval_nondegraded_rows", "hauhau_quarantined_task_reference_record_count", "degraded_retrieval_rows", "full_index_scan_count"];
  const benchmark = value.benchmark;
  if (!exactKeys(benchmark, benchmarkKeys)
    || benchmark.private_live_note_count !== 2
    || benchmark.configured_action_scopes_per_note !== 6
    || benchmark.candidate_count !== 11
    || benchmark.operation_rows !== 66
    || benchmark.condition_count !== 1
    || benchmark.repetitions !== 1
    || benchmark.requested_max_output_tokens !== 12288
    || benchmark.maximum_generation_requests_per_logical_operation !== 2
    || !Number.isInteger(benchmark.semantic_index_record_count) || benchmark.semantic_index_record_count <= 0
    || benchmark.retrieval_ready_clean_rows !== 54
    || benchmark.retrieval_ready_quarantined_rows !== 12
    || benchmark.retrieval_nondegraded_rows !== 66
    || benchmark.hauhau_quarantined_task_reference_record_count !== 7
    || benchmark.degraded_retrieval_rows !== 0
    || benchmark.full_index_scan_count !== 0) throw new Error("Sanitized benchmark scorecard benchmark contract failed.");

  const scoringKeys = ["aggregation", "criteria", "substantive_irrelevance_policy", "safely_repairable_mechanical_policy", "terminal_model_output_policy", "infrastructure_failure_policy", "comparative_cohort_judgments_sealed_before_identity_unblind", "targeted_luna_identity_blinded", "primary_reference_session_scored_all_available_final_outputs"];
  const expectedCriteria = ["intent_fidelity", "factual_accuracy", "relevance", "completeness_and_actionability", "clarity_and_usability"];
  if (!exactKeys(value.scoring, scoringKeys)
    || value.scoring.aggregation !== "normalize-each-operation-across-eligible-note-rows-then-equal-macro-average-non-null-operations"
    || JSON.stringify(value.scoring.criteria) !== JSON.stringify(expectedCriteria)
    || value.scoring.substantive_irrelevance_policy !== "reduces-intent-and-relevance-quality"
    || value.scoring.safely_repairable_mechanical_policy !== "no-quality-point-effect"
    || value.scoring.terminal_model_output_policy !== "eligible-zero"
    || value.scoring.infrastructure_failure_policy !== "excluded-from-model-quality-denominator"
    || value.scoring.comparative_cohort_judgments_sealed_before_identity_unblind !== true
    || value.scoring.targeted_luna_identity_blinded !== true
    || value.scoring.primary_reference_session_scored_all_available_final_outputs !== true) throw new Error("Sanitized benchmark scorecard scoring contract failed.");

  const resultKeys = ["provider", "model", "reasoning_effort", "benchmark_status", "quality_score", "operation_scores", "rendered_outputs", "expected_outputs", "model_output_zeroes", "infrastructure_excluded", "generation_attempts", "total_input_tokens", "total_output_tokens", "token_usage_complete", "total_api_cost_usd", "api_cost_basis", "lane_wall_seconds", "critical_failure", "summary_assessment"];
  const operationKeys = ["chat", "task_plan", "task_description"];
  if (!Array.isArray(value.results) || value.results.length !== HISTORICAL_SCORECARD_IDENTITIES.size) throw new Error("Sanitized benchmark scorecard result count failed.");
  const identities = new Set();
  let rendered = 0; let modelZeroes = 0; let infrastructure = 0; let historicalUnclassified = 0;
  for (const row of value.results) {
    const identity = `${row?.provider}\0${row?.model}\0${row?.reasoning_effort}`;
    if (!exactKeys(row, resultKeys) || !HISTORICAL_SCORECARD_IDENTITIES.has(identity) || identities.has(identity)) throw new Error("Sanitized benchmark scorecard result identity contract failed.");
    identities.add(identity);
    const isHistoricalCompletedWithFailures = identity === HISTORICAL_COMPLETED_WITH_FAILURES_IDENTITY;
    const expectedStatus = isHistoricalCompletedWithFailures ? "completed-with-failures" : (row.infrastructure_excluded > 0 ? "completed-partial" : "completed");
    if (row.benchmark_status !== expectedStatus
      || !Number.isFinite(row.quality_score) || row.quality_score < 0 || row.quality_score > 100
      || !exactKeys(row.operation_scores, operationKeys)
      || operationKeys.some((key) => row.operation_scores[key] !== null && (!Number.isFinite(row.operation_scores[key]) || row.operation_scores[key] < 0 || row.operation_scores[key] > 100))
      || !Number.isInteger(row.rendered_outputs) || row.rendered_outputs < 0 || row.rendered_outputs > 6
      || row.expected_outputs !== 6
      || !Number.isInteger(row.model_output_zeroes) || row.model_output_zeroes < 0 || row.model_output_zeroes > 6
      || !Number.isInteger(row.infrastructure_excluded) || row.infrastructure_excluded < 0 || row.infrastructure_excluded > 6
      || (isHistoricalCompletedWithFailures
        ? row.rendered_outputs !== 1 || row.model_output_zeroes !== 0 || row.infrastructure_excluded !== 0
        : row.rendered_outputs + row.model_output_zeroes + row.infrastructure_excluded !== 6)
      || !Number.isInteger(row.generation_attempts) || row.generation_attempts < 0
      || (row.total_input_tokens !== null && (!Number.isInteger(row.total_input_tokens) || row.total_input_tokens < 0))
      || (row.total_output_tokens !== null && (!Number.isInteger(row.total_output_tokens) || row.total_output_tokens < 0))
      || (row.total_input_tokens === null) !== (row.total_output_tokens === null)
      || typeof row.token_usage_complete !== "boolean"
      || (row.token_usage_complete && row.total_input_tokens === null)
      || (row.total_api_cost_usd !== null && (!Number.isFinite(row.total_api_cost_usd) || row.total_api_cost_usd < 0))
      || !["openrouter-catalog-rate-estimate", "openrouter-catalog-rate-lower-bound", "openrouter-free-route", "local-no-api-charge", "unavailable-provider-usage"].includes(row.api_cost_basis)
      || (row.api_cost_basis === "openrouter-catalog-rate-estimate" && (!row.token_usage_complete || row.total_api_cost_usd === null))
      || (row.api_cost_basis === "openrouter-catalog-rate-lower-bound" && (row.token_usage_complete || row.total_api_cost_usd === null))
      || (["openrouter-free-route", "local-no-api-charge"].includes(row.api_cost_basis) && row.total_api_cost_usd !== 0)
      || (row.api_cost_basis === "unavailable-provider-usage" && (row.total_input_tokens !== null || row.total_api_cost_usd !== null))
      || !Number.isFinite(row.lane_wall_seconds) || row.lane_wall_seconds < 0
      || typeof row.critical_failure !== "boolean"
      || typeof row.summary_assessment !== "string" || row.summary_assessment.length < 20 || row.summary_assessment.length > (isHistoricalCompletedWithFailures ? 1000 : 500)) throw new Error("Sanitized benchmark scorecard result metric contract failed.");
    const eligibleOperationScores = operationKeys.map((key) => row.operation_scores[key]).filter(Number.isFinite);
    const derivedQuality = eligibleOperationScores.length ? eligibleOperationScores.reduce((sum, score) => sum + score, 0) / eligibleOperationScores.length : null;
    if (derivedQuality === null || Math.abs(row.quality_score - derivedQuality) > 1e-9) throw new Error("Sanitized benchmark scorecard quality arithmetic failed.");
    rendered += row.rendered_outputs; modelZeroes += row.model_output_zeroes; infrastructure += row.infrastructure_excluded;
    if (isHistoricalCompletedWithFailures) historicalUnclassified += row.expected_outputs - row.rendered_outputs - row.model_output_zeroes - row.infrastructure_excluded;
  }
  if (identities.size !== HISTORICAL_SCORECARD_IDENTITIES.size
    || rendered !== 56 || modelZeroes !== 1 || infrastructure !== 4 || historicalUnclassified !== 5
    || rendered + modelZeroes + infrastructure + historicalUnclassified !== HISTORICAL_SCORECARD_IDENTITIES.size * 6) throw new Error("Sanitized benchmark scorecard aggregate arithmetic failed.");

  const validationKeys = ["actual_plugin_functions", "raw_live_vault_validation", "rendered_output_rows", "model_output_terminal_rows", "provider_adapter_infrastructure_rows", "plugin_workflow_infrastructure_rows", "targeted_luna_transport_fix_validated_in_obsidian", "targeted_luna_plugin_run_completed", "targeted_luna_generation_attempts", "targeted_luna_wall_seconds", "targeted_luna_provider_status", "targeted_luna_no_retry", "targeted_hauhau_exact_profile_validated_in_obsidian", "targeted_hauhau_plugin_run_completed", "targeted_hauhau_generation_attempts", "targeted_hauhau_wall_seconds", "targeted_hauhau_provider_status", "targeted_hauhau_no_retry", "targeted_hauhau_token_usage_complete", "targeted_gemma26_exact_profile_validated_in_obsidian", "targeted_gemma26_plugin_run_completed", "targeted_gemma26_generation_attempts", "targeted_gemma26_wall_seconds", "targeted_gemma26_provider_status", "targeted_gemma26_model_output_zeroes", "targeted_gemma26_rendered_outputs", "targeted_gemma26_retry_count", "targeted_gemma26_terminal_errors", "targeted_gemma26_token_usage_complete", "substantially_irrelevant_rendered_rows", "safely_repairable_mechanical_quality_penalties"];
  const validation = value.current_code_validation;
  if (!exactKeys(validation, validationKeys)
    || validation.actual_plugin_functions !== true
    || validation.raw_live_vault_validation !== true
    || validation.rendered_output_rows !== rendered + historicalUnclassified
    || validation.model_output_terminal_rows !== modelZeroes
    || validation.provider_adapter_infrastructure_rows !== infrastructure
    || validation.plugin_workflow_infrastructure_rows !== 0
    || validation.targeted_luna_transport_fix_validated_in_obsidian !== true
    || validation.targeted_luna_plugin_run_completed !== true
    || validation.targeted_luna_generation_attempts !== 26
    || !Number.isFinite(validation.targeted_luna_wall_seconds) || validation.targeted_luna_wall_seconds < 0
    || validation.targeted_luna_provider_status !== "completed"
    || validation.targeted_luna_no_retry !== true
    || validation.targeted_hauhau_exact_profile_validated_in_obsidian !== true
    || validation.targeted_hauhau_plugin_run_completed !== true
    || validation.targeted_hauhau_generation_attempts !== 26
    || !Number.isFinite(validation.targeted_hauhau_wall_seconds) || validation.targeted_hauhau_wall_seconds < 0
    || validation.targeted_hauhau_provider_status !== "completed"
    || validation.targeted_hauhau_no_retry !== true
    || validation.targeted_hauhau_token_usage_complete !== true
    || validation.targeted_gemma26_exact_profile_validated_in_obsidian !== true
    || validation.targeted_gemma26_plugin_run_completed !== true
    || validation.targeted_gemma26_generation_attempts !== 26
    || !Number.isFinite(validation.targeted_gemma26_wall_seconds) || validation.targeted_gemma26_wall_seconds < 0
    || validation.targeted_gemma26_provider_status !== "completed"
    || validation.targeted_gemma26_model_output_zeroes !== 0
    || validation.targeted_gemma26_rendered_outputs !== 6
    || validation.targeted_gemma26_retry_count !== 0
    || validation.targeted_gemma26_terminal_errors !== 0
    || validation.targeted_gemma26_token_usage_complete !== false
    || validation.substantially_irrelevant_rendered_rows !== 2
    || validation.safely_repairable_mechanical_quality_penalties !== 0) throw new Error("Sanitized benchmark scorecard validation aggregate contract failed.");
  return value;
}

function fail(message) {
  process.stderr.write(`[public-share] ${message}\n`);
  process.exitCode = 1;
}

function assertSource(relativePath) {
  const source = path.resolve(repoRoot, relativePath);
  if (!inside(repoRoot, source) || inside(publicRoot, source)) throw new Error(`Unsafe allowlist path: ${relativePath}`);
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Allowlisted source is not a regular file: ${relativePath}`);
  return source;
}

function assertExistingPublicRootIsRegular(resolved) {
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Refusing public-share target that is not a regular directory.");
  const real = fs.realpathSync.native(resolved);
  const normalize = (value) => path.resolve(value).replace(/[\\/]+$/, "");
  const same = process.platform === "win32" ? normalize(real).toLowerCase() === normalize(resolved).toLowerCase() : normalize(real) === normalize(resolved);
  if (!same) throw new Error("Refusing public-share target that resolves through a reparse point.");
}

function preparePublicRoot() {
  const resolved = path.resolve(publicRoot);
  if (resolved !== path.join(repoRoot, "public-share") || !inside(repoRoot, resolved)) throw new Error("Refusing unsafe public-share target.");
  let existing = false;
  try { fs.lstatSync(resolved); existing = true; } catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (existing) {
    assertExistingPublicRootIsRegular(resolved);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  fs.mkdirSync(resolved, { recursive: true });
}

function writeRelative(relativePath, buffer) {
  const target = path.resolve(publicRoot, relativePath);
  if (!inside(publicRoot, target)) throw new Error(`Refusing target outside public-share: ${relativePath}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buffer);
}

function walkFiles(directory, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(prefix, entry.name);
    const absolutePath = path.join(directory, entry.name);
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) throw new Error(`Public stage contains a symlink/reparse point: ${relativePath}`);
    if (entry.isDirectory()) files.push(...walkFiles(absolutePath, relativePath));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`Public stage contains a non-regular entry: ${relativePath}`);
  }
  return files.sort();
}

function scanContent(relativePath, content) {
  const findings = [];
  String(content).split(/\r?\n/).forEach((line, index) => {
    for (const [ruleId, pattern] of RULES) {
      pattern.lastIndex = 0;
      if (ruleId === "EMAIL_ADDRESS" && /\b[A-Z0-9._%+-]+@example\.(?:com|org|net)\b/i.test(line)) continue;
      if (pattern.test(line)) findings.push({ rule_id: ruleId, path: relativePath, line: index + 1 });
    }
  });
  return findings;
}

function scanFile(relativePath) {
  return scanContent(relativePath, fs.readFileSync(path.join(publicRoot, relativePath), "utf8"));
}

function reportAndBlock(findings, phase) {
  if (!findings.length) return;
  for (const finding of findings) process.stderr.write(`[public-share] ${finding.rule_id} ${finding.path}:${finding.line}\n`);
  throw new Error(`Public-share ${phase} blocked publication with ${findings.length} finding(s); matched values were suppressed.`);
}

function main() {
  // Fail before deleting or populating the public stage. The post-copy scan
  // remains as defense in depth, but a disallowed source value must never be
  // written into `public-share/` even transiently.
  const sourceBuffers = new Map(COPY_ALLOWLIST.map((relativePath) => [relativePath, fs.readFileSync(assertSource(relativePath))]));
  if (sourceBuffers.has(PUBLIC_RESULTS_PATH)) assertSanitizedAggregate(sourceBuffers.get(PUBLIC_RESULTS_PATH));
  if (sourceBuffers.has(PUBLIC_SCORECARD_PATH)) assertSanitizedBenchmarkScorecard(sourceBuffers.get(PUBLIC_SCORECARD_PATH));
  const sourceFindings = [
    ...[...sourceBuffers].flatMap(([relativePath, buffer]) => scanContent(relativePath, buffer.toString("utf8"))),
    ...Object.entries(GENERATED_FILES).flatMap(([relativePath, content]) => scanContent(relativePath, content))
  ];
  reportAndBlock(sourceFindings, "source preflight");

  preparePublicRoot();
  for (const relativePath of COPY_ALLOWLIST) writeRelative(relativePath, sourceBuffers.get(relativePath));
  for (const [relativePath, content] of Object.entries(GENERATED_FILES)) writeRelative(relativePath, Buffer.from(content, "utf8"));

  const expected = [...COPY_ALLOWLIST, ...Object.keys(GENERATED_FILES)].sort();
  const actual = walkFiles(publicRoot);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Public stage membership differs from the exact allowlist.");

  const findings = actual.flatMap(scanFile);
  reportAndBlock(findings, "post-copy scan");

  const manifest = {
    schema_version: 1,
    generated_utc: new Date().toISOString(),
    source_policy: "exact allowlist; no private Git history",
    files: actual.map((relativePath) => ({ path: relativePath, sha256: hash(fs.readFileSync(path.join(publicRoot, relativePath))) })),
    scan: { findings: 0, value_suppressed: true, rules: RULES.map(([ruleId]) => ruleId) }
  };
  writeRelative("PUBLIC-SHARE-MANIFEST.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8"));
  const finalFiles = walkFiles(publicRoot);
  const finalExpected = [...expected, "PUBLIC-SHARE-MANIFEST.json"].sort();
  if (JSON.stringify(finalFiles) !== JSON.stringify(finalExpected)) throw new Error("Final public stage membership differs from the manifest contract.");
  process.stdout.write(JSON.stringify({ public_root: publicRoot, files: finalFiles.length, scan_findings: 0 }, null, 2) + "\n");
}

if (require.main === module) {
  try { main(); } catch (error) { fail(String(error?.message || error)); }
}

module.exports = { COPY_ALLOWLIST, GENERATED_FILES, HISTORICAL_COMPLETED_WITH_FAILURES_IDENTITY, HISTORICAL_SCORECARD_IDENTITIES, PUBLIC_RESULTS_PATH, PUBLIC_SCORECARD_PATH, RULES, assertExistingPublicRootIsRegular, assertSanitizedAggregate, assertSanitizedBenchmarkScorecard, canonical, main, preparePublicRoot, reportAndBlock, scanContent };
