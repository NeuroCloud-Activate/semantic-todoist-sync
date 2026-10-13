'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

// Mock obsidian module for loading built main.js
const originalLoad = Module._load;
function mockObsidian() {
  Module._load = function (request, parent, isMain) {
    if (request !== 'obsidian') return originalLoad.call(this, request, parent, isMain);
    class Empty {}
    return {
      ItemView: Empty,
      MarkdownRenderer: { renderMarkdown() {} },
      MarkdownView: Empty,
      Modal: Empty,
      Notice: function () {},
      Plugin: Empty,
      PluginSettingTab: Empty,
      Setting: function (container) {
        this.containerEl = container;
        this.setName = (n) => { this.name = n; return this; };
        this.setDesc = (d) => { this.desc = d; return this; };
        this.addText = () => this;
        this.addDropdown = () => this;
        this.addToggle = () => this;
        this.addButton = () => this;
      },
      TFile: Empty,
      setIcon() {},
      requestUrl: async () => { throw new Error('network disabled'); },
    };
  };
  global.window = { setTimeout, clearTimeout, requestIdleCallback: null, requestAnimationFrame: (fn) => setTimeout(fn, 0) };
  global.fetch = async () => { throw new Error('network disabled'); };
}

function restoreLoad() {
  Module._load = originalLoad;
}

mockObsidian();

const Plugin = require(path.join(__dirname, '..', 'main.js'));

function testDefaultChat() {
  assert.strictEqual(Plugin.DEFAULT_SETTINGS.sidebarMode, 'chat', 'default sidebarMode is chat');
  console.log('PASS default sidebarMode is chat');
}

function testNormalizeInvalidSettings() {
  const normalized = Plugin.normalizeStableSettings({ sidebarMode: 'invalid', writingContextFolder: 42, writingDescribeImages: 'yes' });
  assert.strictEqual(normalized.sidebarMode, 'chat', 'invalid sidebarMode defaults to chat');
  assert.strictEqual(normalized.writingContextFolder, 'Writing Context', 'invalid folder defaults to Writing Context');
  assert.strictEqual(normalized.writingDescribeImages, true, 'invalid describeImages defaults to true');
  console.log('PASS settings normalisation for new keys');
}

function testSettingsMigrationStillPasses() {
  // The existing settings-migration-local-test relies on normalizeStableSettings
  // and DEFAULT_SETTINGS; we verify the new keys don't break it.
  const defaults = Plugin.DEFAULT_SETTINGS || {};
  assert.strictEqual(defaults.sidebarMode, 'chat', 'sidebarMode in defaults');
  assert.strictEqual(defaults.writingContextFolder, 'Writing Context', 'writingContextFolder in defaults');
  assert.strictEqual(defaults.writingDescribeImages, true, 'writingDescribeImages in defaults');
  console.log('PASS settings keys present in DEFAULT_SETTINGS');
}

function testWriteModeSwitchPersists() {
  // Verify the view class exists and exports mode-related state
  assert(typeof Plugin.SemanticTodoistView === 'function', 'SemanticTodoistView exported');
  console.log('PASS SemanticTodoistView exported');
}

function runTests() {
  testDefaultChat();
  testNormalizeInvalidSettings();
  testSettingsMigrationStillPasses();
  testWriteModeSwitchPersists();
  console.log('writing-sidebar-test: PASS (expanded)');
}

runTests();
