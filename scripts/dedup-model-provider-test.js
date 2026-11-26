"use strict";
// Dedup model must follow the active generation provider (not OpenAI-only). No network.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const mainPath = path.join(__dirname, "..", "src/main.js");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
const originalLoad = Module._load;
const rendered = [];
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
  class Empty { open() {} }
  class Setting {
    constructor() { this.rec = { options: [], value: undefined }; rendered.push(this.rec); }
    setName(n) { this.rec.name = n; return this; }
    setDesc() { return this; }
    addDropdown(cb) { const d = { addOption: (v, l) => { this.rec.options.push([v, l]); return d; }, setValue: (v) => { this.rec.value = v; return d; }, onChange: (fn) => { this.rec.onChange = fn; return d; } }; cb(d); return this; }
  }
  return { ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting, TFile: Empty, setIcon() {}, requestUrl: async () => { throw new Error("network disabled in test"); } };
};
let P;
try {
  global.window = { setTimeout, clearTimeout, requestIdleCallback: null };
  testModule._compile(fs.readFileSync(mainPath, "utf8"), mainPath);
  P = testModule.exports;
} finally { Module._load = originalLoad; }

const base = (over) => Object.assign({}, P.DEFAULT_SETTINGS, over);
const anth = (over) => base(Object.assign({
  aiModelProvider: "anthropic", chatModel: "claude-sonnet-5-5", taskDeduplicationAiModel: "",
  sharedGenerationPrimary: { provider: "anthropic", model: "claude-sonnet-5-5" },
  sharedGenerationFallback: { provider: "anthropic", model: "claude-haiku-5-5" },
  providerGenerationModels: { anthropic: ["claude-sonnet-5-5", "claude-haiku-5-5"] }
}, over));

const cases = [];
const test = (n, f) => cases.push([n, f]);

test("anthropic + same-provider fallback -> automatic is that fallback", () => {
  assert.equal(P.taskDeduplicationAiModel(anth()), "claude-haiku-5-5");
});
test("anthropic with no same-provider fallback -> primary", () => {
  assert.equal(P.taskDeduplicationAiModel(anth({ sharedGenerationFallback: { provider: "openai", model: "gpt-x" } })), "claude-sonnet-5-5");
  assert.equal(P.taskDeduplicationAiModel(anth({ sharedGenerationFallback: { provider: "anthropic", model: "claude-sonnet-5-5" } })), "claude-sonnet-5-5");
});
test("explicit pick wins", () => {
  assert.equal(P.taskDeduplicationAiModel(anth({ taskDeduplicationAiModel: "claude-opus-x" })), "claude-opus-x");
});
test("credentials follow the provider the call is sent to", () => {
  assert.equal(P.hasChatCredentialForModel(base({ aiModelProvider: "customopenai", customOpenAIBaseUrl: "https://llm.invalid/v1" }), "m"), true);
  assert.equal(P.hasChatCredentialForModel(base({ aiModelProvider: "customopenai", customOpenAIBaseUrl: "" }), "m"), false);
  assert.equal(P.hasChatCredentialForModel(anth({ anthropicApiKey: "" , openaiApiKey: "sk-unused"}), "claude-haiku-5-5"), false);
  assert.equal(P.hasChatCredentialForModel(anth({ anthropicApiKey: "k" }), "claude-haiku-5-5"), true);
  assert.equal(P.hasChatCredentialForModel(base({ aiModelProvider: "openrouter", openrouterApiKey: "k" }), "m"), true);
  assert.equal(P.hasChatCredentialForModel(base({ aiModelProvider: "openwebui", openwebuiBaseUrl: "https://w.invalid", openwebuiJwt: "j" }), "m"), true);
  assert.equal(P.hasChatCredentialForModel(base({ aiModelProvider: "openwebui", openwebuiBaseUrl: "https://w.invalid" }), "m"), false);
});
test("openai and gemini users unchanged", () => {
  const o = base({ aiModelProvider: "openai", chatModel: "gpt-5.6-luna", taskDeduplicationAiModel: "", openaiApiKey: "k" });
  assert.ok(!/^gemini/i.test(P.taskDeduplicationAiModel(o)));
  assert.equal(P.hasChatCredentialForModel(o, "gpt-5.6-luna"), true);
  assert.equal(P.hasChatCredentialForModel(base({ aiModelProvider: "openai", openaiApiKey: "" }), "gpt-5.6-luna"), false);
  const g = base({ aiModelProvider: "gemini", chatModel: "gemini/gemini-3.5-flash", taskDeduplicationAiModel: "", googleApiKey: "k" });
  assert.match(P.taskDeduplicationAiModel(g), /^gemini\/gemini-/);
  assert.equal(P.hasChatCredentialForModel(g, "gemini/gemini-3.5-flash"), true);
  assert.equal(P.hasChatCredentialForModel(Object.assign({}, g, { googleApiKey: "" }), "gemini/gemini-3.5-flash"), false);
});
test("impact text shows the real model", () => {
  assert.match(P.taskDeduplicationPolicyImpactText(anth()), /Anthropic: claude-haiku-5-5/);
});
async function migrate(settings) {
  const p = Object.create(P.prototype);
  p.settings = settings;
  p.saveSettings = async () => {};
  p.saveData = async () => {};
  p.loadData = async () => ({});
  p.logLocal = () => {};
  p.taskReferenceSnapshotDirty = false;
  await p.migrateSettings();
  return p.settings.taskDeduplicationAiModel;
}
test("migration keeps an anthropic pick, clears a gemini id under anthropic", async () => {
  assert.equal(await migrate(anth({ taskDeduplicationAiModel: "claude-haiku-5-5" })), "claude-haiku-5-5");
  assert.equal(await migrate(anth({ taskDeduplicationAiModel: "gemini/gemini-3.5-flash" })), "");
  assert.equal(await migrate(base({ aiModelProvider: "gemini", chatModel: "gemini/gemini-3.5-flash", taskDeduplicationAiModel: "gpt-5.6-luna" })), "");
});
test("unset aiModelProvider resolves like runtime (openrouter), not from chatModel", () => {
  const s = base({ aiModelProvider: "", chatModel: "gpt-5.6-luna", openaiApiKey: "k", openrouterApiKey: "" });
  assert.equal(P.hasChatCredentialForModel(s, "gpt-5.6-luna"), false);
  assert.equal(P.hasChatCredentialForModel(Object.assign({}, s, { openrouterApiKey: "k", openaiApiKey: "" }), "gpt-5.6-luna"), true);
  assert.match(P.taskDeduplicationModelLabel(s, "m"), /^OpenRouter/i);
});
const plug = (settings) => ({ settings, saveSettings: async () => {} });
test("primary provider switch clears the dedup pick (model and field saves)", async () => {
  const mk = () => plug(base({ aiModelProvider: "openai", chatModel: "gpt-5.6-luna", sharedGenerationPrimary: { provider: "openai", model: "gpt-5.6-luna" }, taskDeduplicationAiModel: "gpt-5.4-mini" }));
  let p = mk();
  await P.saveSharedModelReference(p, "primary", "anthropic", "claude-sonnet-5-5");
  assert.equal(p.settings.taskDeduplicationAiModel, "");
  p = mk();
  await P.saveSharedReferenceField(p, "primary", "provider", "anthropic");
  assert.equal(p.settings.taskDeduplicationAiModel, "");
});
test("same-provider primary change and fallback change keep the dedup pick", async () => {
  const mk = () => plug(anth({ taskDeduplicationAiModel: "claude-haiku-5-5" }));
  let p = mk();
  await P.saveSharedModelReference(p, "primary", "anthropic", "claude-opus-x");
  assert.equal(p.settings.taskDeduplicationAiModel, "claude-haiku-5-5");
  p = mk();
  await P.saveSharedModelReference(p, "fallback", "openai", "gpt-5.4-mini");
  assert.equal(p.settings.taskDeduplicationAiModel, "claude-haiku-5-5");
  p = mk();
  await P.saveSharedReferenceField(p, "primary", "model", "claude-opus-x");
  assert.equal(p.settings.taskDeduplicationAiModel, "claude-haiku-5-5");
});
test("dropdown lists Anthropic catalog and keeps off-catalog saved value", () => {
  const draw = (over) => { rendered.length = 0; P.taskDeduplicationAiModelSetting({}, { settings: anth(over) }); return rendered[0]; };
  const r = draw({});
  assert.deepEqual(r.options.map((o) => o[0]), ["", "claude-sonnet-5-5", "claude-haiku-5-5"]);
  assert.ok(r.options.some((o) => o[1] === "Anthropic: claude-haiku-5-5"));
  assert.ok(!r.options.some((o) => /OpenAI/.test(o[1])));
  const s = draw({ taskDeduplicationAiModel: "claude-legacy-9" });
  assert.equal(s.value, "claude-legacy-9");
  assert.ok(s.options.some((o) => o[0] === "claude-legacy-9"));
});
test("dropdown ignores an unmigrated stale pick but keeps a same-provider off-catalog pick", () => {
  const draw = (over) => { rendered.length = 0; P.taskDeduplicationAiModelSetting({}, { settings: anth(over) }); return rendered[0]; };
  const stale = draw({ taskDeduplicationAiModel: "gpt-x", taskDeduplicationAiModelProvider: "openai" });
  assert.equal(stale.value, "");
  assert.ok(!stale.options.some((o) => o[0] === "gpt-x"));
  const ok = draw({ taskDeduplicationAiModel: "claude-legacy-9", taskDeduplicationAiModelProvider: "anthropic" });
  assert.equal(ok.value, "claude-legacy-9");
  assert.ok(ok.options.some((o) => o[0] === "claude-legacy-9" && /\(saved\)/.test(o[1])));
});

const cust = (over) => base(Object.assign({ aiModelProvider: "customopenai", chatModel: "gpt-x", customOpenAIBaseUrl: "https://llm.invalid/v1", sharedGenerationPrimary: { provider: "customopenai", model: "gpt-x" }, sharedGenerationFallback: { provider: "customopenai", model: "gpt-y" } }, over));
async function migrated(settings) {
  const p = Object.create(P.prototype);
  Object.assign(p, { settings, saveSettings: async () => {}, saveData: async () => {}, loadData: async () => ({}), logLocal() {}, taskReferenceSnapshotDirty: false });
  await p.migrateSettings();
  return p.settings;
}
test("D1 default key exists", () => { assert.equal(P.DEFAULT_SETTINGS.taskDeduplicationAiModelProvider, ""); });
test("D1 pick saved under another provider is cleared by migration and ignored at runtime", async () => {
  const stale = cust({ aiModelProvider: "anthropic", chatModel: "claude-sonnet-5-5", sharedGenerationPrimary: { provider: "anthropic", model: "claude-sonnet-5-5" }, sharedGenerationFallback: { provider: "anthropic", model: "claude-haiku-5-5" }, taskDeduplicationAiModel: "gpt-y", taskDeduplicationAiModelProvider: "customopenai" });
  assert.notEqual(P.taskDeduplicationAiModel(stale), "gpt-y");
  const m = await migrated(stale);
  assert.equal(m.taskDeduplicationAiModel, "");
  assert.equal(m.taskDeduplicationAiModelProvider, "");
});
test("D1 same-provider tagged pick kept; legacy untagged pick keeps old rule", async () => {
  const ok = cust({ taskDeduplicationAiModel: "gpt-y", taskDeduplicationAiModelProvider: "customopenai" });
  assert.equal(P.taskDeduplicationAiModel(ok), "gpt-y");
  assert.equal((await migrated(ok)).taskDeduplicationAiModel, "gpt-y");
  const legacy = cust({ aiModelProvider: "anthropic", chatModel: "claude-sonnet-5-5", taskDeduplicationAiModel: "gpt-y" });
  assert.equal(P.taskDeduplicationAiModel(legacy), "gpt-y");
  assert.equal((await migrated(legacy)).taskDeduplicationAiModel, "gpt-y");
  assert.equal((await migrated(cust({ aiModelProvider: "gemini", chatModel: "gemini/gemini-3.5-flash", taskDeduplicationAiModel: "gpt-y" }))).taskDeduplicationAiModel, "");
});
test("D1 dropdown change saves provider tag; empty pick clears it", async () => {
  const plugin = { settings: cust(), saveSettings: async () => {} };
  rendered.length = 0; P.taskDeduplicationAiModelSetting({}, plugin);
  await rendered[0].onChange("gpt-y");
  assert.equal(plugin.settings.taskDeduplicationAiModel, "gpt-y");
  assert.equal(plugin.settings.taskDeduplicationAiModelProvider, "customopenai");
  await rendered[0].onChange("");
  assert.equal(plugin.settings.taskDeduplicationAiModelProvider, "");
});
test("D1 provider switch via save functions clears pick and tag", async () => {
  const mk = () => plug(cust({ taskDeduplicationAiModel: "gpt-y", taskDeduplicationAiModelProvider: "customopenai" }));
  let p = mk();
  await P.saveSharedModelReference(p, "primary", "anthropic", "claude-sonnet-5-5");
  assert.equal(p.settings.taskDeduplicationAiModelProvider, "");
  p = mk();
  await P.saveSharedReferenceField(p, "primary", "provider", "anthropic");
  assert.equal(p.settings.taskDeduplicationAiModel, "");
  assert.equal(p.settings.taskDeduplicationAiModelProvider, "");
});
test("D2 openwebui login mode credential needs plugin password", () => {
  const s = base({ aiModelProvider: "openwebui", chatModel: "m", openwebuiBaseUrl: "https://w.invalid", openwebuiApiKey: "", openwebuiJwt: "", openwebuiAuthMode: "login" });
  assert.equal(P.hasChatCredentialForModel(s, "m", { openwebuiLoginPassword: "pw" }), true);
  assert.equal(P.hasChatCredentialForModel(s, "m", { openwebuiLoginPassword: "" }), false);
  assert.equal(P.hasChatCredentialForModel(s, "m"), false);
  assert.equal(P.hasChatCredentialForModel(Object.assign({}, s, { openwebuiAuthMode: "apiKey" }), "m", { openwebuiLoginPassword: "pw" }), false);
});
test("D3 help text describes provider-aware automatic", () => {
  const src = fs.readFileSync(mainPath, "utf8");
  assert.ok(!src.includes("Automatic uses configured chat fallback model"));
  assert.ok(src.includes("Automatic uses the shared fallback model when it uses the same provider as the primary model, otherwise the primary model"));
  rendered.length = 0; P.taskDeduplicationAiModelSetting({}, { settings: anth() });
  assert.match(rendered[0].options[0][1], /^Automatic \(/);
});

(async () => {  let failed = 0;
  for (const [n, f] of cases) {
    try { await f(); console.log("ok  " + n); } catch (e) { failed++; console.log("FAIL " + n + "\n   " + String(e.message).split("\n")[0]); }
  }
  if (failed) { console.log(`dedup-model-provider-test: ${failed} FAILED`); process.exit(1); }
  console.log("dedup-model-provider-test: PASS");
})();
