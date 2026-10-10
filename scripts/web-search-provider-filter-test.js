"use strict";

// scripts/web-search-provider-filter-test.js
//
// BUG (Settings > Internet Search): the "Search provider" dropdown does not
// filter the models listed in the "Search model" picker, and changing the
// provider does not refresh the picker.
//
// Findings against the 0.9.17 release source (extracted via
// `git show origin/main:main.js`; see SEARCH_FILTER_MAIN below). Line numbers
// are from that extract:
//
//   HALF 1 - picker spans all four providers:
//     webResearchSettings:25777   providers = ["openai","gemini","openrouter","anthropic"]
//     webResearchSettings:25784   groups: webSearchModelComboboxGroups(plugin.settings, providers)
//     webResearchSettings:25785   allowedProviders: providers.slice()
//     webSearchModelComboboxGroups:25765 itself filters correctly (it calls
//     modelComboboxGroups(settings, {providers}), which filters by
//     MODEL_COMBOBOX_PROVIDER_ORDER intersected with `providers`) - the caller
//     hands it all four providers, so the picker lists every provider's models
//     no matter which Search provider is selected.
//
//   HALF 2 - no re-render on provider change:
//     dropdownSettingWithDesc:26060-26068 - its onChange only assigns
//     plugin.settings[key] and awaits plugin.saveSettings(); there is no
//     display()/refreshDisplay() call, so the picker built at render time
//     (from normalizeWebSearchProvider(plugin.settings.chatWebSearchProvider))
//     stays stale until the tab is reopened. Compare aiProviderSetting:24914
//     which accepts `refreshDisplay` (settings tab passes () => this.display(),
//     main.js:22208), and modelComboboxSetting:25158 which already reads
//     config.refreshDisplay (but webResearchSettings:25780-25794 passes none).
//
// Run:
//   node scripts/web-search-provider-filter-test.js            (repo main.js)
//   $env:SEARCH_FILTER_MAIN="$env:TEMP\opencode\main-0.9.17.js"; node scripts/web-search-provider-filter-test.js
//
// Expected result on 0.9.17: checks 1, 2, 4, 5 and 6 FAIL with "all four
// providers present" / "no re-render" / "foreign model survived" evidence;
// check 3 PASSES (it is already correct). After the fix all six must pass.
// Fix sketch (NOT implemented here): in webResearchSettings, restrict the
// picker to the selected provider (groups + allowedProviders = [provider]),
// re-render on provider change, and drop a model saved under the previous
// provider so the picker falls back to the new provider's default.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = process.env.SEARCH_FILTER_MAIN
  ? path.resolve(process.env.SEARCH_FILTER_MAIN)
  : path.join(__dirname, "..", "main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");

// Recording registry shared with the compiled module copy through globalThis.
const registry = {
  installed: false,
  settings: [], // per rendered Setting: { name, dropdowns, texts, toggles }
  comboboxCalls: [], // { name, config } as passed to modelComboboxSetting
  webResearchRenders: 0,
  lastWebResearchArgs: null
};
globalThis.__webSearchFilterRegistry = registry;

function fakeElement() {
  const element = {
    children: [],
    style: {},
    value: "",
    attributes: {},
    ownerDocument: undefined,
    classList: { add() {}, remove() {}, toggle() {} },
    addClass() {},
    removeClass() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); return child; },
    contains() { return false; },
    remove() {},
    empty() { this.children = []; },
    createEl() { return fakeElement(); },
    createDiv() { return fakeElement(); },
    getBoundingClientRect() { return null; },
    scrollIntoView() {},
    focus() {},
    blur() {}
  };
  return element;
}

function fakeDropdown(record) {
  const dropdown = {
    options: [],
    value: undefined,
    _onChange: null,
    addOption(value, label) { this.options.push({ value, label }); return this; },
    setValue(value) { this.value = value; return this; },
    onChange(handler) { dropdown._onChange = handler; record.changeHandler = handler; return this; }
  };
  return dropdown;
}

function fakeText() {
  const input = fakeElement();
  return {
    inputEl: input,
    setValue(value) { this.inputEl.value = value; return this; },
    onChange() { return this; },
    onChanged() { return this; },
    setPlaceholder() { return this; }
  };
}

function fakeToggle() {
  return {
    value: undefined,
    onChange: null,
    setValue(value) { this.value = value; return this; },
    onChange(handler) { this.onChange = handler; return this; }
  };
}

function fakeButton() {
  return {
    buttonEl: fakeElement(),
    setButtonText() { return this; },
    setCta() { return this; },
    setTooltip() { return this; },
    setClass() { return this; },
    onClick(handler) { this.onClick = handler; return this; }
  };
}

// Minimal recording stand-in for the obsidian Setting class: records the
// setting name plus every dropdown/text/toggle control created under it.
class RecordingSetting {
  constructor(containerEl) {
    this.containerEl = containerEl;
    this.settingEl = fakeElement();
    this._record = { name: null, dropdowns: [], texts: [], toggles: [], buttons: [] };
    registry.settings.push(this._record);
  }
  setName(name) { this._record.name = String(name); return this; }
  setDesc() { return this; }
  setClass() { return this; }
  addDropdown(cb) {
    const dropdown = fakeDropdown(this._record);
    this._record.dropdowns.push(dropdown);
    if (typeof cb === "function") cb(dropdown);
    return this;
  }
  addText(cb) {
    const text = fakeText();
    this._record.texts.push(text);
    if (typeof cb === "function") cb(text);
    return this;
  }
  addToggle(cb) {
    const toggle = fakeToggle();
    this._record.toggles.push(toggle);
    if (typeof cb === "function") cb(toggle);
    return this;
  }
  addButton(cb) {
    const button = fakeButton();
    this._record.buttons.push(button);
    if (typeof cb === "function") cb(button);
    return this;
  }
  addTextArea(cb) {
    const text = fakeText();
    this._record.texts.push(text);
    if (typeof cb === "function") cb(text);
    return this;
  }
}

const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
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
    Setting: RecordingSetting,
    TFile: Empty,
    setIcon() {},
    requestUrl() { throw new Error("network disabled - requestUrl must not be called"); }
  };
};

let pluginApi;
try {
  testModule._compile(
    `${mainSource}\n` +
      // Wrap (not modify) the two render entry points in the compiled COPY so
      // the test can observe what the real render path hands the picker and
      // how often the section is (re)rendered. Working tree main.js untouched.
      ";(function () {\n" +
      "  var reg = globalThis.__webSearchFilterRegistry;\n" +
      "  if (reg && !reg.installed) {\n" +
      "    reg.installed = true;\n" +
      "    var originalModelComboboxSetting = modelComboboxSetting;\n" +
      "    modelComboboxSetting = function (containerEl, name, desc, plugin, config) {\n" +
      "      reg.comboboxCalls.push({ name: String(name || \"\"), config: config });\n" +
      "      return originalModelComboboxSetting.apply(this, arguments);\n" +
      "    };\n" +
      "    var originalWebResearchSettings = webResearchSettings;\n" +
      "    webResearchSettings = function (containerEl, plugin) {\n" +
      "      reg.webResearchRenders = (reg.webResearchRenders || 0) + 1;\n" +
      "      return originalWebResearchSettings.apply(this, arguments);\n" +
      "    };\n" +
      "  }\n" +
      "})();\n" +
      "module.exports.__testWebSearchFilter = {\n" +
      "  webSearchModelComboboxGroups, modelComboboxGroups, webResearchSettings,\n" +
      "  normalizeWebSearchProvider, WEB_SEARCH_PROVIDER_DEFAULT_MODELS, WEB_SEARCH_PROVIDER_VALUES\n" +
      "};\n",
    mainPath
  );
  pluginApi = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
  delete globalThis.__webSearchFilterRegistry;
}

const api = pluginApi.__testWebSearchFilter;
const {
  webSearchModelComboboxGroups,
  modelComboboxGroups,
  webResearchSettings,
  normalizeWebSearchProvider,
  WEB_SEARCH_PROVIDER_DEFAULT_MODELS,
  WEB_SEARCH_PROVIDER_VALUES
} = api;

const failures = [];

function check(name, assertion) {
  try {
    assertion();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error && error.message || error}`);
    console.error(`FAIL: ${name}: ${error && error.message || error}`);
  }
}

// ----- fixture ------------------------------------------------------------

// providerCatalogModels(settings, provider) reads
// settings.providerGenerationModels[provider]; three distinct catalog models
// per provider so a group's membership is unambiguous.
const CATALOGS = {
  openai: ["gpt-5.6", "gpt-5.6-mini", "o5-mini"],
  gemini: ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.5-pro"],
  openrouter: ["openrouter/free", "openrouter/auto", "openrouter/pro"],
  anthropic: ["claude-haiku-5-5", "claude-sonnet-5", "claude-opus-5"]
};

function buildSettings(chatWebSearchProvider) {
  return {
    chatWebSearchProvider,
    chatWebSearchModel: "",
    chatWebSaveResearch: true,
    providerGenerationModels: {
      openai: CATALOGS.openai.slice(),
      gemini: CATALOGS.gemini.slice(),
      openrouter: CATALOGS.openrouter.slice(),
      anthropic: CATALOGS.anthropic.slice()
    }
  };
}

function buildPlugin(chatWebSearchProvider) {
  const plugin = {
    settings: buildSettings(chatWebSearchProvider),
    saves: 0,
    rerenders: 0,
    async saveSettings() { this.saves += 1; },
    display() { this.rerenders += 1; }
  };
  return plugin;
}

// Renders the Settings > Internet Search section through the real
// webResearchSettings and returns { plugin, picker, providerDropdown } where
// `picker` is the config object the render passed to modelComboboxSetting for
// the "Search model" row.
function renderSearchSection(chatWebSearchProvider) {
  const plugin = buildPlugin(chatWebSearchProvider);
  const refreshDisplayCalls = [];
  const containerEl = {};
  registry.settings = [];
  registry.comboboxCalls = [];
  const rendersBefore = registry.webResearchRenders;

  webResearchSettings(containerEl, plugin, () => refreshDisplayCalls.push(1));

  assert.equal(registry.webResearchRenders, rendersBefore + 1, "webResearchSettings did not render");
  const searchProvider = registry.settings.find((record) => record.name === "Search provider");
  assert.ok(searchProvider && searchProvider.dropdowns.length === 1, "Search provider dropdown was not rendered");
  const picker = registry.comboboxCalls.find((call) => call.name === "Search model");
  assert.ok(picker && picker.config, "Search model picker was not rendered");

  return {
    plugin,
    containerEl,
    refreshDisplayCalls,
    providerDropdown: searchProvider.dropdowns[0],
    pickerConfig: picker.config,
    comboboxCalls: registry.comboboxCalls.slice()
  };
}

function groupProviders(config) {
  return (Array.isArray(config.groups) ? config.groups : []).map((group) => group.provider);
}

function groupModels(config, provider) {
  const group = (config.groups || []).find((entry) => entry.provider === provider);
  return group && Array.isArray(group.models) ? group.models : [];
}

// ----- checks --------------------------------------------------------------

check("groups contain only the selected provider", () => {
  // API the fix will use: webSearchModelComboboxGroups already filters when
  // handed a single provider.
  const apiGroups = webSearchModelComboboxGroups(buildSettings("gemini"), ["gemini"]).map((group) => group.provider);
  assert.deepEqual(apiGroups, ["gemini"], `direct webSearchModelComboboxGroups(settings, ["gemini"]) returned [${apiGroups}]`);

  // Real rendering path: the Search model picker must be restricted to the
  // selected Search provider.
  const rendered = renderSearchSection("gemini");
  const providers = groupProviders(rendered.pickerConfig);
  assert.ok(
    providers.every((provider) => provider === "gemini"),
    `Search model picker groups for Search provider "gemini" span [${providers}] - expected only ["gemini"] (all four providers present)`
  );
  const allowed = rendered.pickerConfig.allowedProviders || [];
  assert.ok(
    allowed.every((provider) => provider === "gemini"),
    `Search model picker allowedProviders for Search provider "gemini" span [${allowed}] - expected only ["gemini"]`
  );
  // The gemini catalog models must actually be listed.
  assert.deepEqual(
    groupModels(rendered.pickerConfig, "gemini").slice().sort(),
    CATALOGS.gemini.slice().sort(),
    "gemini catalog models missing from the picker"
  );
});

check("each provider filters", () => {
  const problems = [];
  for (const provider of WEB_SEARCH_PROVIDER_VALUES) {
    const label = provider;
    const settings = buildSettings(provider);

    const apiGroups = webSearchModelComboboxGroups(settings, [provider]).map((group) => group.provider);
    if (apiGroups.some((entry) => entry !== provider)) {
      problems.push(`${label}: direct API returned [${apiGroups}]`);
    }

    const rendered = renderSearchSection(provider);
    const providers = groupProviders(rendered.pickerConfig);
    if (providers.some((entry) => entry !== provider)) {
      problems.push(`${label}: picker groups span [${providers}] (all four providers present)`);
    }
    const allowed = rendered.pickerConfig.allowedProviders || [];
    if (allowed.some((entry) => entry !== provider)) {
      problems.push(`${label}: picker allowedProviders span [${allowed}]`);
    }
    if (provider === "anthropic") {
      const models = groupModels(rendered.pickerConfig, "anthropic");
      if (!models.includes(WEB_SEARCH_PROVIDER_DEFAULT_MODELS.anthropic)) {
        problems.push(`anthropic: group missing WEB_SEARCH_PROVIDER_DEFAULT_MODELS.anthropic (${WEB_SEARCH_PROVIDER_DEFAULT_MODELS.anthropic})`);
      }
    }
  }
  assert.equal(problems.length, 0, `provider filtering failures: ${problems.join("; ")}`);
});

check("provider default option follows provider", () => {
  for (const provider of WEB_SEARCH_PROVIDER_VALUES) {
    const rendered = renderSearchSection(provider);
    const config = rendered.pickerConfig;
    assert.equal(config.includeDefault, true, `${provider}: includeDefault is not true`);
    assert.equal(
      config.defaultProvider,
      provider,
      `${provider}: defaultProvider is ${config.defaultProvider} - expected ${provider}`
    );
    assert.ok(
      config.current && config.current.provider === provider,
      `${provider}: current.provider is ${config.current && config.current.provider} - expected ${provider}`
    );
  }
});

check("unknown provider falls back safely", () => {
  assert.equal(
    normalizeWebSearchProvider("bogus"),
    "gemini",
    'normalizeWebSearchProvider("bogus") should fall back to "gemini"'
  );

  const rendered = renderSearchSection("bogus");
  const providers = groupProviders(rendered.pickerConfig);
  assert.ok(
    providers.every((provider) => provider === normalizeWebSearchProvider("bogus")),
    `picker groups for unknown provider "bogus" span [${providers}] - expected only the fallback provider [${normalizeWebSearchProvider("bogus")}]`
  );
  const allowed = rendered.pickerConfig.allowedProviders || [];
  assert.ok(
    allowed.every((provider) => provider === normalizeWebSearchProvider("bogus")),
    `picker allowedProviders for unknown provider "bogus" span [${allowed}] - expected only the fallback provider`
  );
  assert.equal(
    rendered.pickerConfig.defaultProvider,
    normalizeWebSearchProvider("bogus"),
    "picker defaultProvider must follow the fallback provider"
  );
});

check("changing provider rerenders model list", () => {
  const rendered = renderSearchSection("gemini");
  const dropdown = rendered.providerDropdown;
  assert.equal(
    dropdown.options.map((option) => option.value).join(","),
    WEB_SEARCH_PROVIDER_VALUES.join(","),
    "Search provider dropdown options do not match the known providers"
  );
  const changeHandler = dropdown._onChange;
  assert.equal(typeof changeHandler, "function", "Search provider dropdown has no onChange handler");

  // Re-render contract (any one is acceptable):
  //  a) a refresh hook passed to the section render is invoked, or
  //  b) the section re-renders (webResearchSettings runs again), or
  //  c) the Search model picker is rebuilt, or
  //  d) the settings tab display() is re-invoked.
  const before = {
    comboboxCalls: registry.comboboxCalls.length,
    renders: registry.webResearchRenders
  };
  changeHandler("anthropic");

  const rerendered =
    rendered.refreshDisplayCalls.length > 0
    || registry.webResearchRenders > before.renders
    || registry.comboboxCalls.length > before.comboboxCalls
    || rendered.plugin.rerenders > 0;

  assert.ok(
    rerendered,
    "changing the Search provider dropdown did not re-render the Search model picker: "
    + `settings.chatWebSearchProvider=${rendered.plugin.settings.chatWebSearchProvider} was saved `
    + `(${rendered.plugin.saves} save(s)) but no refresh hook, section re-render, picker rebuild, or display() call followed`
  );

  // If the picker was rebuilt, the second render must be filtered to the new
  // provider.
  if (registry.comboboxCalls.length > before.comboboxCalls) {
    const second = registry.comboboxCalls[registry.comboboxCalls.length - 1];
    const providers = groupProviders(second.config);
    assert.ok(
      providers.every((provider) => provider === "anthropic"),
      `second render picker groups span [${providers}] - expected only ["anthropic"]`
    );
  }
});

check("provider change resets a foreign model", () => {
  const rendered = renderSearchSection("gemini");
  const changeHandler = rendered.providerDropdown._onChange;
  assert.equal(typeof changeHandler, "function", "Search provider dropdown has no onChange handler");

  // A model saved under the previous provider is not valid for the new one.
  rendered.plugin.settings.chatWebSearchModel = "gemini-3.5-flash";
  changeHandler("openai");
  assert.equal(rendered.plugin.settings.chatWebSearchProvider, "openai", "Search provider was not saved");
  assert.equal(
    rendered.plugin.settings.chatWebSearchModel,
    "",
    `a gemini model (gemini-3.5-flash) survived the switch to openai - expected the Provider default ("")`
  );

  // A model the newly selected provider also lists stays selected.
  rendered.plugin.settings.providerGenerationModels.anthropic.push("gemini-3.5-flash");
  rendered.plugin.settings.chatWebSearchModel = "gemini-3.5-flash";
  changeHandler("anthropic");
  assert.equal(
    rendered.plugin.settings.chatWebSearchModel,
    "gemini-3.5-flash",
    "a model the newly selected provider lists was dropped unnecessarily"
  );
});

if (failures.length) {
  throw new Error(`web search provider filter test failed (${failures.length}):\n- ${failures.join("\n- ")}`);
}

console.log("web search provider filter test: pass");
