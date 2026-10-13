'use strict';

// Task 5: image description through the configured provider.
// Stubs Obsidian `requestUrl`, captures request bodies, and asserts the
// per-provider vision shapes plus one text-call regression case.

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

const INSTRUCTION = 'Describe this image for use as research evidence. Transcribe all visible text, tables and figure labels verbatim; then summarise what it shows.';
const DESCRIPTION = 'FICTIONAL_IMAGE_DESCRIPTION';
const BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const BASE64 = Buffer.from(BYTES).toString('base64');
const DATA_URI = `data:image/png;base64,${BASE64}`;

function makePlugin(settings = {}) {
  const plugin = Object.create(Plugin.prototype);
  plugin.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, {
    aiModelProvider: 'openrouter',
    chatModel: 'fictional-vision-model',
    enableAiModelFallback: false,
    openrouterApiKey: 'FICTIONAL_OPENROUTER_KEY',
    ...settings
  });
  plugin.saveSettings = async () => {};
  plugin.logLocal = () => {};
  plugin.setSidebarStatus = () => {};
  plugin.queueSettingsSave = () => {};
  plugin.withAiActivity = async (label, operation) => operation();
  return plugin;
}

function reset(scripted) {
  requestCalls.length = 0;
  scriptedResponses = scripted.slice();
}

function lastBody() {
  assert.strictEqual(requestCalls.length, 1, 'exactly one provider request');
  return JSON.parse(requestCalls[0].body);
}

function chatCompletionsFixture() {
  return [{ status: 200, json: { choices: [{ message: { content: DESCRIPTION } }], usage: {} }, text: 'FICTIONAL_CHAT_COMPLETIONS' }];
}

(async () => {
  assert.strictEqual(typeof Plugin.prototype.describeImage, 'function', 'describeImage exists');

  // OpenRouter: OpenAI-compatible image_url data URI.
  reset(chatCompletionsFixture());
  let text = await makePlugin().describeImage(BYTES, 'image/png');
  assert.strictEqual(text, DESCRIPTION);
  let body = lastBody();
  assert.strictEqual(body.model, 'fictional-vision-model');
  assert.ok(Array.isArray(body.messages[1].content), 'vision call uses content parts');
  assert.deepStrictEqual(body.messages[1].content[0], { type: 'text', text: INSTRUCTION });
  assert.deepStrictEqual(body.messages[1].content[1], { type: 'image_url', image_url: { url: DATA_URI } });

  // Custom OpenAI-compatible endpoint: same image_url shape.
  reset(chatCompletionsFixture());
  text = await makePlugin({
    aiModelProvider: 'customopenai',
    chatModel: 'fictional-custom-model',
    customOpenAIBaseUrl: 'https://custom.invalid/v1',
    customOpenAIApiKey: 'FICTIONAL_CUSTOM_KEY'
  }).describeImage(BYTES, 'image/png');
  assert.strictEqual(text, DESCRIPTION);
  body = lastBody();
  assert.strictEqual(body.messages[1].content[1].image_url.url, DATA_URI);

  // OpenWebUI: same image_url shape, explicit non-streaming.
  reset(chatCompletionsFixture());
  text = await makePlugin({
    aiModelProvider: 'openwebui',
    chatModel: 'fictional-openwebui-model',
    openwebuiBaseUrl: 'https://openwebui.invalid',
    openwebuiApiKey: 'FICTIONAL_OPENWEBUI_KEY'
  }).describeImage(BYTES, 'image/png');
  assert.strictEqual(text, DESCRIPTION);
  body = lastBody();
  assert.strictEqual(body.stream, false);
  assert.strictEqual(body.messages[1].content[1].image_url.url, DATA_URI);

  // OpenAI Responses API: input_image part.
  reset([{ status: 200, json: { id: 'resp-fictional', model: 'gpt-fictional', status: 'completed', output_text: DESCRIPTION, usage: {} }, text: 'FICTIONAL_RESPONSES' }]);
  text = await makePlugin({ aiModelProvider: 'openai', chatModel: 'gpt-fictional', openaiApiKey: 'FICTIONAL_OPENAI_KEY' }).describeImage(BYTES, 'image/png');
  assert.strictEqual(text, DESCRIPTION);
  body = lastBody();
  assert.strictEqual(body.model, 'gpt-fictional');
  const userContent = body.input.find((item) => item.role === 'user').content;
  assert.ok(userContent.some((part) => part.type === 'input_text' && part.text === INSTRUCTION), 'instruction text preserved');
  assert.ok(userContent.some((part) => part.type === 'input_image' && part.image_url === DATA_URI), 'input_image part present');

  // Anthropic: base64 image source.
  reset([{ status: 200, json: { id: 'msg-fictional', model: 'claude-fictional', content: [{ type: 'text', text: DESCRIPTION }], usage: { input_tokens: 1, output_tokens: 2 } }, text: 'FICTIONAL_ANTHROPIC' }]);
  text = await makePlugin({ aiModelProvider: 'anthropic', chatModel: 'claude-fictional', anthropicApiKey: 'FICTIONAL_ANTHROPIC_KEY' }).describeImage(BYTES, 'image/png');
  assert.strictEqual(text, DESCRIPTION);
  body = lastBody();
  const anthropicContent = body.messages[0].content;
  assert.ok(Array.isArray(anthropicContent), 'vision call uses content blocks');
  assert.ok(anthropicContent.some((part) => part.type === 'text' && part.text === INSTRUCTION), 'instruction text preserved');
  assert.ok(anthropicContent.some((part) => part.type === 'image'
    && part.source.type === 'base64' && part.source.media_type === 'image/png' && part.source.data === BASE64), 'base64 image source present');

  // Gemini: inline_data part.
  reset([{ status: 200, json: { candidates: [{ content: { parts: [{ text: DESCRIPTION }] } }], usageMetadata: {} }, text: 'FICTIONAL_GEMINI' }]);
  text = await makePlugin({ aiModelProvider: 'gemini', chatModel: 'gemini-fictional-flash', googleApiKey: 'FICTIONAL_GEMINI_KEY' }).describeImage(BYTES, 'image/png');
  assert.strictEqual(text, DESCRIPTION);
  body = lastBody();
  const geminiParts = body.contents[0].parts;
  assert.ok(geminiParts.some((part) => part.text === INSTRUCTION), 'instruction text preserved');
  assert.ok(geminiParts.some((part) => part.inline_data && part.inline_data.mime_type === 'image/png' && part.inline_data.data === BASE64), 'inline_data part present');

  // Regression: a normal text call carries no image keys and is byte-identical.
  reset(chatCompletionsFixture());
  const plain = await makePlugin().openaiResponse({ operation: 'chat', model: 'fictional-vision-model', system: 'FICTIONAL_SYSTEM', user: 'FICTIONAL_USER' });
  assert.strictEqual(plain, DESCRIPTION);
  body = lastBody();
  assert.deepStrictEqual(body, {
    model: 'fictional-vision-model',
    messages: [
      { role: 'system', content: 'FICTIONAL_SYSTEM' },
      { role: 'user', content: 'FICTIONAL_USER' }
    ]
  });

  // Provider error rejects so the caller can skip the file.
  reset([{ status: 500, json: { error: { message: 'FICTIONAL_FAILURE' } }, text: 'FICTIONAL_FAILURE' }]);
  await assert.rejects(() => makePlugin().describeImage(BYTES, 'image/png'));

  // Empty image bytes reject with vision-unsupported and make no request.
  reset(chatCompletionsFixture());
  await assert.rejects(() => makePlugin().describeImage(new Uint8Array(0), 'image/png'), (error) => error.code === 'vision-unsupported');
  assert.strictEqual(requestCalls.length, 0, 'unrepresentable image makes no request');

  console.log('writing-vision-test: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
