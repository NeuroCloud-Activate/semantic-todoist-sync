'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request !== 'obsidian') return originalLoad.call(this, request, parent, isMain);
  class Empty {}
  return { ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice: Empty,
    Plugin: Empty, PluginSettingTab: Empty, Setting: Empty, TFile: Empty, setIcon() {},
    requestUrl() { throw new Error('network disabled'); } };
};
global.window = { setTimeout, clearTimeout, requestIdleCallback: null };
global.fetch = async () => { throw new Error('network disabled'); };

const Plugin = require(path.join(__dirname, '..', 'main.js'));
const sentinel = {
  openaiApiKey: 'FICTIONAL_OPENAI_KEY',
  customOpenAIBaseUrl: 'https://sentinel.invalid/api/v1',
  customOpenAIApiKey: 'FICTIONAL_CUSTOM_KEY',
  availableOpenRouterModels: ['FICTIONAL_PROVIDER_MODEL'],
  enableMultiProviderOperationModels: true,
  aiOperationModels: { scheduler: { primary: { provider: 'gemini', model: 'gemini-3.5-flash' } } },
  opencodeGoApiKey: 'INERT_OPENCODEGO_SENTINEL',
  unknownNested: { preserve: ['FICTIONAL'] }
};
const before = JSON.stringify(sentinel);
const migrated = Plugin.normalizeStableSettings(sentinel);
assert.strictEqual(JSON.stringify(sentinel), before, 'migration must not mutate input');
assert.strictEqual(migrated.openaiApiKey, 'FICTIONAL_OPENAI_KEY');
assert.strictEqual(migrated.customOpenAIBaseUrl, 'https://sentinel.invalid/api/v1');
assert.strictEqual(migrated.customOpenAIApiKey, 'FICTIONAL_CUSTOM_KEY');
assert.deepStrictEqual(migrated.availableOpenRouterModels, ['FICTIONAL_PROVIDER_MODEL']);
assert.deepStrictEqual(migrated.unknownNested, { preserve: ['FICTIONAL'] });
assert.strictEqual(migrated.opencodeGoApiKey, 'INERT_OPENCODEGO_SENTINEL');
assert.deepStrictEqual(Plugin.resolveOperationReference(migrated, 'scheduler', 'primary'), {
  provider: 'gemini', model: 'gemini-3.5-flash', reasoningEffort: 'medium'
});

const removedProvider = Plugin.normalizeStableSettings({ aiModelProvider: 'opencodego', chatModel: 'go-model' });
assert.notStrictEqual(removedProvider.aiModelProvider, 'opencodego');
assert.notStrictEqual(Plugin.resolveOperationReference(removedProvider, 'chat-query', 'primary').provider, 'opencodego');
console.log('settings-migration-local-test: PASS');
