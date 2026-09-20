'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request !== 'obsidian') return originalLoad.call(this, request, parent, isMain);
  class Empty {}
  return {
    ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty,
    Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty,
    TFile: Empty, setIcon() {}, requestUrl() { throw new Error('network disabled'); }
  };
};
global.window = { setTimeout, clearTimeout, requestIdleCallback: null };
global.fetch = async () => { throw new Error('network disabled'); };

const Plugin = require(path.join(__dirname, '..', 'main.js'));
assert.deepStrictEqual(Plugin.SUPPORTED_AI_PROVIDERS, ['openai', 'gemini', 'openrouter', 'openwebui', 'customopenai']);
assert.deepStrictEqual(Plugin.AI_OPERATION_KEYS, [
  'chat-query', 'prompt-response', 'task-generation', 'task-description',
  'section-title', 'scheduler', 'policy', 'deduplication'
]);
assert.strictEqual(typeof Plugin.resolveOperationReference, 'function');
assert.strictEqual(typeof Plugin.normalizeStableSettings, 'function');

const defaults = Plugin.DEFAULT_SETTINGS;
const primary = Plugin.resolveOperationReference(defaults, 'chat-query', 'primary');
assert.deepStrictEqual(primary, { provider: 'openrouter', model: 'openai/gpt-5.6-luna', reasoningEffort: 'medium' });
const fallback = Plugin.resolveOperationReference(defaults, 'chat-query', 'fallback');
assert.notStrictEqual(`${primary.provider}:${primary.model}`, `${fallback.provider}:${fallback.model}`);
for (const operation of Plugin.AI_OPERATION_KEYS) {
  const operationPrimary = Plugin.resolveOperationReference(defaults, operation, 'primary');
  const operationFallback = Plugin.resolveOperationReference(defaults, operation, 'fallback');
  assert.deepStrictEqual(operationPrimary, primary);
  assert.notStrictEqual(`${operationPrimary.provider}:${operationPrimary.model}`, `${operationFallback.provider}:${operationFallback.model}`);
}
assert.strictEqual(Plugin.resolveOperationReference({
  ...defaults,
  enableMultiProviderOperationModels: false,
  aiOperationModels: { 'chat-query': { primary: { provider: 'gemini', model: 'gemini-3.5-flash' } } }
}, 'chat-query', 'primary').provider, 'openrouter');

const advanced = Plugin.normalizeStableSettings({
  ...defaults,
  enableMultiProviderOperationModels: true,
  aiOperationModels: { 'chat-query': { primary: { provider: 'gemini', model: 'gemini-3.5-flash', reasoningEffort: 'low' } } }
});
assert.deepStrictEqual(Plugin.resolveOperationReference(advanced, 'chat-query', 'primary'), {
  provider: 'gemini', model: 'gemini-3.5-flash', reasoningEffort: 'low'
});
assert.strictEqual(Plugin.resolveOperationReference({
  ...advanced,
  aiOperationModels: { 'chat-query': { primary: { provider: 'gemini', model: 'gemini-3.5-flash' }, fallback: { model: 'gemini-3.5-flash' } } }
}, 'chat-query', 'fallback').provider, 'openrouter');

assert.throws(() => Plugin.resolveOperationReference({
  ...defaults,
  enableMultiProviderOperationModels: true,
  aiOperationModels: { 'chat-query': {
    primary: { provider: 'openrouter', model: 'openai/gpt-5.6-luna' },
    fallback: { provider: 'openrouter', model: 'openai/gpt-5.6-luna' }
  } }
}, 'chat-query', 'fallback'), /same-model-fallback/);

const legacy = { aiModelProvider: 'gemini', chatModel: 'gemini-3.5-flash', unknownSentinel: { keep: true }, opencodeGoApiKey: 'INERT_SENTINEL' };
const migrated = Plugin.normalizeStableSettings(legacy);
assert.strictEqual(migrated.aiModelProvider, 'gemini');
assert.strictEqual(migrated.unknownSentinel.keep, true);
assert.strictEqual(migrated.opencodeGoApiKey, 'INERT_SENTINEL');
assert.notStrictEqual(migrated.aiModelProvider, 'opencodego');
for (const operation of Plugin.AI_OPERATION_KEYS) {
  assert.notStrictEqual(Plugin.resolveOperationReference(migrated, operation, 'primary').provider, 'opencodego');
  assert.notStrictEqual(Plugin.resolveOperationReference(migrated, operation, 'fallback').provider, 'opencodego');
}
console.log('provider-registry-local-test: PASS');
