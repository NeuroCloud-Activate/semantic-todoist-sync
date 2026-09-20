'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');
const calls = [];
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
      calls.push(options);
      if (scriptedResponses.length) return scriptedResponses.shift();
      const requestBody = options.body ? JSON.parse(options.body) : {};
      const count = Array.isArray(requestBody.input) ? requestBody.input.length : 1;
      const vector = options.url.includes('api.openai.com') ? new Array(256).fill(0) : [1, 0, 0];
      const body = options.url.includes('generativelanguage.googleapis.com')
        ? { embedding: { values: [1, 0, 0] } }
        : { data: count === 2
          ? [{ index: 1, embedding: [0, 1, 0] }, { index: 0, embedding: [1, 0, 0] }]
          : [{ index: 0, embedding: vector }] };
      return { status: 200, json: body, text: JSON.stringify(body) };
    }
  };
};
global.window = { setTimeout, clearTimeout, requestIdleCallback: null };
global.fetch = async () => { throw new Error('network disabled'); };

const Plugin = require(path.join(__dirname, '..', 'main.js'));
const makePlugin = (settings) => {
  const plugin = Object.create(Plugin.prototype);
  plugin.settings = Plugin.normalizeStableSettings(settings);
  plugin.queryEmbeddingCache = new Map();
  plugin.taskDeduplicationEmbeddingCache = new Map();
  plugin.invalidateSemanticRetrievalCache = () => {};
  return plugin;
};

(async () => {
  const openrouter = makePlugin({
    embeddingProvider: 'openrouter',
    embeddingModel: 'fictional-embedding',
    openrouterApiKey: 'FICTIONAL_OPENROUTER_KEY'
  });
  const vectors = await openrouter.embedTexts(['FICTIONAL_A', 'FICTIONAL_B'], 'query');
  assert.deepStrictEqual(vectors, [[1, 0, 0], [0, 1, 0]], 'provider indexes restore stable input order');
  assert.strictEqual(calls[0].url, 'https://openrouter.ai/api/v1/embeddings');
  assert.ok(JSON.parse(calls[0].body).input.length === 2);

  scriptedResponses = [{ status: 200, json: { data: [{ index: 0, embedding: [1, 0, 0] }, { index: 0, embedding: [0, 1, 0] }] }, text: 'FICTIONAL_DUPLICATE_INDEX' }];
  await assert.rejects(() => openrouter.embedTexts(['FICTIONAL_A', 'FICTIONAL_B'], 'query'), (error) => error.code === 'embedding-index-invalid');
  scriptedResponses = [];

  calls.length = 0;
  const custom = makePlugin({
    embeddingProvider: 'customopenai',
    embeddingModel: 'fictional-custom-embedding',
    embeddingDimension: 3,
    customOpenAIBaseUrl: 'https://sentinel.invalid/v1',
    customOpenAIApiKey: 'FICTIONAL_CUSTOM_KEY'
  });
  await custom.embedTexts(['FICTIONAL_A'], 'document');
  assert.strictEqual(calls[0].url, 'https://sentinel.invalid/v1/embeddings');
  assert.strictEqual(JSON.parse(calls[0].body).dimensions, 3);

  calls.length = 0;
  const webui = makePlugin({
    embeddingProvider: 'openwebui',
    embeddingModel: 'fictional-webui-embedding',
    openwebuiBaseUrl: 'https://sentinel.invalid/api',
    openwebuiApiKey: 'FICTIONAL_WEBUI_TOKEN'
  });
  await webui.embedTexts(['FICTIONAL_A'], 'document');
  assert.strictEqual(calls[0].url, 'https://sentinel.invalid/api/v1/embeddings');

  calls.length = 0;
  const openai = makePlugin({ embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-large', openAiEmbeddingDimensions: 3, openaiApiKey: 'FICTIONAL_OPENAI_KEY' });
  await openai.embedTexts(['FICTIONAL_A'], 'document');
  assert.strictEqual(calls[0].url, 'https://api.openai.com/v1/embeddings');

  calls.length = 0;
  const gemini = makePlugin({ embeddingProvider: 'gemini', embeddingModel: 'gemini-embedding-001', googleApiKey: 'FICTIONAL_GEMINI_KEY' });
  const geminiVectors = await gemini.embedTexts(['FICTIONAL_A'], 'query');
  assert.deepStrictEqual(geminiVectors, [[1, 0, 0]]);
  assert.ok(calls[0].url.includes('generativelanguage.googleapis.com'));

  console.log('provider-embedding-local-test: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
