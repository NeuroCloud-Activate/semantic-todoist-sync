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
assert.strictEqual(typeof Plugin.providerIndexIdentity, 'function');
assert.strictEqual(typeof Plugin.semanticIndexCompatibilityStatus, 'function');
assert.strictEqual(typeof Plugin.semanticIndexCleanupPlan, 'function');
const settings = {
  embeddingDimension: 768,
  embeddingDimensionOverrides: { 'customopenai:qwen3-embedding-0.6b-8k:latest': 768 },
  customOpenAIBaseUrl: 'https://sentinel.invalid/one/',
  openwebuiBaseUrl: 'https://sentinel.invalid/webui'
};
const base = Plugin.providerIndexIdentity(settings, 'customopenai', 'qwen3-embedding-0.6b-8k:latest');
const same = Plugin.providerIndexIdentity(settings, 'customopenai', 'qwen3-embedding-0.6b-8k:latest');
assert.deepStrictEqual(base, same);
assert.strictEqual(base.provider, 'customopenai');
assert.strictEqual(base.model, 'qwen3-embedding-0.6b-8k:latest');
assert.strictEqual(base.dimension, 768);
assert.ok(base.endpointIdentityHash && !JSON.stringify(base).includes('sentinel.invalid'));
assert.notStrictEqual(base.identityKey, Plugin.providerIndexIdentity(settings, 'openwebui', 'qwen3-embedding-0.6b-8k:latest').identityKey);
assert.notStrictEqual(base.identityKey, Plugin.providerIndexIdentity({ ...settings, customOpenAIBaseUrl: 'https://sentinel.invalid/two' }, 'customopenai', base.model).identityKey);
for (const provider of Plugin.SUPPORTED_AI_PROVIDERS) {
  const identity = Plugin.providerIndexIdentity({
    ...settings,
    providerEndpoints: { openai: 'https://sentinel.invalid/openai', gemini: 'https://sentinel.invalid/gemini', openrouter: 'https://sentinel.invalid/openrouter' }
  }, provider, base.model);
  assert.strictEqual(identity.provider, provider);
  assert.strictEqual(identity.model, base.model);
}
assert.strictEqual(Plugin.semanticIndexCompatibilityStatus(settings, { identity: base }).compatible, true);
assert.strictEqual(Plugin.semanticIndexCompatibilityStatus(settings, { identity: { ...base, dimension: 1024 } }).rebuildRequired, true);
assert.strictEqual(Plugin.semanticIndexCompatibilityStatus(settings, { identity: {} }).reasonCode, 'manifest-incomplete');
assert.strictEqual(Plugin.semanticIndexCompatibilityStatus(settings, { identity: { ...base, provider: 'opencodego' } }).rebuildRequired, true);
assert.strictEqual(Plugin.semanticIndexCleanupPlan(['semantic-index.customopenai.gold.json', 'source-note.md', 'data.json'], {
  replacementCommitted: false, integrityVerified: false, pointerPromoted: false
}).eligible, false);
const eligible = Plugin.semanticIndexCleanupPlan([
  'semantic-index.customopenai.gabc.001.json',
  'semantic-index-path-meta.gabc.json',
  'semantic-index-routing.gabc.json',
  'source-note.md', 'data.json', 'workspace.json',
  'task-reference-snapshot.gabc.json', 'scheduler-memory.gabc.json',
  'semantic-index.customopenai.gabc.002.json'
], {
  replacementCommitted: true, integrityVerified: true, pointerPromoted: true,
  activeFiles: ['semantic-index.customopenai.gabc.002.json']
});
assert.strictEqual(eligible.eligible, true);
assert.deepStrictEqual(eligible.files, [
  'semantic-index.customopenai.gabc.001.json',
  'semantic-index-path-meta.gabc.json',
  'semantic-index-routing.gabc.json'
]);
console.log('index-compatibility-local-test: PASS');
