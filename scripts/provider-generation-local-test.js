'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');
const calls = [];
let scriptedResponses = [];
let blockRequests = false;
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
      if (blockRequests) return new Promise(() => {});
      if (scriptedResponses.length) return scriptedResponses.shift();
      const body = options.url.includes('/auths/signin')
        ? { token: 'FICTIONAL_LOGIN_TOKEN' }
        : options.url.includes('/responses')
          ? { status: 'completed', output_text: 'FICTIONAL_OPENAI_RESPONSE' }
          : options.url.includes('generativelanguage.googleapis.com')
            ? { candidates: [{ content: { parts: [{ text: 'FICTIONAL_GEMINI_RESPONSE' }] } }] }
            : { choices: [{ message: { content: 'FICTIONAL_PROVIDER_RESPONSE' } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } };
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
  plugin.setSidebarStatus = () => {};
  plugin.logLocal = () => {};
  plugin.tokenUsage = [];
  plugin.recordAiTokenUsage = (...args) => { plugin.tokenUsage.push(args); };
  plugin.saveSettings = async () => {};
  plugin.lastAiResponseModel = '';
  return plugin;
};

(async () => {
  calls.length = 0;
  const openrouter = makePlugin({
    aiModelProvider: 'openrouter',
    chatModel: 'openai/gpt-5.6-luna',
    chatFallbackModel: 'openai/gpt-5.6-terra',
    openrouterApiKey: 'FICTIONAL_OPENROUTER_KEY'
  });
  assert.strictEqual(await openrouter.openaiResponse({ model: 'openai/gpt-5.6-luna', system: 'FICTIONAL_SYSTEM', user: 'FICTIONAL_USER' }), 'FICTIONAL_PROVIDER_RESPONSE');
  assert.strictEqual(calls.length, 1, 'primary generation uses one request');
  assert.strictEqual(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.strictEqual(calls[0].headers.authorization, 'Bearer FICTIONAL_OPENROUTER_KEY');
  const openrouterBody = JSON.parse(calls[0].body);
  assert.strictEqual(openrouterBody.model, 'openai/gpt-5.6-luna');
  assert.strictEqual(openrouterBody.reasoning_effort, 'medium', 'supported reasoning is forwarded');
  assert.strictEqual(openrouter.tokenUsage[0][2].total_tokens, 5, 'provider usage is normalized to the recorder');

  calls.length = 0;
  const openai = makePlugin({ aiModelProvider: 'openai', chatModel: 'gpt-5.6-luna', openaiApiKey: 'FICTIONAL_OPENAI_KEY' });
  assert.strictEqual(await openai.openaiResponse({ model: 'gpt-5.6-luna', system: 'FICTIONAL_SYSTEM', user: 'FICTIONAL_USER' }), 'FICTIONAL_OPENAI_RESPONSE');
  assert.strictEqual(calls[0].url, 'https://api.openai.com/v1/responses');

  calls.length = 0;
  const gemini = makePlugin({ aiModelProvider: 'gemini', chatModel: 'gemini-3.5-flash', googleApiKey: 'FICTIONAL_GEMINI_KEY' });
  assert.strictEqual(await gemini.openaiResponse({ model: 'gemini-3.5-flash', system: 'FICTIONAL_SYSTEM', user: 'FICTIONAL_USER' }), 'FICTIONAL_GEMINI_RESPONSE');
  assert.ok(calls[0].url.includes('generativelanguage.googleapis.com'));

  calls.length = 0;
  const custom = makePlugin({
    aiModelProvider: 'customopenai',
    chatModel: 'fictional-custom-model',
    customOpenAIBaseUrl: 'https://sentinel.invalid/v1/',
    customOpenAIApiKey: 'FICTIONAL_CUSTOM_KEY'
  });
  scriptedResponses = [{ status: 200, json: { choices: [{ message: { content: '```json\n{"ok":true}\n```' } }] }, text: 'FICTIONAL_STRUCTURED_RESPONSE' }];
  assert.strictEqual(await custom.openaiResponse({ model: 'fictional-custom-model', system: 'FICTIONAL_SYSTEM', user: 'FICTIONAL_USER', jsonSchema: { type: 'object', properties: {} } }), '{"ok":true}', 'structured compatible output is normalized to JSON');
  assert.strictEqual(calls[0].url, 'https://sentinel.invalid/v1/chat/completions');
  assert.ok(JSON.parse(calls[0].body).response_format, 'structured output stays in the provider request');
  assert.ok(!Object.prototype.hasOwnProperty.call(JSON.parse(calls[0].body), 'reasoning_effort'), 'unsupported reasoning is omitted');
  scriptedResponses = [];

  calls.length = 0;
  const timeoutPlugin = makePlugin({ aiModelProvider: 'openrouter', openrouterApiKey: 'FICTIONAL_OPENROUTER_KEY' });
  blockRequests = true;
  await assert.rejects(() => timeoutPlugin.openAiCompatibleRequest('openrouter', '/models', undefined, { timeoutMs: 5 }), (error) => error.code === 'timeout');
  blockRequests = false;
  assert.strictEqual(calls[calls.length - 1].signal.aborted, true, 'provider timeout aborts the underlying request');

  calls.length = 0;
  const webui = makePlugin({
    aiModelProvider: 'openwebui',
    chatModel: 'fictional-webui-model',
    openwebuiBaseUrl: 'https://sentinel.invalid/api',
    openwebuiApiKey: 'FICTIONAL_WEBUI_TOKEN',
    openwebuiAuthMode: 'api-key'
  });
  await webui.openaiResponse({ model: 'fictional-webui-model', system: 'FICTIONAL_SYSTEM', user: 'FICTIONAL_USER' });
  assert.strictEqual(calls.length, 1, 'direct OpenWebUI token does not perform login');
  assert.strictEqual(calls[0].url, 'https://sentinel.invalid/api/v1/chat/completions');

  calls.length = 0;
  scriptedResponses = [
    { status: 503, json: { error: { code: 'overloaded', message: 'FICTIONAL transient error' } }, text: 'FICTIONAL transient error' },
    { status: 200, json: { choices: [{ message: { content: 'FICTIONAL FALLBACK_RESPONSE' } }] }, text: 'FICTIONAL FALLBACK_RESPONSE' }
  ];
  const fallback = makePlugin({ aiModelProvider: 'openrouter', chatModel: 'fictional-primary', chatFallbackModel: 'fictional-fallback', openrouterApiKey: 'FICTIONAL_OPENROUTER_KEY' });
  assert.strictEqual(await fallback.openaiResponse({ model: 'fictional-primary', system: 'FICTIONAL_SYSTEM', user: 'FICTIONAL_USER' }), 'FICTIONAL FALLBACK_RESPONSE');
  assert.strictEqual(calls.length, 2, 'eligible transient failure permits one fallback');
  assert.strictEqual(JSON.parse(calls[1].body).model, 'fictional-fallback');

  calls.length = 0;
  scriptedResponses = [{ status: 400, json: { error: { code: 'bad-request', message: 'token=FICTIONAL_SECRET_TOKEN endpoint=https://sentinel.invalid/private' } }, text: 'FICTIONAL permanent error' }];
  await assert.rejects(() => fallback.openaiResponse({ model: 'fictional-primary', system: 'FICTIONAL_SYSTEM', user: 'FICTIONAL_USER' }), (error) => /400/.test(error.message)
    && !error.message.includes('FICTIONAL_SECRET_TOKEN')
    && !error.message.includes('https://sentinel.invalid/private'));
  assert.strictEqual(calls.length, 1, 'ineligible failure does not trigger a second request');
  scriptedResponses = [];

  calls.length = 0;
  scriptedResponses = [
    { status: 408, json: { error: { code: 'request-timeout', message: 'FICTIONAL transient timeout' } }, text: 'FICTIONAL transient timeout' },
    { status: 200, json: { choices: [{ message: { content: 'FICTIONAL 408 FALLBACK_RESPONSE' } }] }, text: 'FICTIONAL 408 FALLBACK_RESPONSE' }
  ];
  assert.strictEqual(await fallback.openaiResponse({ model: 'fictional-primary', system: 'FICTIONAL_SYSTEM', user: 'FICTIONAL_USER' }), 'FICTIONAL 408 FALLBACK_RESPONSE');
  assert.strictEqual(calls.length, 2, 'normalized retryable 408 permits one fallback');

  calls.length = 0;
  scriptedResponses = [{ status: 404, json: { error: { code: 'not-found', message: 'FICTIONAL missing model' } }, text: 'FICTIONAL missing model' }];
  await assert.rejects(() => fallback.openaiResponse({ model: 'fictional-primary', system: 'FICTIONAL_SYSTEM', user: 'FICTIONAL_USER' }), /404/);
  assert.strictEqual(calls.length, 1, 'normalized non-retryable 404 does not trigger a fallback');
  scriptedResponses = [];

  calls.length = 0;
  scriptedResponses = [{ status: 200, json: { data: [{ id: 'fictional-chat-model' }, { id: 'fictional-embedding-model' }] }, text: 'FICTIONAL_MODEL_CATALOG' }];
  const discovered = makePlugin({ aiModelProvider: 'openrouter', openrouterApiKey: 'FICTIONAL_OPENROUTER_KEY' });
  const catalog = await discovered.refreshOpenAIModels(false);
  assert.deepStrictEqual(catalog.generation, ['fictional-chat-model']);
  assert.deepStrictEqual(catalog.embedding, ['fictional-embedding-model']);
  assert.deepStrictEqual(discovered.settings.providerGenerationModels.openrouter, ['fictional-chat-model']);
  scriptedResponses = [];

  calls.length = 0;
  const loginWebui = makePlugin({
    aiModelProvider: 'openwebui',
    chatModel: 'fictional-webui-model',
    openwebuiBaseUrl: 'https://sentinel.invalid/api',
    openwebuiAuthMode: 'login',
    openwebuiEmail: 'fictional@example.invalid'
  });
  loginWebui.openwebuiLoginPassword = 'FICTIONAL_LOGIN_PASSWORD';
  await loginWebui.openaiResponse({ model: 'fictional-webui-model', system: 'FICTIONAL_SYSTEM', user: 'FICTIONAL_USER' });
  assert.strictEqual(calls.length, 2, 'login exchange precedes one generation request');
  assert.strictEqual(loginWebui.openwebuiLoginPassword, '', 'login password is cleared after exchange');
  assert.ok(!Object.prototype.hasOwnProperty.call(loginWebui.settings, 'openwebuiLoginPassword'), 'login password is not persisted');

  calls.length = 0;
  scriptedResponses = [{ status: 401, json: { error: { message: 'FICTIONAL login rejected' } }, text: 'FICTIONAL login rejected' }];
  const failedLogin = makePlugin({ aiModelProvider: 'openwebui', chatModel: 'fictional-webui-model', openwebuiBaseUrl: 'https://sentinel.invalid/api', openwebuiAuthMode: 'login', openwebuiEmail: 'fictional@example.invalid' });
  failedLogin.openwebuiLoginPassword = 'FICTIONAL_LOGIN_PASSWORD';
  await assert.rejects(() => failedLogin.openaiResponse({ model: 'fictional-webui-model', system: 'FICTIONAL_SYSTEM', user: 'FICTIONAL_USER' }), (error) => /401/.test(error.message)
    && !error.message.includes('FICTIONAL_LOGIN_PASSWORD')
    && !error.message.includes('https://sentinel.invalid'));
  assert.strictEqual(failedLogin.openwebuiLoginPassword, '', 'failed login also clears the password');
  scriptedResponses = [];

  console.log('provider-generation-local-test: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
