"use strict";

const path = require("path");
const Module = require("module");

const originalLoad = Module._load;
const EVIDENCE_CLASS = "synthetic-functional-only";
let blockedNetworkCallAttempts = 0;
const obsidianRequestUrl = () => { blockedNetworkCallAttempts += 1; throw new Error("Network disabled in local OpenWebUI carrier-recovery test."); };
Module._load = function(request, parent, isMain) {
  if (request !== "obsidian") return originalLoad.call(this, request, parent, isMain);
  class Empty {}
  return {
    ItemView: Empty,
    MarkdownRenderer: {},
    MarkdownView: Empty,
    Modal: Empty,
    Notice: Empty,
    Plugin: Empty,
    PluginSettingTab: Empty,
    Setting: Empty,
    TFile: Empty,
    setIcon() {},
    requestUrl: obsidianRequestUrl
  };
};
global.window = global;
global.fetch = async () => { blockedNetworkCallAttempts += 1; throw new Error("Network disabled in local OpenWebUI carrier-recovery test."); };

const Plugin = require(path.join(__dirname, "..", "main.js"));
const providers = Plugin.__multiProvider;
const gateway = Plugin.__aiModelGateway;
const semantic = Plugin.__semanticRetrieval;
let passedAssertions = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passedAssertions += 1;
}

assert(semantic.chatSemanticLexicalSeedQueryEligible("what was my last meeting with Jim about?"), "Named-person chat queries must enable bounded lexical seed recovery alongside the live semantic query embedding.");
assert(semantic.chatSemanticLexicalSeedQueryEligible("what is the status of project-x?"), "Distinctive keyword chat queries must enable bounded lexical seed recovery alongside the live semantic query embedding.");
assert(!semantic.chatSemanticLexicalSeedQueryEligible("what was the meeting?"), "A query containing only generic terms must not trigger broad lexical recovery.");
const hybridSeedEvidenceIds = semantic.chatSemanticLexicalSeedEvidenceIds("what was my last meeting with Jim about?", [
  { sourceEvidenceIds: ["synthetic-jim-1", "synthetic-jim-2"] },
  { sourceEvidenceIds: ["synthetic-jim-2", "synthetic-jim-3"] }
]);
assert(JSON.stringify(hybridSeedEvidenceIds) === JSON.stringify(["synthetic-jim-1", "synthetic-jim-2", "synthetic-jim-3"]), "Lexical seed evidence IDs must remain deduplicated and bounded before semantic routing.");
const hybridAdmission = semantic.chatSemanticAdmissionPool([
  { evidenceId: "synthetic-keyword-match", text: "Project-x status", semantic: 0.05, lexicalSeedReserved: true },
  { evidenceId: "synthetic-semantic-match", text: "Unrelated semantic neighbor", semantic: 0.95 }
], 1, { mode: "chat", intent: "focused", broad: false, history: false, tasks: false, portfolio: false });
assert(hybridAdmission.protectedEvidenceIds.includes("synthetic-keyword-match") && hybridAdmission.reservedEvidenceIds.includes("synthetic-keyword-match"), "Lexical keyword matches must remain protected through chat evidence admission while semantic ranking remains available.");

function retry(overrides = {}, profile = "local-schema-compatibility-json", cachedDirectJson = true) {
  const providerError = {
    provider: "openwebui",
    status: 200,
    code: "invalid-response",
    providerDiagnostic: { classification: "content", responseShape: "normalized-content" },
    ...overrides
  };
  return providers.openWebUICachedJsonAlternateCarrierRetryEligible(
    { providerError },
    null,
    profile,
    { cachedDirectJson, ollamaBacked: true }
  );
}

let nullResponseError = null;
try { gateway.openWebUIResponseNormalize(null); } catch (error) { nullResponseError = error; }
assert(Boolean(nullResponseError) && nullResponseError?.name !== "ReferenceError", "A missing OpenWebUI response must fail through the provider error path instead of an undeclared-variable error.");
assert(retry(), "A cached direct-JSON HTTP-200 schema failure must receive one alternate-carrier recovery attempt.");
assert(retry({ code: "invalid-json-content" }), "Malformed JSON content must be eligible for alternate-carrier recovery.");
assert(retry({ code: "schema-pattern-mismatch", providerDiagnostic: { classification: "schema", responseShape: "normalized-content" } }), "A schema-pattern mismatch must be eligible for alternate-carrier recovery.");
assert(!retry({ code: "auth-required", providerDiagnostic: { classification: "auth" } }), "Authentication failures must never trigger carrier recovery.");
assert(!retry({ code: "invalid-response", providerDiagnostic: { classification: "context", contextLimit: true } }), "Context-limit failures must never trigger carrier recovery.");
assert(!retry({ code: "invalid-response", providerDiagnostic: { classification: "model-not-found", modelNotFound: true } }), "Model lookup failures must never trigger carrier recovery.");
assert(!retry({ code: "attempt-timeout", providerDiagnostic: { classification: "transport" } }), "Timeout failures must never trigger carrier recovery.");
assert(!retry({ code: "transport", providerDiagnostic: { classification: "transport", transport: "abort" } }), "Transport aborts must never trigger carrier recovery.");
assert(!retry({ code: "invalid-response", providerDiagnostic: { classification: "content", draining: true } }), "Draining responses must never trigger carrier recovery.");
assert(!retry({}, "strict-native-schema"), "Only the learned direct-JSON compatibility profile may use this recovery path.");
assert(!retry({}, "local-schema-compatibility-json", false), "The recovery path must require an explicitly cached direct-JSON carrier.");
const mixedValidationResponse = { status: 400, json: { detail: "Request validation failed while checking upstream connection metadata." } };
const mixedValidationClassification = providers.classifyOpenWebUIError(mixedValidationResponse);
assert(mixedValidationClassification.code === "request-validation" && mixedValidationClassification.diagnostic.classification === "validation" && mixedValidationClassification.diagnostic.httpResponseObserved === true, "A settled HTTP 400 request-validation response must not be mislabeled as a transport failure merely because its bounded metadata mentions an upstream connection.");
const promptGroundedCarrierAdmission = providers.openWebUIUnsupportedSchemaCarrierRepairAdmission({ providerError: {
  provider: "openwebui",
  status: 400,
  code: "request-validation",
  providerDiagnostic: mixedValidationClassification.diagnostic
} }, mixedValidationResponse, {
  ollamaBacked: true,
  model: "hf.co/davidau/qwen3.5-9b-the-defiant-fable-uncensored-heretic-neo-imatrix-max-mtp-gguf:iq3_m",
  nativeDescription: false,
  promptGroundedJsonOnly: true,
  attemptCarrier: "direct-json",
  schemaPresent: true,
  schemaFingerprint: "synthetic-fingerprint",
  alreadyAttempted: false,
  attemptOrdinal: 1,
  maxAttempts: 2
});
assert(promptGroundedCarrierAdmission.admitted === false, "An exact prompt-grounded JSON profile must keep HTTP 400 request validation terminal instead of reintroducing an unsupported native schema carrier.");
const staleModelRepair = providers.repairGenerationModelReferences({
  openwebuiBaseUrl: "https://synthetic.invalid",
  openwebuiApiKey: "synthetic-key",
  aiModelProvider: "openwebui",
  chatModel: "stale-model",
  aiOperationModels: { "chat-query": { primary: { provider: "openwebui", model: "stale-model" } } },
  enableMultiProviderOperationModels: false,
  availableOpenWebUIModels: ["live-model"],
  openwebuiModelMetadata: { "live-model": { roleCapabilities: { generation: true, embedding: false, source: "synthetic-discovery" } } },
  manualProviderGenerationModels: { openwebui: [] }
}, "openwebui");
assert(staleModelRepair.changed && staleModelRepair.settings.aiOperationModels["chat-query"].primary.model === "live-model" && staleModelRepair.diagnostics.repaired[0]?.reason === "stale-model", "A refreshed Open WebUI catalog must repair a removed selected model instead of preserving a stale ID for the next generation request.");
const liveUnknownCapabilityPreservation = providers.repairGenerationModelReferences({
  openwebuiBaseUrl: "https://synthetic.invalid",
  openwebuiApiKey: "synthetic-key",
  aiModelProvider: "openwebui",
  chatModel: "live-unknown-model",
  aiOperationModels: { "chat-query": { primary: { provider: "openwebui", model: "live-unknown-model" } } },
  enableMultiProviderOperationModels: false,
  availableOpenWebUIModels: ["live-unknown-model", "known-generation-model"],
  openwebuiModelMetadata: { "known-generation-model": { roleCapabilities: { generation: true, embedding: false, source: "synthetic-discovery" } } },
  manualProviderGenerationModels: { openwebui: [] }
}, "openwebui");
assert(!liveUnknownCapabilityPreservation.changed && liveUnknownCapabilityPreservation.settings.aiOperationModels["chat-query"].primary.model === "live-unknown-model", "A live Open WebUI model with undisclosed role capabilities must remain selected during refresh instead of being replaced by the first explicitly classified generation model.");
const apiIdentifierAliasRepair = providers.repairGenerationModelReferences({
  openwebuiBaseUrl: "https://synthetic.invalid",
  openwebuiApiKey: "synthetic-key",
  aiModelProvider: "openwebui",
  chatModel: "gemma-4-26B-A4B-it-MXFP4_MOE.gguf",
  aiOperationModels: { "chat-query": { primary: { provider: "openwebui", model: "gemma-4-26B-A4B-it-MXFP4_MOE.gguf" } } },
  enableMultiProviderOperationModels: false,
  availableOpenWebUIModels: ["arena-model", "/models/gemma-4-26B-A4B-it-MXFP4_MOE.gguf"],
  openwebuiModelMetadata: {},
  manualProviderGenerationModels: { openwebui: [] }
}, "openwebui");
assert(apiIdentifierAliasRepair.changed
  && apiIdentifierAliasRepair.settings.aiOperationModels["chat-query"].primary.model === "/models/gemma-4-26B-A4B-it-MXFP4_MOE.gguf",
"A previously saved Open WebUI display-name selection must repair to the matching callable /models/{id} API identifier instead of an unrelated first catalog row.");
const modelNotFoundMessage = gateway.aiGatewayUserErrorMessage("openwebui", 400, "model-not-found", { modelNotFound: true });
assert(modelNotFoundMessage.includes("could not find the selected model") && modelNotFoundMessage.includes("Refresh the Open WebUI model list"), "Open WebUI model lookup failures must point to model discovery and selection instead of being mislabeled as schema failures.");
assert(providers.providerDiscoveryRetryEligible({ providerError: { status: 503, code: "transport", retryable: true, providerDiagnostic: { classification: "transport" } } }) === true, "A transient provider discovery transport failure must be eligible for one bounded retry.");
assert(providers.providerDiscoveryRetryEligible({ providerError: { status: 400, code: "request-validation", providerDiagnostic: { classification: "validation" } } }) === false, "Provider discovery request validation must remain terminal and must not be retried.");
const emptyWebSchema = gateway.chatResponseSchema(3, [], "concise");
const emptyWebEvidenceSchema = emptyWebSchema.properties.claims.items.properties.evidence_ids;
assert(emptyWebEvidenceSchema.maxItems === 1 && JSON.stringify(emptyWebEvidenceSchema.items.enum) === JSON.stringify(["__no_evidence__"]), "An empty-evidence web schema must avoid a provider-rejected zero-cardinality array while exposing only the impossible sentinel.");
assert(emptyWebSchema.required.includes("research_subject"), "The concise web schema must retain its research subject contract.");
const groundedWebSchema = gateway.chatResponseSchema(3, ["web:official-source"], "concise");
assert(JSON.stringify(groundedWebSchema.properties.claims.items.properties.evidence_ids.items.enum) === JSON.stringify(["web:official-source"]), "A grounded web schema must preserve the exact real evidence enum without the sentinel.");
const conversationSchema = gateway.chatResponseSchema(1, [], "conversation");
assert(conversationSchema.properties.claims.items.properties.evidence_ids.maxItems === 1, "A provider-compatible conversation schema must also avoid maxItems zero.");
assert(!groundedWebSchema.properties.claims.items.properties.category.enum.includes("conversation"), "Evidence-grounded chat schemas must not advertise the citation-free conversation category.");
assert(JSON.stringify(conversationSchema.properties.claims.items.properties.category.enum) === JSON.stringify(["conversation"]), "Standalone conversation schemas must retain their dedicated citation-free category.");
const overBoundChat = gateway.normalizeChatEvidencePayloadForValidation(JSON.stringify({
  claims: [1, 2, 3, 4].map((index) => ({
    text: `Supported fact ${index}.`,
    established: true,
    evidence_ids: [`evidence-${index}`],
    category: index < 3 ? "required" : "fact"
  }))
}), { maxClaims: 3 });
assert(overBoundChat.applied === false, "A chat response above the claim bound must remain byte-faithful and fail schema validation instead of being merged locally.");
assert(overBoundChat.value.claims.length === 4, "Strict chat validation must preserve every raw claim without structural merging.");
assert(overBoundChat.value.claims[0].category === "required", "Strict chat validation must not map a provider category alias to a canonical category.");
assert(overBoundChat.text === overBoundChat.rawText, "Strict chat validation must preserve the exact provider text carrier.");
assert(overBoundChat.corrections.length === 0, "Strict chat validation must emit no structural-repair telemetry.");
const unsupportedOverBoundChat = gateway.normalizeChatEvidencePayloadForValidation(JSON.stringify({
  claims: [1, 2, 3, 4].map((index) => ({
    text: `Missing element ${index}.`,
    established: false,
    evidence_ids: [],
    category: "unsupported"
  }))
}), { maxClaims: 3 });
assert(unsupportedOverBoundChat.applied === false, "Unsupported or unestablished claims must never be semantically merged by structural recovery.");
const multipleUnsupportedValidation = gateway.validateChatEvidencePayload({ claims: unsupportedOverBoundChat.value.claims.slice(0, 2) }, { mode: "off" });
assert(multipleUnsupportedValidation.valid === true, "Multiple distinct unsupported findings must remain renderable instead of failing the entire final-output schema.");
assert(multipleUnsupportedValidation.unsupportedParagraphCount === 2, "Validation may retain distinct missing elements without collapsing them.");
const contradictorySupportedCategory = gateway.normalizeChatEvidencePayloadForValidation(JSON.stringify({
  claims: [{
    text: "Grounded content with a contradictory category.",
    established: true,
    evidence_ids: ["evidence-grounded"],
    category: "unsupported"
  }]
}));
assert(contradictorySupportedCategory.applied === false, "A cited established claim with an unsupported category must fail closed instead of receiving local structural normalization.");
assert(contradictorySupportedCategory.value.claims[0].category === "unsupported", "Strict validation must preserve the contradictory provider category for rejection.");
assert(contradictorySupportedCategory.value.claims[0].text === "Grounded content with a contradictory category.", "Structural category repair must preserve provider text exactly.");
assert(JSON.stringify(contradictorySupportedCategory.value.claims[0].evidence_ids) === JSON.stringify(["evidence-grounded"]), "Structural category repair must preserve provider citations exactly.");
assert(contradictorySupportedCategory.corrections.length === 0, "Strict validation must emit no category-repair telemetry.");
assert(gateway.stripChatEvidenceIdMentions(
  "Grounded statement (ev:alpha). Follow-up uses `evidence-beta` and web:gamma.",
  ["ev:alpha", "evidence-beta", "web:gamma"]
) === "Grounded statement. Follow-up uses and.", "Exact allowed evidence identifiers must be removed from rendered prose while surrounding content is preserved.");
assert(gateway.stripChatEvidenceIdMentions(
  "The literal ev:not-allowed remains part of the user's content.",
  ["ev:allowed-only"]
) === "The literal ev:not-allowed remains part of the user's content.", "Renderer cleanup must never remove identifiers outside the exact allowed ledger.");
const schemaDiagnostic = gateway.openAiStrictSchemaDiagnostic(
  emptyWebSchema,
  "Invalid schema: In context=(), 'required' must include every key. Missing 'research_subject'."
);
assert(schemaDiagnostic.missingRequired === "research_subject", "OpenAI schema diagnostics must isolate the provider-reported missing required field without retaining prose.");
assert(schemaDiagnostic.rootRequiredCoverageValid === true, "OpenAI schema diagnostics must independently report valid local root required-field coverage.");
assert(JSON.stringify(schemaDiagnostic.rootProperties) === JSON.stringify(["claims", "research_subject"]), "OpenAI schema diagnostics must expose only bounded root property names.");
assert(JSON.stringify(schemaDiagnostic.rootRequired) === JSON.stringify(["claims", "research_subject"]), "OpenAI schema diagnostics must expose only bounded root required names.");
const deepAnalysisSchema = gateway.deepResearchAnalysisSchema(["web:official-source"], { mode: "deep" });
const deepAnalysisDiagnostic = gateway.openAiStrictSchemaDiagnostic(deepAnalysisSchema, "");
assert(deepAnalysisDiagnostic.rootRequiredCoverageValid === true, "The deep-research analysis schema must require every declared root property for strict OpenAI structured output.");
assert(deepAnalysisSchema.required.includes("unresolved"), "The deep-research analysis schema must require the unresolved field it declares.");
assert(deepAnalysisSchema.properties.additional_evidence_requests.properties.web_queries.maxItems === 1, "The closed web-query lane must avoid a provider-rejected zero-cardinality array schema.");
assert(JSON.stringify(deepAnalysisSchema.properties.additional_evidence_requests.properties.web_queries.items.enum) === JSON.stringify(["__no_query__"]), "The closed web-query lane must expose only its impossible provider-compatibility sentinel.");
const groupedContract = {
  valid: true,
  contractHash: "synthetic-contract",
  expectedIndex: 0,
  taskId: "task-1",
  scopeId: "scope-1",
  allowedFactIds: ["fact-1", "fact-2", "fact-3", "fact-4"],
  allowedEvidenceIds: ["evidence-1", "evidence-2"],
  requiredCurrentFactIds: ["fact-1"],
  requiredCurrentEvidenceIds: ["evidence-1"],
  factsById: {},
  evidenceById: {
    "evidence-1": { evidenceId: "evidence-1", scopeId: "scope-1", sourceKind: "current-source" },
    "evidence-2": { evidenceId: "evidence-2", scopeId: "scope-1" }
  },
  citationLedgerByTask: {
    "0": [
      { number: 1, section: "primary", evidenceId: "evidence-1" },
      { number: 2, section: "context", evidenceId: "evidence-2" }
    ]
  },
  factBindings: []
};
for (const [index, factId] of groupedContract.allowedFactIds.entries()) {
  const evidenceId = index < 2 ? "evidence-1" : "evidence-2";
  groupedContract.factsById[factId] = { factId, evidenceId, scopeId: "scope-1", type: "primary-context", role: "detail", sourceSurface: `${factId} surface`, current: true, authorityState: "authoritative", conflictState: "none", mandatoryFor: [] };
  groupedContract.factBindings.push({ factId, evidenceId, scopeId: "scope-1", type: "primary-context", role: "detail" });
}
const exactDescription = {
  index: 0,
  task_id: "task-1",
  scope_id: "scope-1",
  evidence_ids: ["evidence-1", "evidence-2"],
  fact_refs: ["fact-1", "fact-2", "fact-3", "fact-4"],
  description_sentences: [
    { text: "First exact sentence states fact-1 and fact-2 surfaces.", fact_refs: ["fact-1", "fact-2"], evidence_ids: ["evidence-1"] },
    { text: "Second exact sentence states fact-3 and fact-4 surfaces.", fact_refs: ["fact-3", "fact-4"], evidence_ids: ["evidence-2"] }
  ]
};
const envelope = (item) => ({ tasks: [], section_name: "", descriptions: [item] });
const replay = (payload) => gateway.replayTaskDescriptionSingletonResponse(JSON.stringify(payload), groupedContract, null);
const exactReplay = replay(envelope(exactDescription));
assert(exactReplay.valid, `An exact full-envelope task description with canonical references must remain accepted (${exactReplay.reasonCode || "unknown"}).`);
const forgedIndexDescription = JSON.parse(JSON.stringify(exactDescription));
forgedIndexDescription.index = 1;
const forgedIndexContract = JSON.parse(JSON.stringify(groupedContract));
forgedIndexContract.citationLedgerByTask["1"] = JSON.parse(JSON.stringify(forgedIndexContract.citationLedgerByTask["0"]));
const forgedIndexReplay = gateway.replayTaskDescriptionSingletonResponse(JSON.stringify(envelope(forgedIndexDescription)), forgedIndexContract, null);
assert(!forgedIndexReplay.valid && forgedIndexReplay.reasonCode === "description-response-index-mismatch", "A wrong-but-ledger-backed task-description index must fail the immutable singleton identity check before citation-ledger lookup.");
const withoutIndex = JSON.parse(JSON.stringify(exactDescription));
delete withoutIndex.index;
const withoutIndexReplay = replay(envelope(withoutIndex));
assert(withoutIndexReplay.valid
  && withoutIndexReplay.diagnostics.singletonIndexInferred === true
  && withoutIndexReplay.normalizationCorrections.includes("description-response-singleton-index-inferred"),
"A single response item with exact task/scope identity may infer its sole expected index through provider-free local normalization.");
const withoutIndexWrongTask = JSON.parse(JSON.stringify(withoutIndex));
withoutIndexWrongTask.task_id = "foreign-task";
assert(!replay(envelope(withoutIndexWrongTask)).valid, "A missing task-description index must fail closed when task identity contradicts the singleton contract.");
const withoutIndexWrongScope = JSON.parse(JSON.stringify(withoutIndex));
withoutIndexWrongScope.scope_id = "foreign-scope";
assert(!replay(envelope(withoutIndexWrongScope)).valid, "A missing task-description index must fail closed when scope identity contradicts the singleton contract.");
const separatorAlias = JSON.parse(JSON.stringify(exactDescription));
separatorAlias.fact_refs[0] = "fact_1";
separatorAlias.description_sentences[0].fact_refs[0] = "fact_1";
const separatorReplay = replay(envelope(separatorAlias));
assert(!separatorReplay.valid && separatorReplay.rawResponse.includes("fact_1") && !separatorReplay.rawResponse.includes("description-fact-ref-separator-repaired"), "A separator alias must be rejected byte-for-byte and never rewritten to a canonical fact ref.");
const crossedSentenceEvidence = JSON.parse(JSON.stringify(exactDescription));
crossedSentenceEvidence.description_sentences[0].evidence_ids = ["evidence-2"];
crossedSentenceEvidence.description_sentences[1].evidence_ids = ["evidence-1"];
assert(!replay(envelope(crossedSentenceEvidence)).valid, "Crossed sentence-local evidence must be rejected and never rebound locally.");
const swappedSentenceText = JSON.parse(JSON.stringify(exactDescription));
[swappedSentenceText.description_sentences[0].text, swappedSentenceText.description_sentences[1].text] = [swappedSentenceText.description_sentences[1].text, swappedSentenceText.description_sentences[0].text];
const swappedSentenceReplay = replay(envelope(swappedSentenceText));
assert(swappedSentenceReplay.valid
  && swappedSentenceReplay.diagnostics.nonblockingValidatorReasonCodes.includes("description-sentence-unsupported-citation"),
"A lexical fact-surface mismatch must remain visible as a nonblocking diagnostic while preserving renderable model prose for final quality judgment.");
const missingTopLevelRefs = JSON.parse(JSON.stringify(exactDescription));
delete missingTopLevelRefs.fact_refs;
assert(!replay(envelope(missingTopLevelRefs)).valid, "Missing top-level reference arrays must be rejected and never synthesized from sentence rows.");
const missingSentenceRefs = JSON.parse(JSON.stringify(exactDescription));
delete missingSentenceRefs.description_sentences[0].evidence_ids;
assert(!replay(envelope(missingSentenceRefs)).valid, "Missing sentence-local reference arrays must be rejected and never copied from top-level arrays.");
assert(!replay(exactDescription).valid, "The provider-neutral consumer replay boundary must reject a direct item; only the OpenWebUI gateway adapter may wrap an item that already passed its exact provider transport schema.");
assert(!replay({ descriptions: [exactDescription] }).valid, "A partial descriptions-only alternate envelope must be rejected instead of receiving tasks and section_name locally.");
const taskDescriptionInstruction = gateway.taskDescriptionSystemInstruction();
assert(taskDescriptionInstruction.includes("union of description_sentences[].fact_refs must exactly equal the top-level fact_refs actually stated"), "Every provider must receive the singleton description stated-fact closure audit without requiring every supplied fact to be expressed.");
assert(taskDescriptionInstruction.includes("each sentence containing fact_ref F must contain the evidenceId from executionCandidatesByFactId[F] or shared factsById[F]"), "Every provider must receive the canonical sentence-local evidence-binding audit across the task-local table and shared fallback.");
assert(taskDescriptionInstruction.includes("Never reuse one fact_ref as a placeholder for a different sentence"), "The singleton description prompt must explicitly prohibit the DeepSeek duplicate-fact carrier defect.");
const taskStructureInstruction = gateway.taskStructureSystemInstruction();
assert(taskStructureInstruction.includes("ASAP, urgent, immediately, critical, blocking, overdue, highest priority, and top priority require Todoist priority 4"), "Every task provider must receive the explicit task-local urgency-to-priority rule.");
assert(taskStructureInstruction.includes("Do not convert urgency into an invented calendar date"), "Explicit urgency must not create an unsupported due date or deadline.");
const deepSeekDescriptionBudget = gateway.aiDynamicOutputBudget({
  operation: "task-description",
  schema: gateway.taskDescriptionSchema(1, 0, { evidenceIds: ["evidence-1"], factIds: ["fact-1"], scopeIds: ["scope-1"], taskIds: ["task-1"] }),
  request: { maxOutputTokens: 12288 },
  settings: {},
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash-0731"
});
assert(deepSeekDescriptionBudget.maxOutputTokens >= 8192, "Reasoning-capable structured descriptions must not be squeezed below the 8,192-token production floor.");
assert(deepSeekDescriptionBudget.outputCeilingTokens === 12288, "Structured descriptions must retain the common 12,288-token expansion ceiling.");
const unknownOpenWebUITaskBudget = gateway.aiDynamicOutputBudget({
  operation: "task-generation",
  schema: gateway.taskStructureResponseSchema(1, 4, { evidenceIds: ["evidence-1"], factIds: ["fact-1"], scopeIds: ["scope-1"] }),
  request: { maxOutputTokens: 12288 },
  settings: { openwebuiModelMetadata: {} },
  provider: "openwebui",
  model: "gemma4:e4b",
  preflight: {
    contextWindowTokens: 0,
    hardContextWindowTokens: 0,
    contextWindowKnown: false,
    contextWindowProfiled: false,
    contextWindowExact: false,
    unknownFallbackUsed: true,
    availableInputTokens: 15999,
    operationalInputTokenLimitTokens: 15999,
    adjustedEstimatedInputTokens: 7500
  }
});
assert(unknownOpenWebUITaskBudget.insufficientCapacity === false, "An unknown OpenWebUI context window must not reinterpret its operational input fallback as a hard total-context ceiling.");
assert(unknownOpenWebUITaskBudget.maxOutputTokens === 12288, "An unknown OpenWebUI context window must remain eligible for the requested 12,288-token structured generation dispatch.");
const knownOpenWebUITaskBudget = gateway.aiDynamicOutputBudget({
  operation: "task-generation",
  schema: gateway.taskStructureResponseSchema(1, 4, { evidenceIds: ["evidence-1"], factIds: ["fact-1"], scopeIds: ["scope-1"] }),
  request: { maxOutputTokens: 12288 },
  settings: { openwebuiModelMetadata: {} },
  provider: "openwebui",
  model: "gemma4:e4b",
  preflight: {
    contextWindowTokens: 16000,
    hardContextWindowTokens: 16000,
    contextWindowKnown: true,
    contextWindowProfiled: false,
    contextWindowExact: true,
    unknownFallbackUsed: false,
    availableInputTokens: 15999,
    operationalInputTokenLimitTokens: 15999,
    adjustedEstimatedInputTokens: 7500
  }
});
assert(knownOpenWebUITaskBudget.insufficientCapacity === false, "A known hard OpenWebUI context window with about 8,500 output tokens remaining must pass the 3,072-token task-generation minimum.");
assert(knownOpenWebUITaskBudget.maxOutputTokens < 12288 && knownOpenWebUITaskBudget.maxOutputTokens >= knownOpenWebUITaskBudget.minimumUsefulOutputTokens, "Known hard capacity must clamp the requested output maximum to real remaining context without inventing an insufficiency.");
const insufficientKnownOpenWebUITaskBudget = gateway.aiDynamicOutputBudget({
  operation: "task-generation",
  schema: gateway.taskStructureResponseSchema(1, 4, { evidenceIds: ["evidence-1"], factIds: ["fact-1"], scopeIds: ["scope-1"] }),
  request: { maxOutputTokens: 12288 },
  settings: { openwebuiModelMetadata: {} },
  provider: "openwebui",
  model: "gemma4:e4b",
  preflight: {
    contextWindowTokens: 16000,
    hardContextWindowTokens: 16000,
    contextWindowKnown: true,
    contextWindowProfiled: false,
    contextWindowExact: true,
    unknownFallbackUsed: false,
    availableInputTokens: 15999,
    operationalInputTokenLimitTokens: 15999,
    adjustedEstimatedInputTokens: 14000
  }
});
assert(insufficientKnownOpenWebUITaskBudget.insufficientCapacity === true, "A known hard OpenWebUI context window must fail closed when fewer than 3,072 output tokens remain.");
assert(insufficientKnownOpenWebUITaskBudget.maxOutputTokens < insufficientKnownOpenWebUITaskBudget.minimumUsefulOutputTokens, "The insufficient known-cap control must expose an output maximum below the task-generation minimum.");
const releaseInstruction = gateway.webResearchRequestSpecificInstruction("According to official release notes, compare the latest public version with the newest early-access build.");
assert(releaseInstruction.includes("official/first-party source boundary"), "The web planner must bind an explicit official-source restriction.");
assert(releaseInstruction.includes("canonical release/changelog listing"), "The web planner must require channel-aware canonical lookup for latest-release questions.");
assert(!gateway.webResearchRequestSpecificInstruction("Explain semantic retrieval generally.").trim(), "The request-specific web planner must not add release/source constraints to unrelated questions.");
const e4bProfile = providers.openWebUIExactModelProfile("gemma4:e4b", "chat-query");
const gemma26Profile = providers.openWebUIExactModelProfile("gemma4:26b", "task-generation");
const fable9Profile = providers.openWebUIExactModelProfile("hf.co/davidau/qwen3.5-9b-the-defiant-fable-uncensored-heretic-neo-imatrix-max-mtp-gguf:iq3_m", "chat-query");
const fable27Profile = providers.openWebUIExactModelProfile("hf.co/davidau/qwen3.6-27b-fable-fusion-711-uncensored-heretic-nm-dau-neo-max-mtp-gguf:iq4_xs", "task-description");
const hauhauProfile = providers.openWebUIExactModelProfile("hf.co/hauhaucs/qwen3.6-35b-a3b-uncensored-hauhaucs-aggressive:latest", "chat-query");
assert(e4bProfile?.preferNativeStreaming === false && e4bProfile?.promptGroundedJsonOnly === false && e4bProfile?.forceNativeSchema === true && e4bProfile?.disableNativeThinking === true && e4bProfile?.enableNativeThinkingIfSupported === false && e4bProfile?.attemptDeadlineMs === 300000 && e4bProfile?.maxOutputTokens === 0 && e4bProfile?.retryMaxOutputTokens === 0, "Gemma4 E4B chat must use its compatible completed native-schema carrier with native thinking disabled, discovery-driven context capacity, and no model-specific token ceiling.");
assert(gemma26Profile?.preferNativeStreaming === false && gemma26Profile?.enableNativeThinkingIfSupported === true && gemma26Profile?.maxOutputTokens === 0 && gemma26Profile?.retryMaxOutputTokens === 0, "Gemma4 26B must retain its completed-object carrier with discovery-driven context capacity and no model-specific token ceiling.");
assert(fable9Profile?.preferNativeStreaming === false && fable9Profile?.enableNativeThinkingIfSupported === true && fable9Profile?.briefNativeThinkingRepairOnRetry === true, "The exact 9B Fable profile must retain its completed-object, discovery-gated-thinking repair carrier.");
assert(fable27Profile?.preferNativeStreaming === false && fable27Profile?.enableNativeThinkingIfSupported === true && fable27Profile?.attemptDeadlineMs === 600000, "The exact 27B Fable profile must retain its completed-object, discovery-gated-thinking carrier and deadline.");
assert(hauhauProfile?.preferNativeStreaming === false && hauhauProfile?.enableNativeThinkingIfSupported === true && hauhauProfile?.maxOutputTokens === 0, "The Hauhau :latest alias must resolve only to its completed-object profile without an invented output cap.");
assert(providers.openWebUIExactModelProfile("hf.co/davidau/qwen3.5-9b-the-defiant-fable-uncensored-heretic-near-name:iq3_m", "chat-query") === null, "A near-name Fable variant must never inherit the exact-model carrier profile.");
for (const model of ["gemma4:e4b-near", "gemma4:26b-near", "nemotron-3.5-lightning-near", "hf.co/hauhaucs/qwen3.6-35b-a3b-uncensored-hauhaucs-aggressive-near:iq4_xs"]) {
  assert(providers.openWebUIExactModelProfile(model, "chat-query") === null, `${model} must not inherit an exact OpenWebUI carrier, deadline, thinking, or output profile.`);
}
for (const response of [
  { status: 200, text: JSON.stringify({ error: "synthetic model does not support thinking" }) },
  { status: 200, json: { error: "synthetic model does not support thinking" } },
  { status: 200, text: [
      JSON.stringify({ model: "gemma4:e4b", message: { content: "" }, done: false }),
      JSON.stringify({ model: "gemma4:e4b", error: "synthetic model does not support thinking", done: true })
    ].join("\n") },
  { status: 200, text: `data: ${JSON.stringify({ error: "synthetic model does not support thinking" })}\ndata: [DONE]\n` }
]) {
  let errorEnvelopeFailure = null;
  try {
    providers.openWebUIResponseNormalize(response, "gemma4:e4b", { nativeOllama: true });
  } catch (error) { errorEnvelopeFailure = error; }
  assert(errorEnvelopeFailure?.providerError?.code === "unsupported-schema" && errorEnvelopeFailure?.providerError?.retryable === false && errorEnvelopeFailure?.providerError?.providerDiagnostic?.classification === "schema" && errorEnvelopeFailure?.providerError?.providerDiagnostic?.inBandError === true, "An HTTP-200 OpenWebUI/Ollama error envelope must remain a non-retryable sanitized provider error instead of becoming missing-done or model content.");
}

(async () => {
  const discoveryIdentifierSettings = {
    openwebuiBaseUrl: "https://synthetic.invalid",
    openwebuiAuthMode: "api-key",
    openwebuiApiKey: "synthetic-key",
    openwebuiModelMetadata: {}
  };
  const discoveryIdentifierAuth = providers.openWebUIAuth(discoveryIdentifierSettings, { requestUrl: obsidianRequestUrl });
  const discoveredIdentifierCatalog = await providers.openWebUIDiscover(discoveryIdentifierAuth, discoveryIdentifierSettings, {
    requestUrl: async (request) => {
      const pathName = new URL(request.url).pathname;
      if (pathName === "/api/models") return { status: 200, text: JSON.stringify({ data: [{ id: "/models/gemma-4-26B-A4B-it-MXFP4_MOE.gguf", name: "gemma-4-26B-A4B-it-MXFP4_MOE.gguf", owned_by: "openai" }] }) };
      if (pathName === "/ollama/api/tags") return { status: 200, text: JSON.stringify({ models: [] }) };
      throw new Error(`Unexpected synthetic discovery path: ${pathName}`);
    }
  });
  assert(discoveredIdentifierCatalog.chat.includes("/models/gemma-4-26B-A4B-it-MXFP4_MOE.gguf")
    && !discoveredIdentifierCatalog.chat.includes("gemma-4-26B-A4B-it-MXFP4_MOE.gguf"),
  "Open WebUI discovery must retain the API model identifier instead of replacing it with the row display name.");
  const discoveryPlugin = Object.create(Plugin.prototype);
  let discoveryAttempts = 0;
  discoveryPlugin.settings = { openwebuiBaseUrl: "https://synthetic.invalid", openwebuiModelMetadata: {}, availableOpenWebUIModels: [], availableOpenWebUIEmbeddingModels: [] };
  discoveryPlugin.aiModelGateway = () => ({ execute: async () => {
    discoveryAttempts += 1;
    if (discoveryAttempts === 1) {
      const error = new Error("Synthetic transient discovery failure");
      error.providerError = { provider: "openwebui", status: 503, code: "transport", retryable: true, providerDiagnostic: { classification: "transport" } };
      throw error;
    }
    return { models: { chat: ["synthetic-recovered-model"], embeddings: [], metadata: {} } };
  } });
  discoveryPlugin.applyOpenWebUIDiscovery = async () => {};
  discoveryPlugin.saveSettings = async () => false;
  discoveryPlugin.queryEmbeddingCache = new Map();
  const discoveryRefresh = await discoveryPlugin.refreshProviderModels("openwebui", false);
  assert(discoveryAttempts === 2 && discoveryRefresh.recoveredProviders.includes("openwebui") && discoveryRefresh.discoveryAttempts.openwebui === 2, "The production model-catalog refresh must make one bounded transient discovery retry and account for the recovered provider.");
  const streamSettings = {
    openwebuiBaseUrl: "https://synthetic.invalid",
    openwebuiAuthMode: "api-key",
    openwebuiApiKey: "synthetic-key",
    openwebuiModelMetadata: { "gemma4:e4b": { ollamaBacked: true } }
  };
  const auth = providers.openWebUIAuth(streamSettings, { requestUrl: obsidianRequestUrl });
  const schema = { type: "object", additionalProperties: false, properties: { answer: { type: "string" } }, required: ["answer"] };
  const normalStream = providers.openWebUIResponseNormalize({ status: 200, text: [
    JSON.stringify({ model: "gemma4:e4b", message: { content: '{"answer":"' }, done: false }),
    JSON.stringify({ model: "gemma4:e4b", message: { content: "streamed\"}" }, done: true, done_reason: "stop" })
  ].join("\n") }, "gemma4:e4b", { nativeOllama: true, strictSchemaExpected: true, originalSchema: schema });
  assert(normalStream.text === '{"answer":"streamed"}' && normalStream.responseTelemetry?.profile === "openwebui-ollama-native-v1", "The bounded native NDJSON decoder must join a complete event stream before strict schema validation.");
  const responsesApiStream = providers.openWebUIResponseNormalize({ status: 200, text: [
    "event: response.created",
    `data: ${JSON.stringify({ type: "response.created", response: { status: "in_progress" } })}`,
    "",
    "event: response.reasoning_text.delta",
    `data: ${JSON.stringify({ type: "response.reasoning_text.delta", delta: "brief reasoning" })}`,
    "",
    "event: response.output_text.delta",
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: '{"answer":"' })}`,
    "",
    "event: response.output_text.delta",
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: 'responses"}' })}`,
    "",
    "event: response.output_text.done",
    `data: ${JSON.stringify({ type: "response.output_text.done", text: '{"answer":"responses"}' })}`,
    "",
    "event: response.completed",
    `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
    ""
  ].join("\n") }, "llama-server-model", { strictSchemaExpected: true, originalSchema: schema });
  assert(responsesApiStream.text === '{"answer":"responses"}'
    && responsesApiStream.responseTelemetry?.profile === "openwebui-responses-sse-v1"
    && responsesApiStream.responseTelemetry?.doneCount === 1,
  "The OpenAI Responses API SSE adapter must join llama-server output_text deltas, ignore reasoning events, and require response.completed.");
  let missingResponsesCompletion = null;
  try {
    providers.openWebUIResponseNormalize({ status: 200, text: [
      "event: response.output_text.delta",
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "partial" })}`,
      ""
    ].join("\n") }, "llama-server-model");
  } catch (error) { missingResponsesCompletion = error; }
  assert(missingResponsesCompletion?.providerError?.code === "incomplete-transport"
    && missingResponsesCompletion?.providerError?.providerDiagnostic?.reason === "missing-completed",
  "A Responses API SSE body without response.completed must remain an incomplete transport failure.");

    const defaultModel = "synthetic-default-ollama";
    const defaultBudget = gateway.aiGenerationDispatchBudgetCreate({ operation: "chat-query", lineageId: "openwebui-default-native-schema" });
    const defaultSettings = Object.assign({}, streamSettings, {
      openwebuiModelMetadata: { [defaultModel]: { ollamaBacked: true } }
    });
    let defaultBody = null;
    const defaultResult = await providers.openWebUIChat(auth, defaultSettings, {
      model: defaultModel,
      operation: "chat-query",
      system: "Return the exact synthetic JSON.",
      user: "Use the provider default.",
      jsonSchema: schema,
      generationDispatchBudget: defaultBudget
    }, { requestUrl: async (request) => {
      defaultBody = JSON.parse(request.body);
      return { status: 200, text: JSON.stringify({ message: { content: '{"answer":"default"}' }, done: true, done_reason: "stop" }) };
    } });
    assert(defaultBody?.stream === false && !Object.prototype.hasOwnProperty.call(defaultBody, "format") && !Object.prototype.hasOwnProperty.call(defaultBody, "think") && !Object.prototype.hasOwnProperty.call(defaultBody?.options || {}, "num_ctx") && defaultResult.providerRequestTelemetry?.schemaCarrier === "none", "An unknown Ollama model must use the completed prompt-grounded JSON compatibility default with no assumed native grammar, thinking, or context override.");
    assert(defaultResult.providerRetry?.attempts?.length === 1 && gateway.aiGenerationDispatchBudgetSnapshot(defaultBudget).used === 1, "The unknown-model compatibility default must preserve the shared dispatch budget and require no repair when direct JSON succeeds.");

    const capableModel = "synthetic-structured-output-supported";
    const capableSettings = Object.assign({}, streamSettings, {
      openwebuiModelMetadata: { [capableModel]: { ollamaBacked: true, supportsStructuredOutput: true } }
    });
    let capableBody = null;
    await providers.openWebUIChat(auth, capableSettings, {
      model: capableModel,
      operation: "chat-query",
      system: "Return the exact synthetic JSON.",
      user: "Use the discovered native carrier.",
      jsonSchema: schema
    }, { requestUrl: async (request) => {
      capableBody = JSON.parse(request.body);
      return { status: 200, text: JSON.stringify({ message: { content: '{"answer":"native"}' }, done: true, done_reason: "stop" }) };
    } });
    assert(capableBody?.stream === false && capableBody?.format === "json", "Fresh explicit structured-output support may promote an unknown Ollama model from the provider compatibility default to native JSON grammar.");

    const inBandErrorBudget = gateway.aiGenerationDispatchBudgetCreate({ operation: "chat-query", lineageId: "openwebui-http-200-error-envelope" });
    let inBandErrorCalls = 0;
    let inBandChatFailure = null;
    try {
      await providers.openWebUIChat(auth, capableSettings, {
        model: capableModel,
        operation: "chat-query",
        system: "Return the exact synthetic JSON.",
        user: "Exercise the synthetic in-band error envelope.",
        jsonSchema: schema,
        generationDispatchBudget: inBandErrorBudget
      }, { requestUrl: async () => {
        inBandErrorCalls += 1;
        return { status: 200, text: JSON.stringify({ error: "synthetic model does not support thinking" }) };
      } });
    } catch (error) { inBandChatFailure = error; }
    assert(inBandErrorCalls === 1
      && inBandChatFailure?.providerError?.code === "unsupported-schema"
      && inBandChatFailure?.providerError?.retryable === false
      && inBandChatFailure?.providerError?.providerDiagnostic?.inBandError === true
      && gateway.aiGenerationDispatchBudgetSnapshot(inBandErrorBudget).used === 1,
    "An HTTP-200 provider error envelope must stop after one dispatch and must not be mistaken for a schema-carrier retry opportunity.");

    const incapableModel = "synthetic-structured-output-unsupported";
    const incapableBudget = gateway.aiGenerationDispatchBudgetCreate({ operation: "chat-query", lineageId: "openwebui-discovered-no-schema" });
    const incapableSettings = Object.assign({}, streamSettings, {
      openwebuiModelMetadata: { [incapableModel]: { ollamaBacked: true, supportsStructuredOutput: false } }
    });
    let incapableBody = null;
    const incapableResult = await providers.openWebUIChat(auth, incapableSettings, {
      model: incapableModel,
      operation: "chat-query",
      system: "Return the exact synthetic JSON.",
      user: "Use the discovered compatibility carrier.",
      jsonSchema: schema,
      generationDispatchBudget: incapableBudget
    }, { requestUrl: async (request) => {
      incapableBody = JSON.parse(request.body);
      return { status: 200, text: JSON.stringify({ message: { content: '{"answer":"compatible"}' }, done: true, done_reason: "stop" }) };
    } });
    assert(incapableBody?.stream === false && !Object.prototype.hasOwnProperty.call(incapableBody, "format") && !Object.prototype.hasOwnProperty.call(incapableBody?.options || {}, "format") && incapableResult.providerRequestTelemetry?.schemaCarrier === "none", "A discovered Ollama model without structured-output support must use completed prompt-grounded JSON instead of sending native schema or JSON-mode grammar.");
    assert(incapableResult.providerRetry?.attempts?.length === 1 && gateway.aiGenerationDispatchBudgetSnapshot(incapableBudget).used === 1, "The discovered no-schema default must retain one physical generation dispatch and the unchanged two-dispatch ceiling.");

  let overflowError = null;
  try {
    providers.openWebUIResponseNormalize({ status: 200, text: "x".repeat(2 * 1024 * 1024 + 1) }, "gemma4:e4b", { nativeOllama: true });
  } catch (error) { overflowError = error; }
  assert(overflowError?.providerError?.code === "incomplete-transport" && overflowError?.providerError?.providerDiagnostic?.reason === "body-too-large", "An over-limit native response must fail before an unbounded body is parsed.");

  assert(blockedNetworkCallAttempts === 0, "The local test must not attempt any network request.");
  console.log(JSON.stringify({ evidence_class: EVIDENCE_CLASS, passedAssertions, blockedNetworkCallAttempts, fixtureAccess: "none", providerCalls: 0 }));
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
