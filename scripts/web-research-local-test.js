'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

const requestCalls = [];
let scriptedResponses = [];
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request !== 'obsidian') return originalLoad.call(this, request, parent, isMain);
  class Empty {}
  return {
    ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty,
    Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty,
    TFile: Empty, setIcon() {},
    requestUrl: async (options) => {
      requestCalls.push(options);
      if (scriptedResponses.length) return scriptedResponses.shift();
      throw new Error('network disabled');
    }
  };
};
global.window = { setTimeout, clearTimeout, requestIdleCallback: null };
global.fetch = async () => { throw new Error('network disabled'); };

const Plugin = require(path.join(__dirname, '..', 'main.js'));

function makePlugin(settings = {}) {
  const plugin = Object.create(Plugin.prototype);
  plugin.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, {
    aiModelProvider: 'openrouter',
    sharedGenerationPrimary: { provider: 'openrouter', model: 'fictional-generation-model', reasoningEffort: 'default' },
    sharedGenerationFallback: { provider: 'openrouter', model: 'fictional-fallback-model', reasoningEffort: 'default' },
    chatModel: 'fictional-generation-model',
    chatWebSearchProvider: 'openrouter',
    chatWebSearchModel: 'fictional-search-model',
    chatWebSearchMode: 'off',
    chatWebSaveResearch: false,
    autoAddActiveContentToContext: false,
    openrouterApiKey: 'FICTIONAL_OPENROUTER_KEY',
    ...settings
  });
  plugin.saveSettings = async () => {};
  plugin.logLocal = () => {};
  plugin.recordDebugDiagnostic = () => {};
  plugin.setSidebarStatus = () => {};
  plugin.ensureCompatibleEmbeddingForChatModel = async () => {};
  plugin.requireAiAccess = () => {};
  plugin.tryUpdateSchedulerMemoryFromChat = async () => '';
  plugin.tryUpdateTaskDeduplicationPolicyFromChat = async () => '';
  plugin.retrieveAdaptiveSemanticContext = async () => [];
  plugin.buildTaskContext = async () => '';
  plugin.buildAdaptiveContextPack = () => ({ text: '', sourceContractId: '', contextBundleHash: '', promptBundleId: '', validatorBundleId: '' });
  plugin.aiModelForRequest = () => ({ model: plugin.settings.chatModel });
  plugin.withAiActivity = async (label, operation) => operation();
  return plugin;
}

function fakeVault() {
  const created = [];
  return {
    created,
    getAbstractFileByPath: () => null,
    createFolder: async () => {},
    create: async (filePath, content) => { created.push({ filePath, content }); return { path: filePath }; }
  };
}

(async () => {
  assert.strictEqual(Plugin.normalizeWebSearchMode(), 'off', 'search is off by default');
  assert.strictEqual(Plugin.normalizeWebSearchMode('Internet Search'), 'concise');
  assert.strictEqual(Plugin.normalizeWebSearchMode('Deep Research'), 'deep');
  assert.strictEqual(Plugin.canonicalWebSearchUrl('javascript:alert(1)'), '', 'unsafe URLs are never admitted');
  assert.strictEqual(Plugin.canonicalWebSearchUrl('HTTPS://Example.invalid/path/#fragment'), 'https://example.invalid/path', 'URLs are canonicalized before admission');

  const normalized = Plugin.normalizeWebEvidenceRows('openrouter', 'fictional-search-model', [
    { url: 'https://Example.invalid/article/#fragment', title: 'FICTIONAL Article', excerpt: 'FICTIONAL evidence' },
    { url: 'https://example.invalid/article', title: 'FICTIONAL duplicate', excerpt: 'FICTIONAL duplicate' },
    { url: 'javascript:alert(1)', title: 'FICTIONAL unsafe', excerpt: 'FICTIONAL unsafe' }
  ]);
  assert.strictEqual(normalized.rows.length, 1, 'duplicate and unsafe evidence are rejected');
  assert.strictEqual(normalized.rows[0].url, 'https://example.invalid/article');
  assert.ok(normalized.rows[0].evidenceId.startsWith('web-'), 'admitted web evidence receives a canonical ID');

  requestCalls.length = 0;
  scriptedResponses = [{ status: 200, json: { choices: [{ message: { content: 'FICTIONAL search synthesis', annotations: [{ type: 'url_citation', url: 'https://example.invalid/article', title: 'FICTIONAL Article', content: 'FICTIONAL evidence' }] } }], usage: { prompt_tokens: 2, completion_tokens: 3 } }, text: 'FICTIONAL_SEARCH_RESPONSE' }];
  const searchPlugin = makePlugin();
  const search = await searchPlugin.runWebSearch({ provider: 'openrouter', model: 'fictional-search-model', mode: 'concise', query: 'FICTIONAL_QUERY' });
  assert.strictEqual(requestCalls.length, 1, 'concise research makes exactly one native search request');
  assert.strictEqual(requestCalls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.strictEqual(JSON.parse(requestCalls[0].body).model, 'fictional-search-model');
  assert.strictEqual(search.status, 'searched');
  assert.strictEqual(search.evidence.length, 1);

  requestCalls.length = 0;
  scriptedResponses = [{ status: 200, json: {
    candidates: [{ groundingMetadata: {
      groundingChunks: [{ web: { uri: 'https://gemini.invalid/source', title: 'FICTIONAL Gemini source' } }],
      groundingSupports: [{ segment: { text: 'FICTIONAL Gemini evidence' }, groundingChunkIndices: [0] }],
      webSearchQueries: ['FICTIONAL_QUERY']
    } }]
  }, text: 'FICTIONAL_GEMINI_RESPONSE' }];
  const geminiSearch = await makePlugin({ googleApiKey: 'FICTIONAL_GEMINI_KEY' }).runWebSearch({ provider: 'gemini', model: 'gemini-3.5-flash-lite', mode: 'concise', query: 'FICTIONAL_QUERY' });
  assert.strictEqual(requestCalls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
  assert.strictEqual(geminiSearch.evidence[0].excerpt, 'FICTIONAL Gemini evidence');

  const missingModel = makePlugin({ chatWebSearchModel: '' });
  await assert.rejects(() => missingModel.runWebSearch({ provider: 'openrouter', query: 'FICTIONAL_QUERY' }), (error) => error.code === 'web-search-missing-model');

  const missingCredential = makePlugin({ openrouterApiKey: '' });
  await assert.rejects(() => missingCredential.runWebSearch({ provider: 'openrouter', query: 'FICTIONAL_QUERY' }), (error) => error.code === 'web-search-missing-credential');

  const vault = fakeVault();
  const saver = makePlugin({ chatWebSaveResearch: true });
  saver.app = { vault };
  const saved = await saver.saveChatWebResearch({
    prompt: 'FICTIONAL research question',
    answer: 'FICTIONAL answer (1)',
    subject: 'FICTIONAL subject',
    mode: 'concise',
    webSearchResult: { status: 'searched', provider: 'openrouter', model: 'fictional-search-model', queryCount: 1, resultCount: 1, evidence: normalized.rows },
    citationTelemetry: { citedWebEvidenceCount: 1, schemaInvalidCount: 0, usedEvidenceIds: [normalized.rows[0].evidenceId] }
  });
  assert.strictEqual(saved.status, 'saved', 'validated research is saved');
  assert.strictEqual(vault.created.length, 1, 'research saves exactly one note');
  assert.ok(vault.created[0].filePath.includes('/Research/'));
  assert.ok(vault.created[0].content.includes('References'));
  assert.ok(!vault.created[0].content.includes('FICTIONAL_OPENROUTER_KEY'));

  const invalidVault = fakeVault();
  const invalidSaver = makePlugin({ chatWebSaveResearch: true });
  invalidSaver.app = { vault: invalidVault };
  const rejected = await invalidSaver.saveChatWebResearch({
    prompt: 'FICTIONAL question', answer: 'FICTIONAL answer', mode: 'concise',
    webSearchResult: { status: 'searched', evidence: normalized.rows },
    citationTelemetry: { citedWebEvidenceCount: 0, schemaInvalidCount: 1 }
  });
  assert.strictEqual(rejected.status, 'not-eligible');
  assert.strictEqual(invalidVault.created.length, 0, 'citation failure saves nothing');

  let deepSearchRuns = 0;
  let deepSynthesisRuns = 0;
  const deepPlugin = makePlugin({ chatWebSaveResearch: false });
  deepPlugin.runWebSearch = async (request) => {
    deepSearchRuns += 1;
    assert.strictEqual(request.mode, 'deep');
    return { status: 'searched', provider: 'openrouter', model: 'fictional-search-model', queryCount: 1, resultCount: 1, evidence: normalized.rows, reasons: {} };
  };
  deepPlugin.openaiResponse = async () => {
    deepSynthesisRuns += 1;
    return JSON.stringify({ research_subject: 'FICTIONAL deep subject', claims: [
      { text: 'FICTIONAL deep claim one.', established: true, evidence_ids: [normalized.rows[0].evidenceId], category: 'fact' },
      { text: 'FICTIONAL deep claim two.', established: true, evidence_ids: [normalized.rows[0].evidenceId], category: 'fact' }
    ] });
  };
  const deepResult = await deepPlugin.chat('FICTIONAL_DEEP_QUERY', null, [], 'chat-query', { webSearchMode: 'deep' });
  assert.strictEqual(deepSearchRuns, 1, 'deep research performs exactly one search');
  assert.strictEqual(deepSynthesisRuns, 1, 'deep research performs one synthesis when no review is needed');
  assert.ok(deepResult.answer.includes('References:'), 'deep research renders a deduplicated references section');

  let searchRuns = 0;
  let synthesisRuns = 0;
  const chatPlugin = makePlugin({ chatWebSaveResearch: false });
  chatPlugin.runWebSearch = async (request) => {
    searchRuns += 1;
    assert.strictEqual(request.mode, 'concise');
    return { status: 'searched', provider: 'openrouter', model: 'fictional-search-model', queryCount: 1, resultCount: 1, evidence: normalized.rows, reasons: {} };
  };
  chatPlugin.openaiResponse = async (request) => {
    synthesisRuns += 1;
    assert.strictEqual(request.operation, 'chat');
    return JSON.stringify({ research_subject: 'FICTIONAL subject', claims: [{ text: 'FICTIONAL externally supported claim.', established: true, evidence_ids: [normalized.rows[0].evidenceId], category: 'fact' }] });
  };
  const chatResult = await chatPlugin.chat('FICTIONAL_QUERY', null, [], 'chat-query', { webSearchMode: 'concise' });
  assert.strictEqual(searchRuns, 1, 'chat concise mode performs one search');
  assert.strictEqual(synthesisRuns, 1, 'chat concise mode performs one synthesis');
  assert.ok(chatResult.answer.includes('(1)'), 'research answer uses numbered citations');

  console.log('web-research-local-test: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
