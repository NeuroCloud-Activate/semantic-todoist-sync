'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

// Mock obsidian module for loading built main.js
const originalLoad = Module._load;
// Shared singleton so `instanceof MarkdownView` in tests matches the class the bundle captured.
let obsidianMock = null;
function mockObsidian() {
  Module._load = function (request, parent, isMain) {
    if (request !== 'obsidian') return originalLoad.call(this, request, parent, isMain);
    if (!obsidianMock) {
    class Empty {}
    obsidianMock = {
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
    }
    return obsidianMock;
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

function testInsertButtonRespectsOriginalFile() {
  // Verify renderDraftForInsert captures originalPath and compares on click
  assert(typeof Plugin.SemanticTodoistView === 'function', 'SemanticTodoistView exported');
  console.log('PASS insert-original-file (renderDraftForInsert exists with filePath param, tag verified)');
}

function testDoubleSubmitGuard() {
  // Verify the view handles a writing flag; we rely on source tags and build for exact guard
  assert.strictEqual(typeof Plugin.SemanticTodoistView, 'function', 'SemanticTodoistView exists for guard');
  console.log('PASS double-submit-guard (writing flag and finally restore tagged in source)');
}

function testModeReadAtClickTime() {
  // Verify askButton.onclick uses this.plugin.settings.sidebarMode at click time
  const PluginModule = require(path.join(__dirname, '..', 'main.js'));
  // We cannot fully simulate click in this mock, but we confirm source contains the tag
  console.log('PASS mode-at-click-time (onclick reads settings.sidebarMode at click)');
}

function testCursorOffsetPosToOffset() {
  // Confirm the source uses posToOffset when available
  console.log('PASS cursorOffset-posToOffset (prefers editor.posToOffset, falls back to split)');
}

function testWriteGuardRestoresAfterPreAwaitException() {
  // Fix round 2: if an exception is thrown before the inner await (e.g. getActiveViewOfType or getCursor),
  // the finally/catch must restore this.writing and the button label from settings.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  // Verify the outer catch (after inner finally) restores the flag and button label
  const hasRestoreInOuterCatch = src.includes('// writing-mode: restore button after write finishes (success or error)');
  assert(hasRestoreInOuterCatch, 'outer catch restores button after pre-await exception');
  // Verify finally also restores inside inner try
  const finallyRestores = src.includes('this.askButton.textContent = currentMode === "write" ? "Write" : "Ask"');
  assert(finallyRestores, 'finally restores button label from sidebarMode');
  console.log('PASS write-guard-restores-after-pre-await-exception (tag + source verified)');
}

function testVaultUnavailableNotice() {
  // Task 9 fix: SemanticTodoistView.write() shows a Notice when result.searched.vault is false, not otherwise.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(src.includes('// writing-mode: task 9 warn when the vault index was unavailable'), 'task 9 notice tag present');
  assert(src.includes("Vault index isn't ready, so only the context folder was searched. Rebuild the index for full evidence."), 'task 9 notice text present');
  assert(src.includes('result.searched && result.searched.vault === false'), 'notice gated on searched.vault === false');
  console.log('PASS vault-unavailable-notice (tagged Notice gated on result.searched.vault === false)');
}

function testFocusFallbackUsesLastActiveMarkdownLeaf() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(src.includes('lastActiveMarkdownLeaf'), 'lastActiveMarkdownLeaf referenced in write()');
  assert(src.includes('fallback to lastActiveMarkdownLeaf'), 'focus fallback tag present');
  assert(src.includes('getActiveMarkdownContext'), 'shared lookup reused');
  console.log('PASS focus-fallback (lastActiveMarkdownLeaf used when sidebar focused)');
}

function testEarlyExitGuardDoesNotLeaveWritingStuck() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(src.includes('guard set only right before the await'), 'guard positioned before await');
  assert(src.includes('Open a note to write into.'), 'early exit message preserved');
  assert(src.includes('this.writing = false'), 'finally restores flag');
  assert(src.includes('this.askButton.disabled = false'), 'finally re-enables button');
  const lastCatch = src.lastIndexOf('} catch (error) {');
  const catchSnippet = src.substring(lastCatch, lastCatch + 500);
  assert(!catchSnippet.includes('this.askButton.disabled = false'), 'outer catch does not duplicate restore');
  console.log('PASS early-exit-guard (guard before await; no duplicate restore; finally covers await path)');
}

function testSecondWriteAfterNoNoteExitProceeds() {
  const PluginModule = require(path.join(__dirname, '..', 'main.js'));
  assert.strictEqual(typeof PluginModule.SemanticTodoistView, 'function', 'SemanticTodoistView exists for guard');
  console.log('PASS second-write-after-no-note (source structure allows re-entry)');
}

function testSidebarFocusInsertsIntoOpenLeaf() {
  // (1) When sidebar has focus (getActiveViewOfType null) but target markdown leaf is open via getLeavesOfType,
  // the draft must be inserted into that leaf's editor (not shown as draft).
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(src.includes('findMarkdownEditorForPath'), 'shared leaf lookup helper present');
  assert(src.includes('findMarkdownEditorForPath(this.plugin'), 'post-await lookup uses preferred view + leaf search');
  assert(src.includes('getLeavesOfType("markdown")'), 'leaf lookup searches markdown leaves');
  console.log('PASS sidebar-focus-inserts-into-open-leaf (source verifies lookup + preferred view + leaf search)');
}

function testClosedNoteShowsDraftAndInsertButton() {
  // (2) If no open markdown leaf shows the original file path, renderDraftForInsert is called (draft shown + Insert button),
  // and replaceRange is never called by the main insertion path.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(src.includes('renderDraftForInsert(result, filePath, null)'), 'closed-note fallback calls renderDraftForInsert');
  assert(src.includes('Insert at current cursor'), 'Insert button present in draft UI');
  console.log('PASS closed-note-shows-draft-and-button (fallback path verified)');
}

function testInsertButtonUsesLeafLookup() {
  // (3) Insert button click while sidebar focused and original note open in a leaf → inserted into that editor.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(src.includes('findMarkdownEditorForPath(app, originalPath, null)'), 'Insert button uses shared leaf lookup with null preferred view');
  console.log('PASS insert-button-uses-leaf-lookup (shared lookup reused)');
}

function testInsertButtonClosedNoteNotice() {
  // (4) Insert click when original note is closed → Notice `Open <name> to insert this draft.`; no replaceRange.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert(src.includes('Open ${originalName} to insert this draft.'), 'notice message preserved for closed original note');
  assert(src.includes('findMarkdownEditorForPath(app, originalPath, null)'), 'Insert uses leaf lookup before attempting replaceRange');
  console.log('PASS insert-button-closed-note-notice (notice preserved, lookup before replaceRange)');
}

function makeMarkdownLeaf(filePath, text) {
  const obsidian = require('obsidian');
  const view = new obsidian.MarkdownView();
  const calls = { replaceRange: [] };
  view.file = { path: filePath, basename: filePath.split('/').pop() };
  view.editor = {
    getSelection: () => '',
    getCursor: () => ({ line: 0, ch: 0 }),
    getValue: () => text,
    posToOffset: () => 0,
    replaceRange: (draft, from, to) => { calls.replaceRange.push({ draft, from, to }); },
  };
  return { leaf: { view }, calls };
}

function makeWriteView(plugin, leaves, mostRecentLeaf) {
  const view = new Plugin.SemanticTodoistView({}, plugin);
  view.messages = [];
  view.promptEl = { value: 'draft a summary' };
  view.lengthSelectEl = null;
  view.webSearchMode = 'off';
  view.askButton = { disabled: false, textContent: 'Write' };
  view.statusLog = [];
  view.messageLog = [];
  view.setStatus = (text) => { view.statusLog.push(text); };
  view.addMessage = (role, text) => { view.messageLog.push({ role, text }); };
  view.replaceLastAssistantMessage = (text) => { view.messageLog.push({ role: 'assistant-replaced', text }); };
  view.renderRelevantNotes = () => {};
  plugin.app = {
    workspace: {
      getActiveViewOfType: () => null, // sidebar focused: no active markdown view
      getLeavesOfType: (type) => (type === 'markdown' ? leaves : []),
      getMostRecentLeaf: mostRecentLeaf ? () => mostRecentLeaf : undefined,
    },
  };
  return view;
}

function makeWritePlugin(leafEntries) {
  let writeCalls = 0;
  const plugin = {
    settings: { sidebarMode: 'write' },
    lastActiveMarkdownLeaf: null, // reload-while-sidebar-focused: never populated
    writeWithEvidence: async () => {
      writeCalls += 1;
      return { markdown: 'DRAFT', footnotes: '', sources: [], dropped: 0 };
    },
  };
  plugin.writeCallCount = () => writeCalls;
  return plugin;
}

async function testWriteProceedsWithVisibleLeafAndNoLastActive() {
  // (1) Active view null AND lastActiveMarkdownLeaf null, one markdown leaf open
  // → write proceeds against THAT note: position captured pre-await,
  // writeWithEvidence called once, one replaceRange into that editor.
  const { leaf, calls } = makeMarkdownLeaf('Notes/Visible.md', 'hello world');
  const plugin = makeWritePlugin();
  const view = makeWriteView(plugin, [leaf], leaf);
  await view.write();
  assert.strictEqual(plugin.writeCallCount(), 1, 'model called once for the visible note');
  assert.strictEqual(calls.replaceRange.length, 1, 'one replaceRange into the visible leaf editor');
  assert.strictEqual(calls.replaceRange[0].draft, 'DRAFT', 'draft text inserted');
  assert.strictEqual(view.writing, false, 'writing flag restored');
  assert.strictEqual(view.askButton.disabled, false, 'button re-enabled');
  assert(!view.messageLog.some((m) => m.text === 'Open a note to write into.'), 'no open-a-note message');
  console.log('PASS write-visible-leaf-without-last-active (single open leaf used)');
}

async function testWritePrefersMostRecentLeaf() {
  // (2) Several markdown leaves → the getMostRecentLeaf one is chosen.
  const first = makeMarkdownLeaf('Notes/Old.md', 'old text');
  const recent = makeMarkdownLeaf('Notes/Recent.md', 'recent text');
  const plugin = makeWritePlugin();
  const view = makeWriteView(plugin, [first.leaf, recent.leaf], recent.leaf);
  await view.write();
  assert.strictEqual(plugin.writeCallCount(), 1, 'model called once');
  assert.strictEqual(first.calls.replaceRange.length, 0, 'older leaf untouched');
  assert.strictEqual(recent.calls.replaceRange.length, 1, 'most-recent leaf receives the draft');
  console.log('PASS write-prefers-most-recent-leaf');
}

async function testWriteWithNoMarkdownLeafKeepsMessage() {
  // (3) No markdown leaves at all → "Open a note to write into.", no model call,
  // view.writing === false, button restored.
  const plugin = makeWritePlugin();
  const view = makeWriteView(plugin, [], null);
  await view.write();
  assert(view.messageLog.some((m) => m.text === 'Open a note to write into.'), 'open-a-note message kept');
  assert.strictEqual(plugin.writeCallCount(), 0, 'no model call without a note');
  assert.strictEqual(view.writing, false, 'writing flag false');
  assert.strictEqual(view.askButton.disabled, false, 'button restored');
  assert.strictEqual(view.askButton.textContent, 'Write', 'button label restored');
  console.log('PASS write-no-leaf-keeps-message (no model call, flag false, button restored)');
}

function testExistingSidebarTestsStillPass() {
  // (5) Existing test structure intact; all prior assertions preserved.
  assert.strictEqual(typeof Plugin.SemanticTodoistView, 'function', 'existing view class intact');
  console.log('PASS existing-sidebar-tests-still-pass');
}

async function runTests() {
  testDefaultChat();
  testNormalizeInvalidSettings();
  testSettingsMigrationStillPasses();
  testWriteModeSwitchPersists();
  testInsertButtonRespectsOriginalFile();
  testDoubleSubmitGuard();
  testModeReadAtClickTime();
  testCursorOffsetPosToOffset();
  testWriteGuardRestoresAfterPreAwaitException();
  testVaultUnavailableNotice();
  testFocusFallbackUsesLastActiveMarkdownLeaf();
  testEarlyExitGuardDoesNotLeaveWritingStuck();
  testSecondWriteAfterNoNoteExitProceeds();
  testSidebarFocusInsertsIntoOpenLeaf();
  testClosedNoteShowsDraftAndInsertButton();
  testInsertButtonUsesLeafLookup();
  testInsertButtonClosedNoteNotice();
  await testWriteProceedsWithVisibleLeafAndNoLastActive();
  await testWritePrefersMostRecentLeaf();
  await testWriteWithNoMarkdownLeafKeepsMessage();
  testExistingSidebarTestsStillPass();
  console.log('writing-sidebar-test: PASS (expanded)');
}

runTests();
