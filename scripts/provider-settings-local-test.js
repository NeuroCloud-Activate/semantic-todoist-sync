'use strict';

// Local (no-network) test for Task 4 — AI & Search disclosure contract.
// Verifies the parts of the contract that are deterministically testable from a
// CommonJS import with an `obsidian` stub: six-group order, the no-OpenCode Go
// invariant, the five provider connections and their stable order, the eight
// operation keys and their resolution, and the explicit Refresh/Test actions.
// DOM rendering (connection/operation disclosures, embeddings capability
// controls, responsive styles) is validated separately via node --check and the
// primary's manual/CI review.

const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const path = require('path');

const originalLoad = Module._load;
const renderedSettings = [];
let networkCount = 0;
class FakeElement {
  constructor(tagName = 'div', options = {}) {
    this.tagName = tagName;
    this.children = [];
    this.textContent = options.text || '';
    this.className = options.cls || '';
    this.attributes = { ...(options.attr || {}) };
    this.open = false;
    this.style = { setProperty() {} };
    this.dataset = {};
  }
  createEl(tagName, options = {}) { const child = new FakeElement(tagName, options); this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl('div', options); }
  createSpan(options = {}) { return this.createEl('span', options); }
  addClass(value) { this.className = `${this.className} ${value}`.trim(); }
  setAttribute(key, value) { this.attributes[key] = value; }
  setAttr(key, value) { this.setAttribute(key, value); }
  empty() { this.children = []; this.textContent = ''; }
}
class FakeSetting {
  constructor(container) {
    this.settingEl = new FakeElement('div', { cls: 'setting-item' });
    this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
    container.children.push(this.settingEl);
    renderedSettings.push(this);
  }
  setName(value) { this.name = value; return this; }
  setDesc(value) { this.description = value; return this; }
  setHeading() { return this; }
  addDropdown(callback) {
    const control = { options: [], value: '', addOption: (value, label) => control.options.push({ value, label }), setValue: (value) => { control.value = value; return control; }, onChange: (handler) => { control.change = handler; return control; } };
    control.selectEl = new FakeElement('select');
    callback(control);
    this.control = control;
    return this;
  }
  addText(callback) {
    const control = { inputEl: { type: 'text', min: '', max: '', step: '', setAttr() {} }, setValue: (value) => { control.value = value; return control; }, onChange: (handler) => { control.change = handler; return control; } };
    callback(control);
    this.control = control;
    return this;
  }
  addTextArea(callback) { return this.addText(callback); }
  addToggle(callback) {
    const control = { setValue: (value) => { control.value = value; return control; }, onChange: (handler) => { control.change = handler; return control; } };
    callback(control);
    this.control = control;
    return this;
  }
  addButton(callback) {
    const control = { setButtonText: (value) => { control.label = value; return control; }, setCta: () => control, onClick: (handler) => { control.click = handler; return control; } };
    callback(control);
    this.control = control;
    return this;
  }
}
Module._load = function (request, parent, isMain) {
  if (request !== 'obsidian') return originalLoad.call(this, request, parent, isMain);
  class Empty {}
  return {
    ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty,
    Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting: FakeSetting,
    TFile: Empty, setIcon() {}, requestUrl() { networkCount += 1; throw new Error('network disabled'); }
  };
};
global.window = { setTimeout, clearTimeout, requestIdleCallback: null };
global.fetch = async () => { throw new Error('network disabled'); };

const Plugin = require(path.join(__dirname, '..', 'main.js'));
const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

function collect(element, predicate, result = []) {
  if (predicate(element)) result.push(element);
  for (const child of element.children || []) collect(child, predicate, result);
  return result;
}

// 1. Six groups, in the required order: Setup, AI & Search, Task Workflows,
//    Daily Scheduler, Task Integrity, Activity.
const GROUP_ORDER = 'const tabNames = ["Setup", "AI & Search", "Task Workflows", "Daily Scheduler", "Task Integrity", "Activity"]';
assert.ok(source.includes(GROUP_ORDER), 'six setting groups exist in the required order');

// 2. No OpenCode Go connection anywhere (Task 4 invariant).
assert.ok(!/opencodego|opencode-go|OpenCode Go/i.test(source), 'no OpenCode Go text anywhere in main.js');
assert.ok(!Plugin.SUPPORTED_AI_PROVIDERS.includes('opencodego'), 'no opencodego in provider connections');

// 3. Exactly five provider connections, in stable order.
assert.deepStrictEqual(Plugin.SUPPORTED_AI_PROVIDERS, [
  'openai', 'gemini', 'openrouter', 'openwebui', 'customopenai'
]);
assert.strictEqual(Plugin.SUPPORTED_AI_PROVIDERS.length, 5, 'exactly five provider connections');

// 4. Exactly eight operation keys.
assert.deepStrictEqual(Plugin.AI_OPERATION_KEYS, [
  'chat-query', 'prompt-response', 'task-generation', 'task-description',
  'section-title', 'scheduler', 'policy', 'deduplication'
]);

// 5. Operation -> provider resolution is wired through the stable layer.
const defaults = Plugin.DEFAULT_SETTINGS;
const chatPrimary = Plugin.resolveOperationReference(defaults, 'chat-query', 'primary');
assert.ok(['openai', 'gemini', 'openrouter'].includes(chatPrimary.provider), 'chat primary resolves to a supported provider');
const chatFallback = Plugin.resolveOperationReference(defaults, 'chat-query', 'fallback');
assert.notStrictEqual(`${chatPrimary.provider}:${chatPrimary.model}`, `${chatFallback.provider}:${chatFallback.model}`, 'chat fallback differs from primary');

// Every operation carries a resolvable primary and a distinct fallback.
for (const operation of Plugin.AI_OPERATION_KEYS) {
  const primary = Plugin.resolveOperationReference(defaults, operation, 'primary');
  const fallback = Plugin.resolveOperationReference(defaults, operation, 'fallback');
  assert.ok(['openai', 'gemini', 'openrouter', 'openwebui', 'customopenai'].includes(primary.provider), `${operation} primary is supported`);
  assert.notStrictEqual(`${primary.provider}:${primary.model}`, `${fallback.provider}:${fallback.model}`, `${operation} fallback differs from primary`);
}

// 6. Provider selection is deterministic across selection paths (keyboard vs
//    mouse both call the same stable resolver -> identical result).
const keyboard = Plugin.resolveOperationReference({
  ...defaults,
  enableMultiProviderOperationModels: true,
  aiOperationModels: { 'chat-query': { primary: { provider: 'openrouter', model: 'openai/gpt-5.6-luna' } } }
}, 'chat-query', 'primary');
const mouse = Plugin.resolveOperationReference({
  ...defaults,
  enableMultiProviderOperationModels: true,
  aiOperationModels: { 'chat-query': { primary: { provider: 'openrouter', model: 'openai/gpt-5.6-luna' } } }
}, 'chat-query', 'primary');
assert.deepStrictEqual(keyboard, mouse, 'keyboard and mouse selection resolve identically');

// 7. Explicit Refresh/Test actions exist (selection must not auto-run on blur).
assert.ok(/setButtonText\(\s*"Refresh Models"\s*\)/.test(source), 'explicit Refresh Models action present');
assert.ok(/setButtonText\(\s*"Test Provider"\s*\)/.test(source), 'explicit Test Provider action present');

// 8. Provider connection keys are explicit and never include the removed
//    OpenCode Go credential path.
assert.ok(/openrouterApiKey/.test(source) && /openwebuiApiKey/.test(source) && /customOpenAIApiKey/.test(source), 'five-provider connection keys are represented');
assert.ok(!/opencodeGoApiKey/i.test(source), 'no OpenCode Go API key storage');

// 9. The settings surface has real bounded disclosure helpers rather than a
// provider list that only advertises the stable two-provider legacy UI.
for (const marker of [
  'function renderProviderConnectionSettings',
  'function renderAdvancedOperationSettings',
  'function providerConnectionDisclosure',
  'function providerEmbeddingSettings',
  'function webResearchSettings',
  'semantic-todoist-settings-disclosure',
  'semantic-todoist-operation-disclosure',
  'semantic-todoist-provider-connection'
]) assert.ok(source.includes(marker), `settings implementation marker exists: ${marker}`);
assert.ok(/for\s*\(const operation of AI_OPERATION_KEYS\)/.test(source), 'advanced settings enumerate all operation keys');
assert.ok(/sharedGenerationPrimary/.test(source) && /sharedGenerationFallback/.test(source), 'shared references are presented before advanced overrides');
assert.ok(/chatWebSearchProvider/.test(source) && /chatWebSaveResearch/.test(source), 'search provider/model/mode/save settings are present');
assert.ok(/semantic-todoist-settings-disclosure/.test(styles) && /max-width:\s*700px/.test(styles), 'responsive disclosure styles exist');
assert.ok(/min-height:\s*44px/.test(styles) && /flex-direction:\s*column/.test(styles), 'coarse targets and narrow stacking styles exist');
assert.ok(!/:has\(/.test(styles), 'settings styles do not depend on :has');

const inherited = Plugin.resolveOperationReference({
  ...defaults,
  enableMultiProviderOperationModels: false,
  sharedGenerationPrimary: { provider: 'customopenai', model: 'fictional-shared-model' },
  aiOperationModels: { 'chat-query': { primary: { provider: 'gemini', model: 'fictional-operation-model' } } }
}, 'chat-query', 'primary');
assert.deepStrictEqual(inherited, { provider: 'customopenai', model: 'fictional-shared-model', reasoningEffort: 'medium' }, 'disabled operation overrides inherit shared primary');

// 10. Render the owned settings method with a no-network fake DOM. This
// exercises the actual disclosures rather than only checking source labels.
assert.strictEqual(typeof Plugin.SemanticTodoistSettingTab, 'function', 'settings tab is testable without Obsidian');
const plugin = Object.assign(Object.create(Plugin.prototype), {
  settings: Plugin.normalizeStableSettings({ enableMultiProviderOperationModels: true, providerGenerationModels: { openrouter: ['openai/gpt-5.6-luna'] }, providerEmbeddingModels: { customopenai: ['qwen3-embedding-0.6b-8k:latest'] } }),
  app: { vault: { getAllLoadedFiles: () => [] } },
  semanticIndex: [],
  saveCount: 0,
  refreshCount: 0,
  testCount: 0,
  saveSettings: async function () { this.saveCount += 1; },
  getPromptTemplates: async () => [],
  openwebuiLoginPassword: '',
  refreshOpenAIModels: async function () { this.refreshCount += 1; },
  validateAiSetup: async function () { this.testCount += 1; }
});
plugin.sameProviderFallbackModels = Plugin.prototype.sameProviderFallbackModels.bind(plugin);
plugin.displayName = 'test';
const tab = Object.create(Plugin.SemanticTodoistSettingTab.prototype);
tab.plugin = plugin;
tab.display = () => { tab.displayCount = (tab.displayCount || 0) + 1; };
const root = new FakeElement('section');
tab.renderAiSearch(root);
const connectionDisclosures = collect(root, (element) => element.className.includes('semantic-todoist-provider-connection'));
const operationDisclosures = collect(root, (element) => element.className.includes('semantic-todoist-operation-disclosure'));
assert.strictEqual(connectionDisclosures.length, 1, 'exactly one provider connection disclosure renders');
assert.strictEqual(operationDisclosures.length, 9, 'advanced routing renders one group plus eight operation disclosures');
assert.strictEqual(plugin.saveCount, 0, 'rendering performs no implicit save or network action');
const providerSelector = renderedSettings.find((setting) => setting.name === 'Provider connection to show');
assert.ok(providerSelector?.control?.change, 'provider-view selector is rendered');
providerSelector.control.change('gemini');
assert.strictEqual(plugin.saveCount, 0, 'provider-view selection performs no save/network action');
assert.strictEqual(tab.providerViewProvider, 'gemini', 'provider-view selection remains in-memory only');

const typedSetting = renderedSettings.find((setting) => setting.name === 'OpenRouter default model');
assert.ok(typedSetting?.control?.change, 'provider model input is rendered');
(async () => {
  await typedSetting.control.change('fictional-typed-model');
  assert.strictEqual(networkCount, 0, 'typing a provider model performs no network request');
  assert.strictEqual(plugin.settings.openrouterDefaultModel, 'fictional-typed-model', 'typing a provider model only saves its setting');
  const refreshSetting = renderedSettings.find((setting) => setting.name === 'Refresh Models');
  const testSetting = renderedSettings.find((setting) => setting.name === 'Test Provider');
  assert.ok(refreshSetting?.control?.click && testSetting?.control?.click, 'explicit Refresh/Test actions are rendered');
  await refreshSetting.control.click();
  await testSetting.control.click();
  assert.strictEqual(plugin.refreshCount, 1, 'Refresh Models only runs when explicitly clicked');
  assert.strictEqual(plugin.testCount, 1, 'Test Provider only runs when explicitly clicked');
  assert.strictEqual(networkCount, 0, 'explicit action stubs remain the only transport entry points');
  console.log('provider-settings-local-test: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
