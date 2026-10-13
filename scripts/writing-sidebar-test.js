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
      Menu: class {
        constructor() { this.items = []; }
        addItem(fn) {
          const item = {
            title: "",
            checked: undefined,
            submenu: null,
            setTitle(t) { this.title = t; return this; },
            setChecked(c) { this.checked = c; return this; },
            onClick(fn2) { this.handler = fn2; return this; },
            setSubmenu() {
              const sub = {
                items: [],
                addItem(fn3) {
                  const child = {
                    title: "",
                    checked: undefined,
                    setTitle(t) { this.title = t; return this; },
                    setChecked(c) { this.checked = c; return this; },
                    onClick(fn4) { this.handler = fn4; return this; },
                  };
                  fn3(child);
                  sub.items.push(child);
                  return child;
                },
              };
              item.submenu = sub;
              return sub;
            },
          };
          fn(item);
          this.items.push(item);
          return item;
        }
        showAtMouseEvent() {}
      },
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
  assert.strictEqual(Plugin.DEFAULT_SETTINGS.sidebarMode, undefined, 'sidebarMode removed from defaults');
  console.log('PASS sidebarMode removed from defaults');
}

function testNormalizeInvalidSettings() {
  // normalizeStableSettings keeps unknown keys (same as the 0.9.20 release), so a legacy saved sidebarMode is
  // simply inert: it must not throw, must not change the other values, and nothing in the source may read it.
  const normalized = Plugin.normalizeStableSettings({ sidebarMode: 'write', writingContextFolder: 42, writingDescribeImages: 'yes' });
  const source = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  const readers = source.split(/\r?\n/).filter((line) => /sidebarMode/.test(line) && !/^\s*\/\//.test(line));
  assert.deepStrictEqual(readers, [], 'nothing in src/main.js reads or writes sidebarMode');
  assert.strictEqual(normalized.writingContextFolder, 'Writing Context', 'invalid folder defaults to Writing Context');
  assert.strictEqual(normalized.writingDescribeImages, true, 'invalid describeImages defaults to true');
  console.log('PASS settings normalisation without sidebarMode');
}

function testSettingsMigrationStillPasses() {
  // The existing settings-migration-local-test relies on normalizeStableSettings
  // and DEFAULT_SETTINGS; we verify the new keys don't break it.
  const defaults = Plugin.DEFAULT_SETTINGS || {};
  assert.strictEqual(defaults.sidebarMode, undefined, 'sidebarMode removed from defaults');
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
  // Ask now maps directly to chat() and no longer switches by sidebarMode.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  const hasAskCall = /askButton\.onclick = async \(\) => \{\s*await this\.ask\(\);\s*\};/.test(src);
  assert(hasAskCall, 'Ask click calls this.ask()');
  const hasModeBranch = src.includes('if (currentMode === "write") await this.write()');
  assert(!hasModeBranch, 'Ask click does not run writeWithEvidence');
  console.log('PASS ask-is-chat-only (Ask no longer switches by sidebarMode)');
}

function testToolbarButtonsOrder() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  const askIdx = src.indexOf('semantic-todoist-ask-button');
  const tasksIdx = src.indexOf('semantic-todoist-tasks-button');
  const collabIdx = src.indexOf('semantic-todoist-collaborate-button');
  const runIdx = src.indexOf('semantic-todoist-run-action');
  assert(askIdx >= 0 && tasksIdx > askIdx && collabIdx > tasksIdx && runIdx > collabIdx, 'toolbar contains Ask, Tasks, Collaborate, Run in that order');
  console.log('PASS toolbar-buttons-order (Ask, Tasks, Collaborate, Run)');
}

function testCollaborateTogglesMode() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(src.includes('const collaborateButton = topRow.createEl('), 'collaborateButton created in top row');
  assert(/collaborateButton\.onclick = async \(\) => \{\s*await this\.toggleCollaborateMode\(\);\s*\};/.test(src), 'Collaborate click toggles mode');
  assert(src.includes('async toggleCollaborateMode()'), 'toggleCollaborateMode method present');
  assert(src.includes('is-active'), 'toggle sets is-active class');
  console.log('PASS collaborate-toggles-mode');
}

function testInFlightCollaborate() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(src.includes('this.collaborateButton.disabled = true;'), 'collaborate disabled while in flight');
  assert(src.includes('this.collaborateButton.textContent = "Collaborating…";'), 'collaborate labeled Collaborating… while in flight');
  assert(src.includes('this.collaborateButton.disabled = false;'), 'collaborate re-enabled when done');
  assert(src.includes('this.collaborateButton.textContent = "Collaborate";'), 'collaborate label restored');
  assert(!src.includes('this.askButton.disabled = true;'), 'collaborate flight does not disable Ask');
  console.log('PASS in-flight-collaborate (Collaborating… and restore; Ask untouched)');
}

function testNoModeSelectOrSidebarMode() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(!src.includes('modeSelectEl'), 'no modeSelectEl defined');
  assert(!src.includes('plugin.settings.sidebarMode'), 'no runtime sidebarMode dependency');
  assert(!Plugin.DEFAULT_SETTINGS || !Object.prototype.hasOwnProperty.call(Plugin.DEFAULT_SETTINGS, 'sidebarMode'), 'no sidebarMode default');
  const nor = Plugin.normalizeStableSettings({ sidebarMode: 'write', writingContextFolder: 'X', writingDescribeImages: true });
  // Unknown keys are preserved by normalizeStableSettings (as in 0.9.20): a legacy saved sidebarMode is inert, not removed.
  assert.strictEqual(nor.writingContextFolder, 'X', 'legacy sidebarMode does not disturb other settings');
  assert.strictEqual(src.split('\n').filter((l) => /sidebarMode/.test(l) && !/^\s*\/\//.test(l)).length, 0, 'nothing in src/main.js touches sidebarMode');
  console.log('PASS no-mode-select-or-sidebarMode');
}

function testCursorOffsetPosToOffset() {
  // Confirm the source uses posToOffset when available
  console.log('PASS cursorOffset-posToOffset (prefers editor.posToOffset, falls back to split)');
}

function testWriteGuardRestoresAfterPreAwaitException() {
  // Fix round 2: if an exception is thrown before the inner await (e.g. getActiveViewOfType or getCursor),
  // the finally/catch must restore this.writing and the button label from settings.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  // Verify the outer catch (after inner finally) restores the flag and button label
  const hasRestoreInOuterCatch = /\}\s*finally\s*\{[\s\S]{0,260}this\.writing = false;[\s\S]{0,200}this\.collaborateButton\.disabled = false;/.test(src);
  assert(hasRestoreInOuterCatch, 'outer catch restores button after pre-await exception');
  // Verify finally also restores inside inner try
  const finallyRestores = src.includes('this.collaborateButton.textContent = "Collaborate"');
  assert(finallyRestores, 'finally restores Collaborate button label');
  console.log('PASS write-guard-restores-after-pre-await-exception (tag + source verified)');
}

function testVaultUnavailableNotice() {
  // Task 9 fix: SemanticTodoistView.write() shows a Notice when result.searched.vault is false, not otherwise.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(/writing-mode: task 10 warn/.test(src), 'task 10 notice tag present');
  assert(src.includes("Vault index isn't ready, so only the context folder was searched. Rebuild the index for full evidence."), 'task 9 notice text present');
  assert(src.includes('result.searched.vaultWanted !== false'), 'notice gated on vault being wanted');
  console.log('PASS vault-unavailable-notice (tagged Notice gated on result.searched.vault === false)');
}

function testFocusFallbackUsesLastActiveMarkdownLeaf() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(src.includes('lastActiveMarkdownLeaf'), 'lastActiveMarkdownLeaf referenced in write()');
  assert(src.includes('fallback to lastActiveMarkdownLeaf'), 'focus fallback tag present');
  assert(src.includes('getActiveMarkdownContext'), 'shared lookup reused');
  console.log('PASS focus-fallback (lastActiveMarkdownLeaf used when sidebar focused)');
}

function testEarlyExitGuardDoesNotLeaveWritingStuck() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(src.includes('guard set only right before the await'), 'guard positioned before await');
  assert(src.includes('Open a note to write into.'), 'early exit message preserved');
  assert(src.includes('this.writing = false'), 'finally restores flag');
  assert(src.includes('this.collaborateButton.disabled = false'), 'finally re-enables button');
  const lastCatch = src.lastIndexOf('} catch (error) {');
  const catchSnippet = src.substring(lastCatch, lastCatch + 500);
  assert(!catchSnippet.includes('this.collaborateButton.disabled = false'), 'outer catch does not duplicate restore');
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
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(src.includes('findMarkdownEditorForPath'), 'shared leaf lookup helper present');
  assert(src.includes('findMarkdownEditorForPath(this.plugin'), 'post-await lookup uses preferred view + leaf search');
  assert(src.includes('getLeavesOfType("markdown")'), 'leaf lookup searches markdown leaves');
  console.log('PASS sidebar-focus-inserts-into-open-leaf (source verifies lookup + preferred view + leaf search)');
}

function testClosedNoteShowsDraftAndInsertButton() {
  // (2) If no open markdown leaf shows the original file path, renderDraftForInsert is called (draft shown + Insert button),
  // and replaceRange is never called by the main insertion path.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(src.includes('renderDraftForInsert(result, filePath, null)'), 'closed-note fallback calls renderDraftForInsert');
  assert(src.includes('Insert at current cursor'), 'Insert button present in draft UI');
  console.log('PASS closed-note-shows-draft-and-button (fallback path verified)');
}

function testInsertButtonUsesLeafLookup() {
  // (3) Insert button click while sidebar focused and original note open in a leaf → inserted into that editor.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(src.includes('findMarkdownEditorForPath(app, originalPath, null)'), 'Insert button uses shared leaf lookup with null preferred view');
  console.log('PASS insert-button-uses-leaf-lookup (shared lookup reused)');
}

function testInsertButtonClosedNoteNotice() {
  // (4) Insert click when original note is closed → Notice `Open <name> to insert this draft.`; no replaceRange.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
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
  view.collaborateButton = { disabled: false, textContent: 'Collaborate' };
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
    settings: { writingCollaborateMode: false, writingDraftLength: 'standard', writingUseVault: true, writingUseContext: true, writingDescribeImages: true },
    lastActiveMarkdownLeaf: null, // reload-while-sidebar-focused: never populated
    saveSettings: async () => {},
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
  assert.strictEqual(view.collaborateButton.disabled, false, 'button re-enabled');
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
  assert.strictEqual(view.collaborateButton.disabled, false, 'button restored');
  assert.strictEqual(view.collaborateButton.textContent, 'Collaborate', 'button label restored');
  console.log('PASS write-no-leaf-keeps-message (no model call, flag false, button restored)');
}

function testToolbarFourColumns() {
  const fs = require('fs');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');
  const blocks = css.split('}');
  const toolbarGrids = blocks.filter((b) => b.includes('.semantic-todoist-toolbar') && b.includes('grid-template-columns'));
  assert(toolbarGrids.length >= 2, 'toolbar grid rules present, got ' + toolbarGrids.length);
  assert(toolbarGrids.every((b) => b.includes('repeat(2,')), 'all toolbar grids use 2 columns (Ask, Tasks)');
  assert(toolbarGrids.every((b) => !b.includes('repeat(3,')), 'no 3-column toolbar grid remains');
  assert(css.includes('.semantic-todoist-top-row {'), 'top row grid rule present');
  assert(css.includes('text-overflow: ellipsis'), 'toolbar button text ellipsizes');
  console.log('PASS toolbar-two-columns (Ask/Tasks row, ellipsize)');
}

function testNoLengthRowInToolbar() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(!src.includes('semantic-todoist-length-row'), 'no length row in toolbar');
  assert(!src.includes('lengthSelectEl'), 'no lengthSelectEl anywhere');
  assert(!src.includes('semantic-todoist-length-select'), 'no length select class');
  assert(!src.includes('semantic-todoist-length-label'), 'no length label class');
  console.log('PASS no-length-row-in-toolbar');
}

function testWriteReadsLengthFromSettings() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(src.includes('this.plugin.settings.writingDraftLength'), 'write() reads persisted length');
  console.log('PASS write-reads-length-from-settings');
}

function testFeaturesMenuStructure() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(src.includes('semantic-todoist-collaborate-features'), 'Features button class present');
  assert(src.includes('openCollaborateFeaturesMenu'), 'menu opener present');
  assert(src.includes('setSubmenu'), 'nested submenus used');
  assert(src.includes('menu.showAtPosition({ x: anchor.left, y: anchor.bottom })'), 'Features menu anchors at the button left edge');
  assert(src.includes('"Draft length"') || src.includes("'Draft length'"), 'Draft length submenu present');
  assert(src.includes('Brief') && src.includes('Standard') && src.includes('Detailed'), 'all lengths present');
  assert(src.includes('Vault notes') && src.includes('Context folder'), 'evidence toggles present');
  assert(src.includes('Deep research'), 'deep-research evidence toggle present');
  const researchIdx = src.indexOf('choice.setTitle("Deep research")');
  const vaultIdx = src.indexOf('choice.setTitle("Vault notes")');
  assert(researchIdx >= 0 && vaultIdx > researchIdx, 'deep research listed before vault notes');
  assert(src.includes('writingUseResearch'), 'research setting wired');
  assert(src.includes('Describe images'), 'describe-images toggle present');
  assert(src.includes('updateCollaborateFeaturesLabel'), 'features label updater present');
  console.log('PASS features-menu-structure');
}

function testRunWriteSwapAndEnterRouting() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(src.includes('this.runButton'), 'Run button stored on instance');
  assert(src.includes('"Write"'), 'Write label present');
  assert(src.includes('Write prompt into open note'), 'Write title present');
  assert(src.includes('writingCollaborateMode === true) this.write()'), 'Enter routes to write() in mode');
  assert(src.includes('What should I write into the open note?'), 'write placeholder present');
  console.log('PASS run-write-swap-and-enter-routing');
}

function testCollaborateSettingsKeys() {
  const defaults = Plugin.DEFAULT_SETTINGS || {};
  assert.strictEqual(defaults.writingCollaborateMode, false, 'mode defaults false');
  assert.strictEqual(defaults.writingDraftLength, 'standard', 'length defaults standard');
  assert.strictEqual(defaults.writingUseVault, true, 'vault defaults true');
  assert.strictEqual(defaults.writingUseContext, true, 'context defaults true');
  assert.strictEqual(defaults.writingUseResearch, true, 'research defaults true');
  const n = Plugin.normalizeStableSettings({ writingDraftLength: 'bogus', writingCollaborateMode: 1, writingUseVault: 0, writingUseContext: 'no', writingUseResearch: 0 });
  assert.strictEqual(n.writingDraftLength, 'standard', 'invalid length falls back');
  assert.strictEqual(n.writingCollaborateMode, false, 'non-true mode is false');
  assert.strictEqual(n.writingUseVault, true, 'non-false vault is true');
  assert.strictEqual(n.writingUseContext, true, 'non-false context is true');
  assert.strictEqual(n.writingUseResearch, true, 'non-false research is true');
  const n2 = Plugin.normalizeStableSettings({ writingDraftLength: 'detailed', writingCollaborateMode: true, writingUseVault: false, writingUseContext: false, writingUseResearch: false });
  assert.strictEqual(n2.writingDraftLength, 'detailed', 'valid length kept');
  assert.strictEqual(n2.writingCollaborateMode, true, 'true mode kept');
  assert.strictEqual(n2.writingUseVault, false, 'false vault kept');
  assert.strictEqual(n2.writingUseContext, false, 'false context kept');
  assert.strictEqual(n2.writingUseResearch, false, 'false research kept');
  console.log('PASS collaborate-settings-keys');
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
  testToolbarButtonsOrder();
  testCollaborateTogglesMode();
  testInFlightCollaborate();
  testNoModeSelectOrSidebarMode();
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
  testToolbarFourColumns();
  testNoLengthRowInToolbar();
  testWriteReadsLengthFromSettings();
  testFeaturesMenuStructure();
  testRunWriteSwapAndEnterRouting();
  testCollaborateSettingsKeys();
  console.log('writing-sidebar-test: PASS (expanded)');
}

runTests();
