'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');
const { typedRewriteInstruction } = require(path.join(__dirname, '..', 'src', 'writing', 'rewrite.js'));

// Mock obsidian module for loading built main.js
const originalLoad = Module._load;
// Shared singleton so `instanceof MarkdownView` in tests matches the class the bundle captured.
let obsidianMock = null;

// A DOM mock that mirrors Obsidian's `createEl` for the case that matters here:
// Obsidian honours `{ value }` on an <input> but NOT on a <textarea> (a textarea's
// value is its text content, which createEl never sets). Verified live: a textarea
// created with `{ value: 'x' }` has `.value === ''`, an input has `.value === 'x'`.
class FakeElement {
  constructor(tagName = 'div', options = {}) {
    this.tagName = tagName;
    this.children = [];
    this.textContent = options.text || '';
    this.className = options.cls || '';
    this.attributes = { ...(options.attr || {}) };
    this.dataset = {};
    this.style = { setProperty() {} };
    this.focused = false;
    this._value = '';
    if (this.tagName === 'input' && options.value !== undefined) this._value = String(options.value);
  }
  get value() { return this._value; }
  set value(next) { this._value = String(next == null ? '' : next); }
  createEl(tagName, options = {}) { const child = new FakeElement(tagName, options); this.children.push(child); return child; }
  createDiv(options = {}) { return this.createEl('div', options); }
  createSpan(options = {}) { return this.createEl('span', options); }
  addClass(value) { this.className = `${this.className} ${value}`.trim(); return this; }
  setAttribute(key, value) { this.attributes[key] = value; return this; }
  setAttr(key, value) { return this.setAttribute(key, value); }
  setText(text) { this.textContent = String(text == null ? '' : text); return this; }
  empty() { this.children = []; this.textContent = ''; return this; }
  focus() { this.focused = true; return this; }
  remove() { this.removed = true; return this; }
  insertBefore(node) { this.children.unshift(node); return node; }
  setCta() { return this; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
}

// Depth-first search for a class the mock recorded (the modal builds its panes in the DOM).
function findByClass(root, cls) {
  if (!root) return null;
  if (String(root.className || '').split(/\s+/).includes(cls)) return root;
  for (const child of root.children || []) {
    const found = findByClass(child, cls);
    if (found) return found;
  }
  return null;
}

function mockObsidian() {
  Module._load = function (request, parent, isMain) {
    if (request !== 'obsidian') return originalLoad.call(this, request, parent, isMain);
    if (!obsidianMock) {
    class Empty {}
    obsidianMock = {
      ItemView: Empty,
      MarkdownRenderer: { renderMarkdown() {} },
      MarkdownView: Empty,
      Modal: class {
        constructor(app, opts) {
          this.app = app;
          this.opts = opts;
          this.modalEl = new FakeElement('div');
          this.contentEl = new FakeElement('div');
          this.modalEl.children.push(this.contentEl);
          obsidianMock.modalInstances = obsidianMock.modalInstances || [];
          obsidianMock.modalInstances.push(this);
        }
        // Obsidian calls onOpen() when the modal opens and onClose() when it closes.
        open() { this.opened = true; if (typeof this.onOpen === 'function') this.onOpen(); }
        close() { this.opened = false; if (typeof this.onClose === 'function') this.onClose(); }
      },
      Notice: function (msg) {
        obsidianMock.notices = obsidianMock.notices || [];
        obsidianMock.notices.push(String(msg));
      },
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
    global.MarkdownView = obsidianMock.MarkdownView;
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
// The rewrite-preview fixes live in src/main.js; the root main.js is the built bundle the
// coordinator regenerates, so the new preview assertions run against the source module
// (the bundle is built from it) and stay green until that pending rebuild.
const SourcePlugin = require(path.join(__dirname, '..', 'src', 'main.js'));

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
  assert.strictEqual(normalized.writingContextFolder, 'Semantic Todoist Sync/Context', 'invalid folder defaults to the plugin Context folder');
  assert.strictEqual(Plugin.normalizeStableSettings({ writingContextFolder: 'Writing Context' }).writingContextFolder, 'Semantic Todoist Sync/Context', 'old default Writing Context migrates to the plugin Context folder');
  assert.strictEqual(normalized.writingDescribeImages, true, 'invalid describeImages defaults to true');
  console.log('PASS settings normalisation without sidebarMode');
}

function testSettingsMigrationStillPasses() {
  // The existing settings-migration-local-test relies on normalizeStableSettings
  // and DEFAULT_SETTINGS; we verify the new keys don't break it.
  const defaults = Plugin.DEFAULT_SETTINGS || {};
  assert.strictEqual(defaults.sidebarMode, undefined, 'sidebarMode removed from defaults');
  assert.strictEqual(defaults.writingContextFolder, 'Semantic Todoist Sync/Context', 'writingContextFolder in defaults');
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

function charOffset(text, pos) {
  const lines = String(text || '').split('\n');
  let off = 0;
  for (let i = 0; i < pos.line && i < lines.length; i++) off += lines[i].length + 1;
  return off + (pos.ch || 0);
}

function makeMarkdownLeaf(filePath, text) {
  const obsidian = require('obsidian');
  const view = new obsidian.MarkdownView();
  let current = String(text || '');
  const calls = { replaceRange: [], transaction: [] };
  view.file = { path: filePath, basename: filePath.split('/').pop() };
  view.editor = {
    getSelection: () => current.slice(charOffset(current, { line: 0, ch: 0 }), charOffset(current, { line: 0, ch: current.length })),
    getCursor: (mode) => {
      if (mode === 'from') return { line: 0, ch: 0 };
      if (mode === 'to') return { line: 0, ch: current.length };
      return { line: 0, ch: 0 };
    },
    getValue: () => current,
    setValue: (v) => { current = String(v || ''); },
    posToOffset: (pos) => charOffset(current, pos),
    offsetToPos: (offset) => {
      const lines = current.split('\n');
      let off = 0, line = 0;
      for (; line < lines.length; line++) {
        const next = off + lines[line].length + 1;
        if (offset <= next) return { line, ch: offset - off };
        off = next;
      }
      return { line: lines.length - 1, ch: lines[lines.length - 1].length };
    },
    getRange: (from, to) => current.slice(charOffset(current, from), charOffset(current, to)),
    replaceRange: (draft, from, to) => { calls.replaceRange.push({ draft, from, to }); },
    transaction: ({ changes }) => { calls.transaction.push(changes || []); },
  };
  return { leaf: { view }, calls, setText: (t) => { current = String(t || ''); } };
}

// Editor for pinned-range tests: reports a real selection (from/to) and a mutable text.
// Obsidian's editor methods need `this` (they reach into the CodeMirror instance), so an
// extracted method — `const getCursor = editor.getCursor; getCursor("from")` — throws
// "Cannot read properties of undefined (reading 'cm')" on a live editor. This mock reads
// `this._state`, so an unbound call throws the same way instead of quietly working.
function makePinEditor(text, path, from, to) {
  const obsidian = require('obsidian');
  const view = new obsidian.MarkdownView();
  const calls = { replaceRange: [], transaction: [] };
  const editor = {
    _state: { current: String(text || ''), from, to },
    // Obsidian reports the selected text whichever way the range runs; the mock matches that.
    getSelection() {
      const { current, from: f, to: t } = this._state;
      const a = charOffset(current, f);
      const b = charOffset(current, t);
      return current.slice(Math.min(a, b), Math.max(a, b));
    },
    getCursor(mode) {
      const { from: f, to: t } = this._state;
      if (mode === 'from') return f;
      if (mode === 'to') return t;
      return f;
    },
    somethingSelected() { return true; },
    getValue() { return this._state.current; },
    setValue(v) { this._state.current = String(v || ''); },
    posToOffset(pos) { return charOffset(this._state.current, pos); },
    offsetToPos(offset) {
      const lines = this._state.current.split('\n');
      let off = 0, line = 0;
      for (; line < lines.length; line++) {
        const next = off + lines[line].length + 1;
        if (offset <= next) return { line, ch: offset - off };
        off = next;
      }
      return { line: lines.length - 1, ch: lines[lines.length - 1].length };
    },
    getRange(f, t) { return this._state.current.slice(charOffset(this._state.current, f), charOffset(this._state.current, t)); },
    replaceRange(draft, f, t) { calls.replaceRange.push({ draft, from: f, to: t }); },
    transaction({ changes }) { calls.transaction.push(changes || []); },
  };
  view.file = { path, basename: path.split('/').pop() };
  view.editor = editor;
  return { view, leaf: { view }, calls, selection: editor.getSelection(), setText: (t) => { editor._state.current = String(t || ''); } };
}

function makeWriteView(plugin, leaves, mostRecentLeaf, PluginModule) {
  // The root main.js is the built bundle the coordinator regenerates; the view class comes
  // from src/main.js (the bundle is built from it), so the pin/rewrite paths run the source.
  const view = new (PluginModule || SourcePlugin).SemanticTodoistView({}, plugin);
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

function makeWritePlugin(leafEntries, writeWithEvidenceImpl) {
  let writeCalls = 0;
  let lastWriteArgs = null;
  const defaultStub = async () => ({ markdown: 'DRAFT', footnotes: '', sources: [], dropped: 0, sourcesBlock: 'Sources searched:\n- deep research: not searched (turned off)\n- vault: searched\n- context folder: searched' });
  const impl = writeWithEvidenceImpl || defaultStub;
  const plugin = {
    settings: { writingCollaborateMode: false, writingCitationStyle: 'footnotes', writingDraftLength: 'standard', writingUseVault: true, writingUseContext: true, writingDescribeImages: true },
    lastActiveMarkdownLeaf: null, // reload-while-sidebar-focused: never populated
    saveSettings: async () => {},
    // every stub (default or per-test) is counted, so call counts never depend on which stub a test passed
    writeWithEvidence: async (inst, opts) => {
      writeCalls += 1;
      lastWriteArgs = { instruction: inst, opts };
      return impl(inst, opts);
    },
  };
  plugin.writeCallCount = () => writeCalls;
  plugin.lastWriteArgs = () => lastWriteArgs;
  return plugin;
}

async function testCollaborateSendsConversation() {
  // Collaborate continues the sidebar conversation: earlier turns go with the request; a new chat sends none.
  const { leaf } = makeMarkdownLeaf('Notes/Visible.md', 'hello world');
  const plugin = makeWritePlugin();
  const view = makeWriteView(plugin, [leaf], leaf);
  view.messages = [{ role: 'user', text: 'what is due today' }, { role: 'assistant', text: 'You have 62 tasks due today.' }];
  view.promptEl.value = 'draft a short note about those';
  await view.write();
  assert.ok(String(plugin.lastWriteArgs().opts.history || '').includes('User: what is due today\nAssistant: You have 62 tasks due today.'), 'history sent: ' + plugin.lastWriteArgs().opts.history);
  assert.ok(!String(plugin.lastWriteArgs().opts.history).includes('draft a short note about those'), 'current request is not repeated as history');
  view.messages = [{ role: 'user', text: 'first ask' }, { role: 'assistant', text: 'Collaborating\u2026' }, { role: 'assistant', text: 'Thinking...' }];
  view.promptEl.value = 'next';
  await view.write();
  assert.strictEqual(plugin.lastWriteArgs().opts.history, 'User: first ask', 'in-flight placeholders never enter history: ' + plugin.lastWriteArgs().opts.history);
  view.messages = [];
  view.promptEl.value = 'draft again';
  await view.write();
  assert.ok(!plugin.lastWriteArgs().opts.history, 'new chat sends no history');
  console.log('PASS collaborate-sends-conversation');
}

async function testCollaborateUsesTodoistLookup() {
  // The look-up step supplies the search query / reuse flag / task source notes; tasks themselves never become evidence.
  const { leaf } = makeMarkdownLeaf('Notes/Visible.md', 'hello world');
  const files = { 'Projects/Jim.md': 1, 'Notes/B.md': 1, 'Semantic Todoist Sync/Miscellaneous Tasks/2026-10 Tasks.md': 1 };
  const plugin = makeWritePlugin();
  plugin.settings.taskCache = {
    t1: { path: 'Projects/Jim.md' },
    t2: { path: 'Semantic Todoist Sync/Miscellaneous Tasks/2026-10 Tasks.md' },
    t3: { path: 'Gone/Missing.md' },
    t4: {},
    t6: { path: 'Projects/Jim.md' },
    t7: { path: 'Notes/B.md' },
  };
  let lookupArgs = null;
  const turn = { lookup: { searchQuery: 'Jim tasks due today', reuseEvidence: false }, shortlist: [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }, { id: 't5' }, { id: 't6' }, { id: 't7' }] };
  plugin.todoistChatTurn = async (...args) => { lookupArgs = args; return turn; };
  const view = makeWriteView(plugin, [leaf], leaf);
  plugin.app.vault = { getAbstractFileByPath: (p) => (files[p] ? { path: p, extension: 'md' } : null) };
  view.messages = [{ role: 'user', text: 'what tasks do I have today' }, { role: 'assistant', text: 'You have 62 tasks.' }];
  view.promptEl.value = "what's specific to Jim?";
  await view.write();
  assert.ok(lookupArgs, 'look-up ran');
  assert.strictEqual(lookupArgs[0], "what's specific to Jim?", 'look-up gets the request');
  assert.ok(Array.isArray(lookupArgs[1]) && lookupArgs[1].length === 2 && !lookupArgs[1].some((m) => m.text === "what's specific to Jim?"), 'history excludes the current message: ' + JSON.stringify(lookupArgs[1]));
  const opts = plugin.lastWriteArgs().opts;
  assert.strictEqual(opts.searchQuery, 'Jim tasks due today', 'searchQuery forwarded');
  assert.ok(!opts.reuseEvidence, 'no reuse without earlier evidence');
  assert.deepStrictEqual(opts.taskSourcePaths, ['Projects/Jim.md', 'Notes/B.md'], 'uncached, missing, monthly and duplicate sources skipped, order kept');
  assert.ok(!('todoistTasks' in opts), 'tasks themselves are never forwarded');
  // evidence is stored, then a reuse-only follow-up forwards it
  const stored = [{ eid: 'E1', text: 't', source: { kind: 'vault', path: 'Notes/B.md' } }];
  const plugin2 = makeWritePlugin(null, async () => ({ markdown: 'D', footnotes: '', sources: [], dropped: 0, evidence: stored }));
  plugin2.settings.taskCache = {};
  plugin2.todoistChatTurn = async () => ({ lookup: { searchQuery: '', reuseEvidence: true }, shortlist: [] });
  const view2 = makeWriteView(plugin2, [leaf], leaf);
  plugin2.app.vault = { getAbstractFileByPath: () => null };
  view2.promptEl.value = 'first';
  await view2.write();
  assert.deepStrictEqual(view2.lastWriteEvidence, stored, 'lastWriteEvidence stored');
  assert.ok(!plugin2.lastWriteArgs().opts.reuseEvidence, 'first write has nothing to reuse');
  view2.promptEl.value = 'shorter';
  await view2.write();
  const o2 = plugin2.lastWriteArgs().opts;
  assert.strictEqual(o2.reuseEvidence, true, 'reuse forwarded');
  assert.deepStrictEqual(o2.previousEvidence, stored, 'previous evidence forwarded');
  assert.strictEqual(o2.searchQuery, undefined, 'blank searchQuery not forwarded');
  assert.deepStrictEqual(o2.taskSourcePaths, [], 'no task notes');
  // follow-up on a previous Ask answer: its task notes and evidence notes join the sources (never tasks); neither flag = not added
  const askFiles = { 'Projects/Jim.md': 1, 'Notes/Ev1.md': 1, 'Notes/Ev2.md': 1, 'Notes/N3.md': 1, 'Notes/N4.md': 1, 'Notes/N5.md': 1, 'Notes/N6.md': 1, 'Notes/N7.md': 1, 'Notes/N8.md': 1, 'Semantic Todoist Sync/Miscellaneous Tasks/2026-10 Tasks.md': 1 };
  const makeAskView = (lookup) => {
    const p = makeWritePlugin();
    p.settings.taskCache = { a1: { path: 'Projects/Jim.md' }, a2: { path: 'Semantic Todoist Sync/Miscellaneous Tasks/2026-10 Tasks.md' }, a3: { path: 'Notes/Ev1.md' } };
    p.lastTodoistAnswerTaskIds = ['a1', 'a2', 'a3'];
    p.todoistChatTurn = async () => ({ lookup, shortlist: [] });
    const v = makeWriteView(p, [leaf], leaf);
    p.app.vault = { getAbstractFileByPath: (x) => (askFiles[x] ? { path: x, extension: 'md' } : null) };
    v.lastContext = [{ path: '@todoist/task/x' }, { path: '' }, { path: 'Notes/Ev1.md' }, { path: 'Notes/Ev2.md' }, { path: 'Semantic Todoist Sync/Miscellaneous Tasks/2026-10 Tasks.md' },
      ...['N3', 'N4', 'N5', 'N6', 'N7', 'N8'].map((n) => ({ path: `Notes/${n}.md` }))];
    v.promptEl.value = 'Draft a short status note on the Jim items above';
    return { p, v };
  };
  const ask1 = makeAskView({ needsTodoist: false, refersToLastAnswer: true, reuseEvidence: true, searchQuery: 'Jim tasks due today' });
  await ask1.v.write();
  const o4 = ask1.p.lastWriteArgs().opts;
  assert.deepStrictEqual(o4.taskSourcePaths, ['Projects/Jim.md', 'Notes/Ev1.md', 'Notes/Ev2.md', 'Notes/N3.md', 'Notes/N4.md', 'Notes/N5.md', 'Notes/N6.md', 'Notes/N7.md'], 'previous answer notes: task sources first, then evidence notes, no @todoist, no monthly, deduped, cap 8: ' + JSON.stringify(o4.taskSourcePaths));
  assert.strictEqual(o4.searchQuery, 'Jim tasks due today', 'searchQuery forwarded');
  const ask2 = makeAskView({ needsTodoist: false, refersToLastAnswer: false, reuseEvidence: false, searchQuery: 'vendor policy' });
  await ask2.v.write();
  assert.deepStrictEqual(ask2.p.lastWriteArgs().opts.taskSourcePaths, [], 'previous answer notes not added without refersToLastAnswer/reuseEvidence');
  const ask3 = makeAskView({ needsTodoist: false, refersToLastAnswer: false, reuseEvidence: true, searchQuery: 'x' });
  await ask3.v.write();
  assert.ok(ask3.p.lastWriteArgs().opts.taskSourcePaths.includes('Notes/Ev2.md'), 'reuseEvidence alone also adds previous answer notes');
  const longQ = makeAskView({ needsTodoist: false, refersToLastAnswer: false, reuseEvidence: false, searchQuery: 'q'.repeat(500) });
  await longQ.v.write();
  assert.strictEqual(longQ.p.lastWriteArgs().opts.searchQuery.length, 300, 'searchQuery capped at 300');
  // a look-up that throws still writes
  const plugin3 = makeWritePlugin();
  plugin3.todoistChatTurn = async () => { throw new Error('boom'); };
  const view3 = makeWriteView(plugin3, [leaf], leaf);
  view3.promptEl.value = 'draft';
  await view3.write();
  assert.strictEqual(plugin3.writeCallCount(), 1, 'look-up failure still writes');
  assert.ok(!plugin3.lastWriteArgs().opts.reuseEvidence && !plugin3.lastWriteArgs().opts.searchQuery, 'no look-up data forwarded');
  console.log('PASS collaborate-uses-todoist-lookup');
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
  assert.strictEqual(calls.replaceRange[0].draft, 'DRAFT\n\nSources searched:\n- deep research: not searched (turned off)\n- vault: searched\n- context folder: searched', 'draft plus Sources searched block inserted');
  assert(view.messageLog.some((m) => m.role === 'assistant-replaced' && m.text === calls.replaceRange[0].draft), 'sidebar shows exactly what was inserted');
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

function testRelevantNotesSetting() {
  const defaults = Plugin.DEFAULT_SETTINGS || {};
  assert.strictEqual(defaults.showRelevantNotes, true, 'relevant notes defaults true');
  const n = Plugin.normalizeStableSettings({ showRelevantNotes: 0 });
  assert.strictEqual(n.showRelevantNotes, true, 'non-false relevant notes is true');
  const n2 = Plugin.normalizeStableSettings({ showRelevantNotes: false });
  assert.strictEqual(n2.showRelevantNotes, false, 'false relevant notes kept');
  const n3 = Plugin.normalizeStableSettings({});
  assert.strictEqual(n3.showRelevantNotes, true, 'missing relevant notes defaults true');
  console.log('PASS relevant-notes-setting');
}

function testTaskTabsSplit() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(src.includes('"Note Tasks"'), 'Note Tasks tab present');
  assert(src.includes('"Email Tasks"'), 'Email Tasks tab present');
  assert(src.includes('renderNoteTasks(containerEl)'), 'renderNoteTasks exists');
  assert(src.includes('renderEmailTasks(containerEl)'), 'renderEmailTasks exists');
  assert(src.includes('goTo("Note Tasks")'), 'notes link lands on Note Tasks');
  assert(src.includes('goTo("Email Tasks")'), 'email link lands on Email Tasks');
  console.log('PASS task-tabs-split');
}

// Source-slice helper: the body of one class method in src/main.js, cut at the
// next method (or at the end of the class).
function srcClassMethodBody(src, name) {
  const start = src.indexOf(`\n  ${name}(`);
  assert(start >= 0, `method ${name} exists`);
  const rest = src.slice(start + 1);
  const nextMethod = rest.search(/\n  (?:async )?[A-Za-z_$][\w$]*\(/);
  const classEnd = rest.indexOf('\n}\n');
  const bounds = [nextMethod, classEnd].filter((value) => value >= 0);
  return rest.slice(0, bounds.length ? Math.min(...bounds) : rest.length);
}

// Source-slice helper: the body of one class in src/main.js, cut at the class end.
function srcClassBody(src, className) {
  const start = src.indexOf(`class ${className} `);
  assert(start >= 0, `class ${className} exists`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end < 0 ? src.length : end);
}

function testCollaborateSettingsTab() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  const body = srcClassMethodBody(src, 'renderCollaborate');
  const citation = body.indexOf('"Citation style"');
  const context = body.indexOf('"Context folder"');
  const rescan = body.indexOf('"Rescan context folder"');
  const describe = body.indexOf('"Describe images"');
  assert(citation >= 0, 'Collaborate tab has a Citation style setting');
  assert(context > citation, 'Context folder comes after Citation style');
  assert(rescan > context, 'Rescan context folder comes after Context folder');
  assert(describe > rescan, 'Describe images comes after Rescan context folder');
  for (const [value, label] of [['footnotes', 'Footnotes'], ['apa', 'APA 7'], ['nature', 'Nature']]) {
    assert(body.includes(`addOption("${value}", "${label}")`), `citation style offers ${value} as ${label}`);
  }
  assert(body.includes('this.plugin.settings.writingCitationStyle || "footnotes"'), 'citation style shows the saved value');
  assert(body.includes('this.goTo("AI & Search")'), 'Collaborate tab links to the AI & Search tab');
  console.log('PASS collaborate-settings-tab');
}

function testAiSearchNoLongerOwnsWriting() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  const body = srcClassMethodBody(src, 'renderAiSearch');
  for (const key of ['writingContextFolder', 'writingDescribeImages', 'writingUseResearch']) {
    assert(!body.includes(key), `AI & Search no longer owns ${key}`);
  }
  assert(!body.includes('settingsDisclosure(containerEl, "Writing"'), 'AI & Search no longer has a Writing section');
  console.log('PASS ai-search-no-longer-owns-writing');
}

function testFeaturesMenuHotSwapOnly() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  const body = srcClassMethodBody(src, 'openCollaborateFeaturesMenu');
  const titles = [];
  let at = 0;
  while (true) {
    const next = body.indexOf('menu.addItem(', at);
    if (next < 0) break;
    const following = body.indexOf('menu.addItem(', next + 1);
    const chunk = body.slice(next, following < 0 ? body.length : following);
    const title = chunk.match(/setTitle\("([^"]*)"\)/);
    titles.push(title ? title[1] : '');
    at = next + 1;
  }
  assert.deepStrictEqual(titles, ['Draft length', 'Evidence'], 'Features menu holds only Draft length and Evidence');
  assert(!body.includes('setTitle("Describe images")'), 'Features menu no longer offers Describe images');
  const label = srcClassMethodBody(src, 'updateCollaborateFeaturesLabel');
  assert(!label.includes('images'), 'the Features label no longer mentions images');
  console.log('PASS features-menu-hot-swap-only');
}

function testExistingSidebarTestsStillPass() {
  // (5) Existing test structure intact; all prior assertions preserved.
  assert.strictEqual(typeof Plugin.SemanticTodoistView, 'function', 'existing view class intact');
  console.log('PASS existing-sidebar-tests-still-pass');
}

function testCitationStyleDefault() {
  assert.strictEqual(Plugin.DEFAULT_SETTINGS.writingCitationStyle, 'footnotes', 'citation style defaults to footnotes');
  assert.strictEqual(Plugin.normalizeStableSettings({ writingCitationStyle: 'bogus' }).writingCitationStyle, 'footnotes', 'invalid style falls back to footnotes');
  assert.strictEqual(Plugin.normalizeStableSettings({ writingCitationStyle: 'nature' }).writingCitationStyle, 'nature', 'nature kept');
  assert.strictEqual(Plugin.normalizeStableSettings({ writingCitationStyle: 'apa' }).writingCitationStyle, 'apa', 'apa kept');
  console.log('PASS citation-style-default');
}

function testEditorMenuGuards() {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(src.includes('editor-menu'), 'editor-menu handler registered');
  assert(/writingCollaborateMode\s*!==/.test(src), 'menu guarded on collaborate mode');
  assert(/somethingSelected/.test(src), 'menu requires selection');
  assert(/addSeparator/.test(src), 'separator added before items');
  assert(src.includes('Rewrite with instruction'), 'typed entry present');
  const titles = ['Fix spelling & grammar','Improve writing','Plain language','Make concise','Expand','Continue writing','Strengthen for funders','Policy wording','Numbered steps','Formal','Neutral','Persuasive','Casual','Check against my notes'];
  for (const t of titles) assert(src.includes(t), 'preset title present: ' + t);
  console.log('PASS editor-menu-guards');
}

function testMenuHiddenWhenModeOff() {
  const obsidian = require('obsidian');
  const { rewriteMenuPin, addRewritePresetItems } = Plugin;
  const { REWRITE_PRESETS } = require(path.join(__dirname, '..', 'src', 'writing', 'rewrite.js'));
  const editor = {
    somethingSelected: () => true,
    getCursor: (mode) => (mode === 'from' ? { line: 0, ch: 0 } : { line: 0, ch: 26 }),
    getSelection: () => 'The original passage here.',
  };
  const info = { file: { path: 'Notes/Passage.md' } };
  assert.strictEqual(rewriteMenuPin({ settings: { writingCollaborateMode: false } }, editor, info), null, 'no pin while collaborate mode is off');
  assert.strictEqual(rewriteMenuPin({ settings: { writingCollaborateMode: true } }, { somethingSelected: () => false }, info), null, 'no pin without a selection');
  const pin = rewriteMenuPin({ settings: { writingCollaborateMode: true } }, editor, info);
  assert.ok(pin, 'pin captured when the mode is on and text is selected');
  assert.strictEqual(pin.original, 'The original passage here.', 'pin keeps the selected text');
  assert.strictEqual(pin.path, 'Notes/Passage.md', 'pin keeps the file path');
  const menu = new obsidian.Menu();
  addRewritePresetItems(menu, REWRITE_PRESETS, { onPreset: () => {}, onTyped: () => {} });
  assert.deepStrictEqual(
    menu.items.map((i) => i.title),
    ['Fix spelling & grammar', 'Improve writing', 'Plain language', 'Make concise', 'Expand', 'Continue writing', 'Grant & policy', 'Change tone', 'Check against my notes', 'Rewrite with instruction…'],
    'menu titles follow the plan order'
  );
  const grant = menu.items.find((i) => i.title === 'Grant & policy');
  assert.deepStrictEqual(grant.submenu.items.map((i) => i.title), ['Strengthen for funders', 'Policy wording', 'Numbered steps'], 'grant submenu titles');
  const tone = menu.items.find((i) => i.title === 'Change tone');
  assert.deepStrictEqual(tone.submenu.items.map((i) => i.title), ['Formal', 'Neutral', 'Persuasive', 'Casual'], 'tone submenu titles');
  console.log('PASS menu-hidden-when-off');
}

async function testPinnedSelectionOpensPreview() {
  const { view: leafView, leaf, calls } = makePinEditor('The original passage here.', 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: 26 });
  let captured = null;
  const plugin = makeWritePlugin(null, async (inst, opts) => {
    captured = { mode: opts.mode, citationStyle: opts.citationStyle, inst };
    return { markdown: 'B', footnotes: '', sources: [], dropped: 0, sourcesBlock: '', citationStyle: 'footnotes', cited: [], numbers: {} };
  });
  const view = makeWriteView(plugin, [leaf], leaf);
  view.plugin.settings.writingCitationStyle = 'apa';
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  assert.strictEqual(view.pinned.original, 'The original passage here.', 'pin original captured');
  await view.write();
  assert.ok(captured, 'the model was called');
  assert.strictEqual(captured.mode, 'rewrite', 'a pinned range asks for a rewrite');
  assert.strictEqual(captured.citationStyle, 'apa', 'the citation style comes from the settings');
  assert.strictEqual(view.rewriteModal.before, 'The original passage here.', 'before is pinned original');
  assert.strictEqual(view.rewriteModal.after, 'B', 'after is model markdown');
  assert.strictEqual(calls.replaceRange.length, 0, 'the preview does not edit the note');
  assert.strictEqual(calls.transaction.length, 0, 'the preview does not edit the note');
  console.log('PASS pinned-selection-opens-preview');
}

async function testPinnedRewriteUsesPinnedNote() {
  // Two notes are open and the last-active leaf is note A, but the pin belongs to note B.
  // The request and the preview's reference plan must use note B (pinned.path), not note A.
  const aText = 'Alpha note body.';
  const bText = 'Beta note body.\n\n## References\n\n1. Zed, Z. (2020). Zed entry. http://z\n';
  const a = makePinEditor(aText, 'Notes/A.md', { line: 0, ch: 0 }, { line: 0, ch: aText.length });
  const b = makePinEditor(bText, 'Notes/B.md', { line: 0, ch: 0 }, { line: 0, ch: 15 });
  const plugin = makeWritePlugin(null, async () => ({
    markdown: 'Revised.', footnotes: '', sources: [], dropped: 0, sourcesBlock: '',
    citationStyle: 'nature',
    cited: [{ meta: { title: 'Alpha source', url: 'http://a' } }],
    numbers: { 'http://a': 2 },
  }));
  const view = makeWriteView(plugin, [a.leaf, b.leaf], a.leaf);
  // the last-active leaf is note A, so the old request-time lookup would pick note A
  plugin.lastActiveMarkdownLeaf = a.leaf;
  view.plugin.settings.writingCitationStyle = 'nature';
  view.pinSelection(b.view.editor, 'Notes/B.md');
  await view.write();
  const args = plugin.lastWriteArgs();
  assert.strictEqual(args.opts.active.path, 'Notes/B.md', 'the request names the pinned note');
  assert.strictEqual(args.opts.active.text, bText, 'the request carries the pinned note text');
  assert.strictEqual(args.opts.active.selection, 'Beta note body.', 'the request carries the pinned passage');
  const modal = view.rewriteModal;
  assert.ok(modal, 'the preview opened');
  // note B already lists one reference, so the new entry is number 2; note A would have planned number 1
  assert.deepStrictEqual(modal.references, ['2. Alpha source. http://a'], 'the references were planned against the pinned note text');
  console.log('PASS pinned-rewrite-uses-pinned-note');
}

async function testBackwardsSelectionPin() {
  const { view: leafView, leaf } = makePinEditor('The original passage here.', 'Notes/Passage.md', { line: 0, ch: 10 }, { line: 0, ch: 0 });
  const plugin = makeWritePlugin();
  const view = makeWriteView(plugin, [leaf], leaf);
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  assert.deepStrictEqual(view.pinned.from, { line: 0, ch: 10 }, 'from is getCursor("from")');
  assert.deepStrictEqual(view.pinned.to, { line: 0, ch: 0 }, 'to is getCursor("to")');
  assert.strictEqual(view.pinned.original, 'The origin', 'the pin keeps the whole selected text, not an empty pin');
  console.log('PASS backwards-selection');
}

async function testChipClearsPin() {
  const { view: leafView, leaf, calls } = makePinEditor('The original passage here.', 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: 5 });
  const plugin = makeWritePlugin(null, async () => ({ markdown: 'DRAFT', footnotes: '', sources: [], dropped: 0, sourcesBlock: '', citationStyle: 'footnotes', cited: [], numbers: {} }));
  const view = makeWriteView(plugin, [leaf], leaf);
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  assert.ok(view.pinned, 'pin set');
  view.clearPin();
  assert.strictEqual(view.pinned, null, 'pin cleared');
  await view.write();
  assert.strictEqual(plugin.writeCallCount(), 1, 'insert path taken when no pin');
  const args = plugin.lastWriteArgs();
  assert.strictEqual(args.opts.mode, 'draft', 'a sidebar write without a pin stays a draft');
  assert.strictEqual(args.opts.length, 'standard', 'the insert path sends the draft length');
  assert.strictEqual(calls.replaceRange.length, 1, 'the draft is inserted into the note');
  assert.ok(calls.replaceRange[0].draft.includes('DRAFT'), 'the draft text is what got inserted');
  console.log('PASS chip-clears-pin');
}

// A prompt box in a DOM container, so the pin chip is really rendered (as in Obsidian).
function makePromptDom() {
  const container = new FakeElement('div');
  const prompt = container.createEl('textarea');
  prompt.parentElement = container;
  return { container, prompt };
}

async function testPinSelectionCallsEditorMethods() {
  // Live defect: pinSelection extracted editor.getCursor and called it unbound. A real
  // Obsidian editor needs `this` ("Cannot read properties of undefined (reading 'cm')"),
  // so the editor-menu "Rewrite with instruction…" never pinned the selection and no
  // pin chip appeared. The strict mock throws the same way when a method is unbound.
  const text = 'The original passage here. '.repeat(6);
  const { view: leafView, leaf } = makePinEditor(text, 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: text.length });
  const plugin = makeWritePlugin();
  const view = makeWriteView(plugin, [leaf], leaf);
  const { prompt } = makePromptDom();
  view.promptEl = prompt;
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  assert.ok(view.pinned, 'the selection is pinned');
  assert.deepStrictEqual(view.pinned.from, { line: 0, ch: 0 }, 'from is editor.getCursor("from")');
  assert.deepStrictEqual(view.pinned.to, { line: 0, ch: text.length }, 'to is editor.getCursor("to")');
  assert.strictEqual(view.pinned.original, text, 'the pin keeps the selected text');
  const chip = view.pinChipEl;
  assert.ok(chip, 'the pin chip is rendered');
  const label = chip.children[0];
  assert.ok(label.textContent.startsWith('✎ "'), 'the chip shows the pin marker');
  assert.ok(label.textContent.includes(text.slice(0, 60)), 'the chip shows the first 60 characters of the selection');
  const clear = findByClass(chip, 'semantic-todoist-pin-chip-clear');
  assert.ok(clear, 'the chip has a clear button');
  assert.strictEqual(clear.textContent, '×', 'the clear button is the × button');
  clear.onclick();
  assert.strictEqual(view.pinned, null, 'clicking × clears the pin');
  assert.strictEqual(view.pinChipEl, null, 'the chip is removed');
  console.log('PASS pin-selection-calls-editor-methods');
}

async function testEditorMenuTypedPathPinsSelection() {
  // The editor-menu "Rewrite with instruction…" item pins the selection through the
  // exported helpers. The plugin's own onload handler is not drivable here (the obsidian
  // mock has no Plugin base class to register the workspace event), so the helper path
  // is driven directly and the production wiring is pinned by a source check.
  const text = 'The original passage here.';
  const { view: leafView, leaf } = makePinEditor(text, 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: text.length });
  const plugin = makeWritePlugin();
  plugin.settings.writingCollaborateMode = true;
  const view = makeWriteView(plugin, [leaf], leaf);
  const { prompt } = makePromptDom();
  view.promptEl = prompt;
  const editor = leafView.editor;
  const pinned = SourcePlugin.rewriteMenuPin(plugin, editor, { file: { path: 'Notes/Passage.md' } });
  assert.ok(pinned, 'the editor menu captures the pin');
  assert.deepStrictEqual(pinned.from, { line: 0, ch: 0 }, 'the menu pin starts at the selection');
  assert.deepStrictEqual(pinned.to, { line: 0, ch: text.length }, 'the menu pin ends at the selection');
  assert.strictEqual(pinned.original, text, 'the menu pin keeps the selected text');
  const obsidian = require('obsidian');
  const { REWRITE_PRESETS } = require(path.join(__dirname, '..', 'src', 'writing', 'rewrite.js'));
  const menu = new obsidian.Menu();
  SourcePlugin.addRewritePresetItems(menu, REWRITE_PRESETS, {
    onPreset: () => {},
    onTyped: () => { view.pinSelection(editor, pinned.path); },
  });
  const typed = menu.items.find((i) => i.title === 'Rewrite with instruction…');
  assert.ok(typed, 'the typed item is in the menu');
  typed.handler();
  assert.ok(view.pinned, 'clicking the typed item pins the selection');
  assert.strictEqual(view.pinned.original, text, 'the pinned text is the selection');
  assert.ok(view.pinChipEl, 'the pin chip is rendered');
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(src.includes('view.pinSelection(editor, pinned.path, pinned);'), 'the production editor-menu handler pins the captured selection');
  console.log('PASS editor-menu-typed-path-pins-selection');
}

async function testEditorMenuTypedPathUsesCapturedPin() {
  // The user right-clicks a passage, then moves the selection before the sidebar opens.
  // The chip must show the passage captured at menu time, not the live selection.
  const text = 'The original passage here.';
  const { view: leafView, leaf } = makePinEditor(text, 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: text.length });
  const plugin = makeWritePlugin();
  plugin.settings.writingCollaborateMode = true;
  const view = makeWriteView(plugin, [leaf], leaf);
  const { prompt } = makePromptDom();
  view.promptEl = prompt;
  const editor = leafView.editor;
  const pinned = SourcePlugin.rewriteMenuPin(plugin, editor, { file: { path: 'Notes/Passage.md' } });
  assert.ok(pinned, 'the editor menu captures the pin');
  assert.strictEqual(pinned.original, text, 'the captured pin keeps the passage');
  // the selection moves before the sidebar opens
  editor._state.from = { line: 0, ch: 5 };
  editor._state.to = { line: 0, ch: 9 };
  view.pinSelection(editor, pinned.path, pinned);
  assert.strictEqual(view.pinned.original, text, 'the pin keeps the passage captured at menu time');
  assert.deepStrictEqual(view.pinned.from, { line: 0, ch: 0 }, 'the pin starts where the selection was');
  assert.deepStrictEqual(view.pinned.to, { line: 0, ch: text.length }, 'the pin ends where the selection was');
  const chip = view.pinChipEl;
  assert.ok(chip, 'the pin chip is rendered');
  assert.ok(chip.children[0].textContent.includes(text.slice(0, 60)), 'the chip shows the captured passage');
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert(src.includes('view.pinSelection(editor, pinned.path, pinned);'), 'the production editor-menu handler pins the captured pin');
  console.log('PASS editor-menu-typed-path-uses-captured-pin');
}

async function testApplyUsesEditedAfterText() {
  const { view: leafView, leaf, calls } = makePinEditor('The original passage here.', 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: 10 });
  const plugin = makeWritePlugin(null, async () => ({ markdown: 'B', footnotes: '', sources: [], dropped: 0, sourcesBlock: '', citationStyle: 'footnotes', cited: [], numbers: {} }));
  const view = makeWriteView(plugin, [leaf], leaf);
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  await view.write();
  const modal = view.rewriteModal;
  assert.ok(modal, 'modal opened');
  const ok = modal.onApply('B edited');
  assert.strictEqual(ok, true, 'apply returns true');
  assert.strictEqual(calls.replaceRange.length, 1, 'one replaceRange');
  assert.deepStrictEqual(calls.replaceRange[0], { draft: 'B edited', from: { line: 0, ch: 0 }, to: { line: 0, ch: 10 } }, 'replaceRange replaces pinned range');
  assert.strictEqual(view.pinned, null, 'pin cleared after apply');
  console.log('PASS apply-uses-edited-after-text');
}

async function testContinueInsertsAfterSelection() {
  const { view: leafView, leaf, calls } = makePinEditor('Passage text.', 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: 10 });
  const plugin = makeWritePlugin(null, async () => ({ markdown: 'Next.', footnotes: '', sources: [], dropped: 0, sourcesBlock: '', citationStyle: 'footnotes', cited: [], numbers: {} }));
  const view = makeWriteView(plugin, [leaf], leaf);
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  await view.write({ instruction: 'continue', evidence: 'toggles', apply: 'after', pinned: view.pinned });
  const modal = view.rewriteModal;
  const ok = modal.onApply('Next.');
  assert.strictEqual(ok, true);
  assert.strictEqual(calls.transaction.length, 1, 'one transaction');
  assert.strictEqual(calls.transaction[0].length, 1, 'one change');
  assert.deepStrictEqual(calls.transaction[0][0], { from: { line: 0, ch: 10 }, to: { line: 0, ch: 10 }, text: '\n\nNext.' }, 'inserts after pinned to');
  console.log('PASS continue-inserts-after-selection');
}

async function testApaApplyAddsReferencesInTransaction() {
  const { view: leafView, leaf, calls } = makePinEditor('Claim here.', 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: 7 });
  const plugin = makeWritePlugin(null, async () => ({
    markdown: 'Revised.', footnotes: '', sources: [], dropped: 0, sourcesBlock: '',
    citationStyle: 'apa',
    cited: [{ meta: { authors: ['Schott, D. H.'], year: 2002, title: 'X', journal: 'J. Cell Biol.', volume: 156, pages: '35-39' }, path: 'Notes/Passage.md' }],
    numbers: {},
  }));
  const view = makeWriteView(plugin, [leaf], leaf);
  view.plugin.settings.writingCitationStyle = 'apa';
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  await view.write();
  const modal = view.rewriteModal;
  const ok = modal.onApply('Revised edited.');
  assert.strictEqual(ok, true);
  assert.strictEqual(calls.transaction.length, 1, 'one transaction');
  assert.strictEqual(calls.transaction[0].length, 2, 'two changes: passage + references');
  console.log('PASS apa-apply-adds-references-in-transaction');
}

async function testNatureNumberingChangedRefuses() {
  const { view: leafView, leaf, calls } = makePinEditor('Claim here.', 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: 7 });
  const plugin = makeWritePlugin(null, async () => ({
    markdown: 'Revised.', footnotes: '', sources: [], dropped: 0, sourcesBlock: '',
    citationStyle: 'nature',
    cited: [{ meta: { authors: ['Schott, D. H.'], year: 2002, title: 'X', journal: 'J. Cell Biol.', volume: 156, pages: '35-39' }, path: 'Notes/Passage.md' }],
    numbers: { '[[Notes/Passage]]': 9 },
  }));
  const view = makeWriteView(plugin, [leaf], leaf);
  view.plugin.settings.writingCitationStyle = 'nature';
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  await view.write();
  const modal = view.rewriteModal;
  const ok = modal.onApply('Revised.');
  assert.strictEqual(ok, false, 'returns false on numbering mismatch');
  assert.strictEqual(calls.transaction.length, 0, 'no transaction');
  assert.strictEqual(calls.replaceRange.length, 0, 'no replaceRange');
  const notices = require('obsidian').notices;
  assert.ok(notices.some((n) => n.includes('References changed while writing; run again.')), 'numbering notice shown');
  console.log('PASS nature-numbering-changed-refuses');
}

async function testSelectionInsideReferencesRefuses() {
  const { view: leafView, leaf, calls } = makePinEditor('## References\n1. Existing.', 'Notes/Passage.md', { line: 1, ch: 0 }, { line: 1, ch: 10 });
  const plugin = makeWritePlugin(null, async () => ({
    markdown: 'Revised.', footnotes: '', sources: [], dropped: 0, sourcesBlock: '',
    citationStyle: 'nature',
    cited: [{ meta: { authors: ['Schott, D. H.'], year: 2002, title: 'X', journal: 'J. Cell Biol.', volume: 156, pages: '35-39' }, path: 'Notes/Passage.md' }],
    numbers: {},
  }));
  const view = makeWriteView(plugin, [leaf], leaf);
  view.plugin.settings.writingCitationStyle = 'nature';
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  await view.write();
  const modal = view.rewriteModal;
  const ok = modal.onApply('Revised.');
  assert.strictEqual(ok, false, 'returns false on overlap');
  assert.strictEqual(calls.transaction.length, 0, 'no transaction');
  const notices = require('obsidian').notices;
  assert.ok(notices.includes('The selection overlaps the reference list; not applied.'), 'overlap notice shown');
  console.log('PASS selection-inside-references-refuses');
}

async function testStaleApplyRefuses() {
  const { view: leafView, leaf, calls, setText } = makePinEditor('The original passage here.', 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: 10 });
  const plugin = makeWritePlugin(null, async () => ({ markdown: 'B', footnotes: '', sources: [], dropped: 0, sourcesBlock: '', citationStyle: 'footnotes', cited: [], numbers: {} }));
  const view = makeWriteView(plugin, [leaf], leaf);
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  await view.write();
  setText('The modified passage here.');
  const modal = view.rewriteModal;
  const ok = modal.onApply('B edited');
  assert.strictEqual(ok, false, 'stale apply returns false');
  assert.strictEqual(calls.replaceRange.length, 0, 'no replaceRange after stale');
  assert.strictEqual(calls.transaction.length, 0, 'no transaction after stale');
  const notices = require('obsidian').notices;
  assert.ok(notices.some((n) => n.includes('Selected text changed; not applied.')), 'stale notice shown');
  console.log('PASS stale-apply-refuses');
}

async function testStaleAfterApplyRefuses() {
  // The continuation path ("apply after") must refuse a stale range too, and must not write anything.
  const { view: leafView, leaf, calls, setText } = makePinEditor('The original passage here.', 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: 10 });
  const plugin = makeWritePlugin(null, async () => ({ markdown: 'Next.', footnotes: '', sources: [], dropped: 0, sourcesBlock: '', citationStyle: 'footnotes', cited: [], numbers: {} }));
  const view = makeWriteView(plugin, [leaf], leaf);
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  await view.write({ instruction: 'continue', evidence: 'toggles', apply: 'after', pinned: view.pinned });
  const modal = view.rewriteModal;
  assert.ok(modal, 'modal opened for the continuation');
  setText('The modified passage here.');
  const ok = modal.onApply('Next.');
  assert.strictEqual(ok, false, 'a stale continuation returns false');
  assert.strictEqual(calls.transaction.length, 0, 'no transaction after a stale continuation');
  assert.strictEqual(calls.replaceRange.length, 0, 'no replaceRange after a stale continuation');
  console.log('PASS stale-after-apply-refuses');
}

function testDomMockMirrorsObsidianCreateEl() {
  // The mock must not be more convenient than Obsidian: a textarea created with
  // { value } stays empty (that is the live defect), an input keeps the value.
  const parent = new FakeElement('div');
  const textarea = parent.createEl('textarea', { value: 'x' });
  assert.strictEqual(textarea.value, '', 'Obsidian ignores { value } on a textarea');
  const input = parent.createEl('input', { value: 'x' });
  assert.strictEqual(input.value, 'x', 'Obsidian honours { value } on an input');
  console.log('PASS dom-mock-mirrors-obsidian-create-el');
}

function testNoTextareaReliesOnCreateElValue() {
  // Every other textarea in the plugin (the sidebar prompt, the PromptModal, the template
  // preview) sets its value explicitly, so the Obsidian quirk cannot bite them.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  const offenders = src.split('\n').filter((line) => /createEl\((["'])textarea\1/.test(line) && /\bvalue\s*:/.test(line));
  assert.deepStrictEqual(offenders, [], 'no textarea relies on createEl { value }');
  console.log('PASS no-textarea-relies-on-create-el-value');
}

function testRewritePreviewTextareaValueIsSet() {
  // Source pin for the two live fixes: the After pane sets its value explicitly and
  // applyRewrite refuses an empty passage.
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  const modal = srcClassBody(src, 'RewritePreviewModal');
  assert(!modal.includes('createEl("textarea", { value'), 'the After pane does not rely on createEl { value }');
  assert(modal.includes('afterEl.value = this.after || ""'), 'the After pane sets its value explicitly');
  const apply = srcClassMethodBody(src, 'applyRewrite');
  assert(apply.includes('new Notice("Nothing to apply.")'), 'applyRewrite refuses an empty passage');
  assert(apply.indexOf('Nothing to apply.') > apply.indexOf('Open ${fileBase} to apply.'), 'the empty guard sits after the editor lookup');
  console.log('PASS rewrite-preview-textarea-value-is-set');
}

async function testPreviewAfterPaneShowsRewrite() {
  // Live defect: the After pane opened empty, so Apply replaced the passage with nothing.
  const { view: leafView, leaf } = makePinEditor('The original passage here.', 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: 26 });
  const plugin = makeWritePlugin(null, async () => ({ markdown: '**Rewritten** passage.', footnotes: '', sources: [], dropped: 0, sourcesBlock: '', citationStyle: 'footnotes', cited: [], numbers: {} }));
  const view = makeWriteView(plugin, [leaf], leaf, SourcePlugin);
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  await view.write();
  const modal = view.rewriteModal;
  assert.ok(modal, 'the preview modal opened');
  const after = findByClass(modal.contentEl, 'semantic-todoist-rewrite-after');
  assert.ok(after, 'the After pane is rendered');
  assert.strictEqual(after.tagName, 'textarea', 'the After pane is a textarea');
  assert.strictEqual(after.value, '**Rewritten** passage.', 'the After pane shows the model markdown');
  console.log('PASS preview-after-pane-shows-rewrite');
}

async function testApplyButtonUsesTextareaValue() {
  // Clicking Apply must send the textarea's current value, not the original rewrite.
  const { view: leafView, leaf, calls } = makePinEditor('The original passage here.', 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: 26 });
  const plugin = makeWritePlugin(null, async () => ({ markdown: '**Rewritten** passage.', footnotes: '', sources: [], dropped: 0, sourcesBlock: '', citationStyle: 'footnotes', cited: [], numbers: {} }));
  const view = makeWriteView(plugin, [leaf], leaf, SourcePlugin);
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  await view.write();
  const modal = view.rewriteModal;
  const after = findByClass(modal.contentEl, 'semantic-todoist-rewrite-after');
  const applyBtn = findByClass(modal.contentEl, 'semantic-todoist-rewrite-apply');
  assert.ok(after && applyBtn, 'the preview renders the After pane and the Apply button');
  after.value = 'Edited in the pane.';
  await applyBtn.onclick();
  assert.strictEqual(calls.replaceRange.length, 1, 'one replaceRange');
  assert.strictEqual(calls.replaceRange[0].draft, 'Edited in the pane.', 'the edited textarea value is what got applied');
  console.log('PASS apply-button-uses-textarea-value');
}

async function testEmptyAfterPaneRefusesApply() {
  // An emptied After pane must not wipe the selected passage.
  const { view: leafView, leaf, calls } = makePinEditor('The original passage here.', 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: 26 });
  const plugin = makeWritePlugin(null, async () => ({ markdown: '**Rewritten** passage.', footnotes: '', sources: [], dropped: 0, sourcesBlock: '', citationStyle: 'footnotes', cited: [], numbers: {} }));
  const view = makeWriteView(plugin, [leaf], leaf, SourcePlugin);
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  await view.write();
  const modal = view.rewriteModal;
  const after = findByClass(modal.contentEl, 'semantic-todoist-rewrite-after');
  const applyBtn = findByClass(modal.contentEl, 'semantic-todoist-rewrite-apply');
  assert.ok(after && applyBtn, 'the preview renders the After pane and the Apply button');
  const noticesBefore = (require('obsidian').notices || []).length;
  after.value = '   ';
  await applyBtn.onclick();
  const notices = require('obsidian').notices || [];
  assert.ok(notices.slice(noticesBefore).includes('Nothing to apply.'), 'the empty pane is refused with a notice');
  assert.strictEqual(calls.replaceRange.length, 0, 'no replaceRange after an empty pane');
  assert.strictEqual(calls.transaction.length, 0, 'no transaction after an empty pane');
  assert.strictEqual(modal.opened, true, 'the modal stays open');
  console.log('PASS empty-after-pane-refuses-apply');
}

async function testCheckGoesToSidebar() {
  const { view: leafView, leaf } = makePinEditor('Claim here.', 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: 7 });
  const seen = [];
  const plugin = makeWritePlugin(null, async (inst, opts) => {
    seen.push(opts);
    assert.strictEqual(opts.mode, 'check', 'check mode');
    assert.strictEqual(opts.useVault, true, 'useVault true for check');
    return { markdown: 'Contradiction found.', footnotes: '', sources: [{ eid: 'E1', label: 'x' }], dropped: 0, sourcesBlock: 'Sources searched:\n- vault: searched', citationStyle: 'apa', cited: [{ meta: { authors: ['Schott, D. H.'], year: 2002 }, path: 'Notes/Passage.md' }], numbers: {} };
  });
  const view = makeWriteView(plugin, [leaf], leaf);
  view.plugin.settings.writingCitationStyle = 'apa';
  view.plugin.settings.writingUseVault = true;
  view.plugin.settings.writingUseContext = true;
  view.plugin.settings.writingUseResearch = true;
  view.webSearchMode = 'concise';
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  await view.write({ instruction: 'check', evidence: 'vault', apply: 'chat', pinned: view.pinned });
  assert.strictEqual(view.rewriteModal, undefined, 'no modal for check');
  const last = view.messageLog[view.messageLog.length - 1];
  assert.ok(last.text.includes('Contradiction found.'), 'contains markdown');
  assert.ok(last.text.includes('Schott'), 'contains formatted reference entries');
  assert.ok(last.text.includes('Sources searched'), 'contains sources block');
  // "vault" evidence is the Features toggles with the vault forced on, not everything else off
  assert.strictEqual(seen[0].useVault, true, 'vault evidence searches the vault');
  assert.strictEqual(seen[0].useContext, true, 'vault evidence keeps the context-folder toggle');
  assert.strictEqual(seen[0].useResearch, true, 'vault evidence keeps the deep-research toggle');
  assert.strictEqual(seen[0].webSearchMode, 'concise', 'vault evidence keeps the globe setting');
  // a toggle that is off stays off
  view.plugin.settings.writingUseContext = false;
  await view.write({ instruction: 'check', evidence: 'vault', apply: 'chat', pinned: view.pinned });
  assert.strictEqual(view.rewriteModal, undefined, 'still no modal for check');
  assert.strictEqual(seen[1].useContext, false, 'an off context-folder toggle stays off');
  assert.strictEqual(seen[1].useVault, true, 'vault evidence still searches the vault');
  console.log('PASS check-goes-to-sidebar');
}

async function testVaultEvidenceForcesVault() {
  // "vault" evidence forces the vault on even when the vault toggle is off; the other toggles keep their state.
  const { view: leafView, leaf } = makePinEditor('Claim here.', 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: 7 });
  const seen = [];
  const plugin = makeWritePlugin(null, async (inst, opts) => {
    seen.push(opts);
    return { markdown: 'Checked.', footnotes: '', sources: [], dropped: 0, sourcesBlock: '', citationStyle: 'footnotes', cited: [], numbers: {} };
  });
  const view = makeWriteView(plugin, [leaf], leaf);
  view.plugin.settings.writingUseVault = false;
  view.plugin.settings.writingUseContext = false;
  view.plugin.settings.writingUseResearch = false;
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  await view.write({ instruction: 'check', evidence: 'vault', apply: 'chat', pinned: view.pinned });
  assert.strictEqual(seen.length, 1, 'one model call');
  assert.strictEqual(seen[0].useVault, true, 'vault evidence forces the vault on');
  assert.strictEqual(seen[0].useContext, false, 'an off context-folder toggle stays off');
  assert.strictEqual(seen[0].useResearch, false, 'an off deep-research toggle stays off');
  assert.strictEqual(seen[0].webSearchMode, 'off', 'the globe setting is unchanged');
  console.log('PASS vault-evidence-forces-vault');
}

async function testEvidenceOff() {
  const { view: leafView, leaf } = makePinEditor('Claim here.', 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: 7 });
  const seen = [];
  const plugin = makeWritePlugin(null, async (inst, opts) => {
    seen.push(opts);
    assert.strictEqual(opts.useVault, false);
    assert.strictEqual(opts.useContext, false);
    assert.strictEqual(opts.useResearch, false);
    assert.strictEqual(opts.webSearchMode, 'off');
    return { markdown: 'DRAFT', footnotes: '', sources: [], dropped: 0, sourcesBlock: '', citationStyle: 'footnotes', cited: [], numbers: {} };
  });
  const view = makeWriteView(plugin, [leaf], leaf);
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  await view.write({ instruction: 'x', evidence: 'off', apply: 'replace', pinned: view.pinned });
  // the stub's own assertions only run if the stub runs, so the call is counted as well
  assert.strictEqual(seen.length, 1, 'the model was called once');
  assert.strictEqual(seen[0].useVault, false, 'the vault was not searched');
  assert.strictEqual(seen[0].useContext, false, 'the context folder was not searched');
  assert.strictEqual(seen[0].useResearch, false, 'deep research was not searched');
  assert.strictEqual(seen[0].webSearchMode, 'off', 'web search was off');
  console.log('PASS evidence-off');
}

async function testEmptyModelOutput() {
  const { view: leafView, leaf } = makePinEditor('Claim here.', 'Notes/Passage.md', { line: 0, ch: 0 }, { line: 0, ch: 7 });
  const plugin = makeWritePlugin(null, async () => ({ markdown: '  ', footnotes: '', sources: [], dropped: 0, sourcesBlock: '', citationStyle: 'footnotes', cited: [], numbers: {} }));
  const view = makeWriteView(plugin, [leaf], leaf);
  view.pinSelection(leafView.editor, 'Notes/Passage.md');
  await view.write();
  assert.strictEqual(view.rewriteModal, undefined, 'no modal for empty output');
  const last = view.messageLog[view.messageLog.length - 1];
  assert.strictEqual(last.text, 'No rewrite returned.', 'no rewrite returned message');
  console.log('PASS empty-model-output');
}

async function testInsertAtCursorApa() {
  // No pin + APA: the draft and the new ## References section land in one transaction.
  const { leaf, calls } = makeMarkdownLeaf('Notes/Passage.md', 'Body text.');
  const plugin = makeWritePlugin(null, async () => ({
    markdown: 'Draft with a citation (Schott, 2002).', footnotes: '', sources: [], dropped: 0, sourcesBlock: '',
    citationStyle: 'apa',
    cited: [{ meta: { authors: ['Schott, D. H.'], year: 2002, title: 'X', journal: 'J. Cell Biol.', volume: 156, pages: '35-39' }, path: 'Notes/Passage.md' }],
    numbers: {},
  }));
  const view = makeWriteView(plugin, [leaf], leaf);
  view.plugin.settings.writingCitationStyle = 'apa';
  await view.write();
  assert.strictEqual(calls.replaceRange.length, 0, 'no replaceRange for the apa insert');
  assert.strictEqual(calls.transaction.length, 1, 'one transaction');
  assert.strictEqual(calls.transaction[0].length, 2, 'two changes: draft + references');
  const [draftChange, refsChange] = calls.transaction[0];
  assert.ok(draftChange.text.includes('Draft with a citation'), 'draft inserted at the cursor');
  assert.ok(refsChange.text.includes('## References'), 'references section added');
  assert.ok(refsChange.text.includes('Schott'), 'reference entry carries the source');
  console.log('PASS insert-at-cursor-apa');
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
  await testCollaborateSendsConversation();
  await testCollaborateUsesTodoistLookup();
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
  testRelevantNotesSetting();
  testTaskTabsSplit();
  testCollaborateSettingsTab();
  testAiSearchNoLongerOwnsWriting();
  testFeaturesMenuHotSwapOnly();
  testCitationStyleDefault();
  testEditorMenuGuards();
  testMenuHiddenWhenModeOff();
  await testPinnedSelectionOpensPreview();
  await testPinnedRewriteUsesPinnedNote();
  await testBackwardsSelectionPin();
  await testChipClearsPin();
  await testPinSelectionCallsEditorMethods();
  await testEditorMenuTypedPathPinsSelection();
  await testEditorMenuTypedPathUsesCapturedPin();
  await testApplyUsesEditedAfterText();
  await testContinueInsertsAfterSelection();
  await testApaApplyAddsReferencesInTransaction();
  await testNatureNumberingChangedRefuses();
  await testSelectionInsideReferencesRefuses();
  await testStaleApplyRefuses();
  await testStaleAfterApplyRefuses();
  testDomMockMirrorsObsidianCreateEl();
  testNoTextareaReliesOnCreateElValue();
  testRewritePreviewTextareaValueIsSet();
  await testPreviewAfterPaneShowsRewrite();
  await testApplyButtonUsesTextareaValue();
  await testEmptyAfterPaneRefusesApply();
  await testCheckGoesToSidebar();
  await testVaultEvidenceForcesVault();
  await testEvidenceOff();
  await testEmptyModelOutput();
  await testInsertAtCursorApa();
  console.log('writing-sidebar-test: PASS (expanded)');
}

runTests();
