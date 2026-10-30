'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

class SharedTFile {} // same class for the plugin's instanceof checks and the fake vault
const calls = [];
const notices = [];
let responder = null;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request !== 'obsidian') return originalLoad.call(this, request, parent, isMain);
  class Empty {}
  return {
    ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty,
    Notice: class { constructor(m) { notices.push(m); } }, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty,
    TFile: SharedTFile, Menu: Empty, setIcon() {},
    requestUrl: async (options) => {
      calls.push(options.url);
      if (responder) return responder(options);
      throw new Error('network disabled');
    }
  };
};
global.window = { setTimeout, clearTimeout, requestIdleCallback: null };
global.fetch = async () => { throw new Error('network disabled'); };

const Plugin = require(path.join(__dirname, '..', 'main.js'));
const {
  parsePromptTemplateFile, promptTemplateFileText, DEFAULT_PROMPT_TEMPLATE_FILES,
  isMeetingPrepTemplate, isTaskGenerationTemplate, isScheduleTodayTemplate
} = Plugin;

function makePlugin(settings = {}) {
  const plugin = Object.create(Plugin.prototype);
  plugin.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { todoistToken: 'FICTIONAL_TOKEN' }, settings);
  plugin.logLocal = () => {};
  plugin.saveCount = 0; plugin.saveSettings = async () => { plugin.saveCount++; };
  return plugin;
}
const file = { basename: 'Meet', path: 'P/Meet.md' };
const tpl = (extra) => parsePromptTemplateFile(file, `---\naction: meeting-prep\n${extra}\n---\nBody`);
const day = (n) => new Date(Date.now() - n * 86400000).toISOString();
const page = (status, json) => ({ status, json, text: JSON.stringify(json || {}) });

async function main() {
  // parse
  const t = tpl('completedDays: 30\nprojects: Thesis, Grant');
  assert.strictEqual(t.action, 'meeting-prep');
  assert.strictEqual(t.completedDays, 30);
  assert.deepStrictEqual(t.projects, ['Thesis', 'Grant']);
  assert.strictEqual(tpl('completedDays: abc').completedDays, 14);
  assert.strictEqual(tpl('completedDays: 0').completedDays, 1);
  assert.strictEqual(tpl('completedDays: 500').completedDays, 90);
  assert.deepStrictEqual(tpl('projects:').projects, []);
  assert.strictEqual(parsePromptTemplateFile(file, '---\naction: prepare-meeting\n---\nx').action, 'meeting-prep');
  // template-driven layout: new frontmatter keys, defaults, invalid fallbacks, yes/no
  const d = tpl('');
  assert.deepStrictEqual({ subprojects: d.subprojects, taskList: d.taskList, maxTasks: d.maxTasks, overview: d.overview }, { subprojects: 'merge', taskList: 'cited', maxTasks: 5, overview: true });
  const custom = tpl('subprojects: Separate\ntaskList: All\nmaxTasks: 7\noverview: no');
  assert.strictEqual(custom.subprojects, 'separate', 'case-insensitive accept');
  assert.strictEqual(custom.taskList, 'all');
  assert.strictEqual(custom.maxTasks, 7);
  assert.strictEqual(custom.overview, false);
  const yes = tpl('overview: yes\nsubprojects: separate\ntaskList: none');
  assert.strictEqual(yes.overview, true, 'overview: yes');
  assert.strictEqual(yes.taskList, 'none');
  const bad = tpl('subprojects: bogus\ntaskList: bogus\nmaxTasks: bogus');
  assert.strictEqual(bad.subprojects, 'merge', 'invalid subprojects -> default');
  assert.strictEqual(bad.taskList, 'cited', 'invalid taskList -> default');
  assert.strictEqual(bad.maxTasks, 5, 'invalid maxTasks -> default');
  assert.strictEqual(tpl('maxTasks: 0').maxTasks, 1);
  assert.strictEqual(tpl('maxTasks: 500').maxTasks, 50);
  assert.strictEqual(tpl('maxTasks: 4.7').maxTasks, 4);
  // ignoreLabels / ignoreProjects: Todoist tags and projects to leave out
  assert.deepStrictEqual({ l: d.ignoreLabels, p: d.ignoreProjects }, { l: [], p: [] }, 'ignore lists default to empty');
  assert.deepStrictEqual(tpl('ignoreLabels:\nignoreProjects:').ignoreLabels, [], 'blank ignoreLabels');
  assert.deepStrictEqual(tpl('ignoreLabels:\nignoreProjects:').ignoreProjects, [], 'blank ignoreProjects');
  assert.deepStrictEqual(tpl('ignoreLabels: Notes, Someday').ignoreLabels, ['Notes', 'Someday']);
  assert.deepStrictEqual(tpl('ignoreProjects: Inbox ,  Personal ,, ').ignoreProjects, ['Inbox', 'Personal'], 'trimmed, blanks dropped');
  assert.deepStrictEqual(tpl('ignoreLabels: [Notes, Someday]').ignoreLabels, ['Notes', 'Someday'], 'bracket list');
  assert.deepStrictEqual(tpl('ignoreProjects: [Inbox, Personal]').ignoreProjects, ['Inbox', 'Personal'], 'bracket list');
  assert.deepStrictEqual(tpl('ignoreLabels: #Notes, @Someday, Plain').ignoreLabels, ['Notes', 'Someday', 'Plain'], 'leading # or @ stripped from labels');
  assert.deepStrictEqual(tpl('ignoreLabels: ##Notes, @#Odd').ignoreLabels, ['#Notes', '#Odd'], 'only one leading marker stripped per label');
  assert.deepStrictEqual(tpl('ignoreLabels: #, @').ignoreLabels, [], 'marker-only items are blank');
  assert.deepStrictEqual(tpl('ignoreProjects: #Hash').ignoreProjects, ['#Hash'], 'project names are not marker-stripped');
  console.log('PASS parse');

  // built-in
  const entry = DEFAULT_PROMPT_TEMPLATE_FILES.find((f) => f.filename === 'Collaborate/Prepare for meeting \u2013 Supervisor.md');
  assert(entry, 'built-in entry exists');
  assert(/^## Meeting\n\nPrepare me for a meeting with my supervisor\./.test(entry.prompt), 'verbatim spec body');
  const round = parsePromptTemplateFile(file, promptTemplateFileText(entry));
  assert.strictEqual(round.action, 'meeting-prep');
  assert.strictEqual(round.completedDays, 14);
  assert.deepStrictEqual(round.projects, []);
  assert.strictEqual(round.createTasks, false);
  assert.strictEqual(Plugin.DEFAULT_SETTINGS.writingUseTodoist, false);
  assert.strictEqual(Plugin.normalizeStableSettings({}).writingUseTodoist, false);
  assert.strictEqual(Plugin.normalizeStableSettings({ writingUseTodoist: true }).writingUseTodoist, true);
  console.log('PASS built-in');

  // filters
  const meeting = { action: 'meeting-prep', createTasks: true, name: 'M', prompt: 'Generate follow-up tasks' };
  assert.strictEqual(isMeetingPrepTemplate(meeting), true);
  assert.strictEqual(isMeetingPrepTemplate({ action: 'schedule-today' }), false);
  assert.strictEqual(isMeetingPrepTemplate({}), false);
  assert.strictEqual(isTaskGenerationTemplate(meeting), false);
  assert.strictEqual(isScheduleTodayTemplate(meeting), false);
  console.log('PASS filters');

  // completed fetch, cursor
  const plugin = makePlugin();
  responder = (o) => o.url.includes('cursor=C2')
    ? page(200, { items: [{ id: 'b', content: 'B', project_id: 'p', completed_at: day(2) }], next_cursor: null })
    : page(200, { items: [{ id: 'a', content: 'A', project_id: 'p', completed_at: day(1) }], next_cursor: 'C2' });
  const before = Date.now();
  const done = await plugin.fetchRecentCompletedTodoistTasks(7);
  assert.deepStrictEqual(done.map((x) => x.id), ['a', 'b']);
  assert(done.every((x) => x.completedAt));
  assert.strictEqual(calls.length, 2);
  assert(calls.every((u) => u.includes('/tasks/completed/by_completion_date') && u.includes('since=') && u.includes('until=')));
  const since = Date.parse(decodeURIComponent(/since=([^&]+)/.exec(calls[0])[1]));
  assert(Math.abs(since - (before - 7 * 86400000)) < 60000, 'since = now - days');
  console.log('PASS completed fetch (cursor)');

  // 404 fallback
  calls.length = 0;
  responder = (o) => {
    if (o.url.includes('by_completion_date')) return page(404, {});
    if (o.url.includes('offset=0')) return page(200, { items: [{ task_id: 'x', content: 'X', completed_at: day(1) }, { task_id: 'y', content: 'Y', completed_at: day(10) }] });
    return page(200, { items: [{ task_id: 'z', content: 'Z', completed_at: day(20) }] });
  };
  const fb = await plugin.fetchRecentCompletedTodoistTasks(7);
  assert.deepStrictEqual(fb.map((x) => x.id), ['x']);
  assert(calls[1].includes('/tasks/completed?limit=200&offset=0'));
  assert.strictEqual(calls.length, 2, 'no further page after older-than-cutoff page');
  console.log('PASS completed fetch (404 fallback)');

  // 400 fallback (90-day window edge)
  calls.length = 0;
  responder = (o) => {
    if (o.url.includes('by_completion_date')) return page(400, {});
    return page(200, { items: [{ task_id: 'x', content: 'X', completed_at: day(1) }] });
  };
  const fb400 = await plugin.fetchRecentCompletedTodoistTasks(7);
  assert.deepStrictEqual(fb400.map((x) => x.id), ['x']);
  console.log('PASS completed fetch (400 fallback)');

  // projects bracket list
  assert.deepStrictEqual(tpl('projects: [A, B]').projects, ['A', 'B']);
  assert.deepStrictEqual(tpl('projects: [Solo]').projects, ['Solo']);
  console.log('PASS projects brackets');

  // meeting templates never run from the prompt-template path
  const guarded = Object.create(Plugin.prototype);
  guarded.generateTaskListFromTemplate = async () => { throw new Error('must not be called'); };
  await assert.rejects(guarded.runPromptTemplate({ action: 'meeting-prep', name: 'M', prompt: 'x' }), (e) => e.message === 'Meeting templates run from Collaborate: pick it in the meeting preset list.');
  console.log('PASS runPromptTemplate guard');

  // unavailable
  responder = null;
  await assert.rejects(makePlugin({ todoistToken: '' }).getMeetingTodoistRaw({ completedDays: 14 }), (e) => e.code === 'todoist-unavailable');
  console.log('PASS unavailable');

  // meeting snapshot projects carry parentId for meeting prep
  responder = (o) => {
    if (o.url.includes('/sync')) return page(200, { full_sync: true, projects: [{ id: 'p1', name: 'Top' }, { id: 'p2', name: 'Sub', parent_id: 'p1' }], items: [], sections: [] });
    return page(200, { items: [], next_cursor: null });
  };
  const snapPlugin = makePlugin();
  snapPlugin.saveSettings = async () => {};
  const raw = await snapPlugin.getMeetingTodoistRaw({ completedDays: 14 });
  assert.strictEqual(raw.snapshot.projects.find((p) => p.id === 'p1').parentId, '', 'top-level parentId empty');
  assert.strictEqual(raw.snapshot.projects.find((p) => p.id === 'p2').parentId, 'p1', 'sub-project keeps parent_id');
  console.log('PASS meeting snapshot parentId');
}

function specFileText() {
  const L = require('fs').readFileSync(path.join(__dirname, '..', 'docs/superpowers/specs/2026-10-29-meeting-prep-design.md'), 'utf8').split(/\r?\n/);
  const h = L.findIndex((l) => l.startsWith('## The built-in template'));
  let start = -1, end = -1;
  for (let i = h + 1; i < L.length; i++) {
    if (start < 0 && L[i].startsWith('```')) { start = i + 1; continue; }
    if (start >= 0 && L[i].startsWith('```')) { end = i; break; }
  }
  return L.slice(start, end).join('\n').trim();
}
{
  const e = DEFAULT_PROMPT_TEMPLATE_FILES.find((x) => x.action === 'meeting-prep');
  assert.strictEqual(e.filename, 'Collaborate/Prepare for meeting \u2013 Supervisor.md');
  assert.strictEqual(e.prompt, specFileText());
  console.log('PASS built-in verbatim');
}
main().catch((e) => { console.error(e); process.exit(1); });

// ---- Meeting prep folder & template generator (addendum 2026-10-29) ----
const TFile = SharedTFile;
const OLD_SUPERVISOR_PROMPT = "Prepare me for a meeting with my supervisor.\n\nFor each project, group related tasks into themes. For each theme write one short paragraph in plain prose: where things stand, what I finished recently, what is in progress or coming up, and any decisions, blockers or questions I should raise. Name the tasks you discuss. Give follow-ups of recently completed work particular attention.\n\nBelow the paragraphs for each project, list only the tasks worth discussing.\n\nUse only facts from the evidence and cite them. If something is unclear or missing, put it under \"Questions to raise\" rather than guessing. Keep it easy to follow in a meeting.";
const OLD_HEADINGS = ['Meeting', 'For each project', 'Task list', 'Rules'];
const HEADINGS = ['Meeting', 'Overview', 'For each project', 'Rules'];
const SUB = 'Collaborate';
const FOLDER = 'Semantic Todoist Sync/Prompts';
const OLD_PATH = `${FOLDER}/Prepare for meeting \u2013 Supervisor.md`;
const NEW_PATH = `${FOLDER}/${SUB}/Prepare for meeting \u2013 Supervisor.md`;
const BACKUP = `${FOLDER}/${SUB}/Prepare for meeting \u2013 Supervisor (before 0.9.41).md`;
const norm = (s) => String(s).replace(/\r\n/g, '\n').trim();
const oldFileText = () => `---
action: meeting-prep
completedDays: 14
projects: 
createTasks: false
insertResponse: true
syncTasks: false
---

Prepare me for a meeting with my supervisor.

For each project, group related tasks into themes. For each theme write one short paragraph in plain prose: where things stand, what I finished recently, what is in progress or coming up, and any decisions, blockers or questions I should raise. Name the tasks you discuss. Give follow-ups of recently completed work particular attention.

Below the paragraphs for each project, list only the tasks worth discussing.

Use only facts from the evidence and cite them. If something is unclear or missing, put it under "Questions to raise" rather than guessing. Keep it easy to follow in a meeting.`;
const oldSupervisor09038Text = () => `---
action: meeting-prep
completedDays: 14
projects: 
createTasks: false
insertResponse: true
syncTasks: false
---

## Meeting

Prepare me for a meeting with my supervisor.

## For each project

For each project, group related tasks into themes. For each theme write one short paragraph in plain prose: where things stand, what I finished recently, what is in progress or coming up, and any decisions, blockers or questions I should raise. Name the tasks you discuss. Give follow-ups of recently completed work particular attention.

## Task list

Below the paragraphs for each project, list only the tasks worth discussing.

## Rules

Use only facts from the evidence and cite them. If something is unclear or missing, put it under "Questions to raise" rather than guessing. Keep it easy to follow in a meeting.`;

// Released 0.9.40 (== 0.9.39) built-in Supervisor, byte-exact (1525 bytes, sha256 BFEA741A3702...) from the test-vault copy.
const V0940 = [
  "---",
  "action: meeting-prep",
  "completedDays: 14",
  "projects: ",
  "subprojects: merge",
  "taskList: cited",
  "maxTasks: 5",
  "overview: yes",
  "createTasks: false",
  "insertResponse: true",
  "syncTasks: false",
  "---",
  "",
  "%% Settings: completedDays = days of finished tasks to include (1\u201390) \u00b7 projects = Todoist project names, comma-separated (blank = all) \u00b7 subprojects = merge (fold sub-projects into their main project) or separate \u00b7 taskList = cited (only tasks the text mentions), all, or none \u00b7 maxTasks = most tasks listed per project \u00b7 overview = yes or no. Vault, context folder, research and web sources follow the sidebar's Evidence menu. %%",
  "",
  "## Meeting",
  "",
  "Prepare me for a meeting with my supervisor. Keep the whole document short enough to read in a few minutes.",
  "",
  "## Overview",
  "",
  "Start with an overview of at most 3 sentences on the most time-sensitive items across projects.",
  "",
  "## For each project",
  "",
  "Write one short paragraph of at most 5 sentences: where things stand, what I finished recently, what is in progress or coming up, and any decisions or blockers. Group related tasks together instead of going through them one by one, and give follow-ups of recently completed work particular attention. Do not use sub-headings. After the paragraph, list at most 3 questions to raise, only for things that are unclear or missing.",
  "",
  "## Rules",
  "",
  "Use only facts from the evidence and cite them. Leave out tasks that need no discussion, and skip a project entirely when nothing in it needs discussion. Include important items from sub-projects in their main project."
].join("\n");
const oldSupervisor09040Text = () => V0940;

function fakeApp(initial = {}) {
  const files = new Map(Object.entries(initial));
  const folders = new Set();
  const opened = [];
  const mk = (p) => { const f = new TFile(); f.path = p; f.extension = 'md'; f.basename = p.split('/').pop().replace(/\.md$/, ''); return f; };
  const objs = new Map();
  const get = (p) => { if (folders.has(p)) return { path: p, children: [] }; if (!files.has(p)) return null; if (!objs.has(p)) objs.set(p, mk(p)); return objs.get(p); };
  const app = {
    files, folders, opened,
    vault: {
      getAbstractFileByPath: get,
      getMarkdownFiles: () => [...files.keys()].map(get),
      cachedRead: async (f) => files.get(f.path),
      read: async (f) => files.get(f.path),
      create: async (p, t) => { files.set(p, t); return get(p); },
      createFolder: async (p) => { folders.add(p); },
      modify: async (f, t) => { files.set(f.path, t); },
    },
    fileManager: { renameFile: async (f, np) => { const t = files.get(f.path); files.delete(f.path); objs.delete(f.path); files.set(np, t); f.path = np; objs.set(np, f); } },
    workspace: { getLeaf: (kind) => ({ openFile: async (f) => { opened.push({ kind, path: f.path }); } }), getLeavesOfType: () => [] },
  };
  return app;
}
function appPlugin(initial, settings) {
  const p = makePlugin(Object.assign({ promptTemplatesFolder: FOLDER }, settings));
  p.app = fakeApp(initial);
  return p;
}

async function folderTests() {
  // 1/3: folder-implied templates
  {
    const p = appPlugin({
      [`${FOLDER}/${SUB}/Plain.md`]: 'Just write about my week.',
      [`${FOLDER}/${SUB}/deep/Nested.md`]: '---\naction: summarize\n---\nBody',
      [`${FOLDER}/Elsewhere.md`]: '---\naction: meeting-prep\n---\nX',
      [`${FOLDER}/Normal.md`]: 'Summarize things',
    });
    const t = await p.getPromptTemplates();
    const by = (n) => t.find((x) => x.source.endsWith('/' + n));
    assert.strictEqual(by('Plain.md').action, 'meeting-prep');
    assert.strictEqual(by('Nested.md').action, 'meeting-prep');
    assert.strictEqual(by('Elsewhere.md').action, 'meeting-prep');
    assert.notStrictEqual(by('Normal.md').action, 'meeting-prep');
    const runnable = t.filter((x) => !isMeetingPrepTemplate(x));
    assert(runnable.some((x) => x.source.endsWith('/Normal.md')));
    assert(!runnable.some((x) => /Plain|Nested|Elsewhere|Supervisor/.test(x.source)));
    assert(!t.filter(isTaskGenerationTemplate).some(isMeetingPrepTemplate));
    console.log('PASS folder-implied meeting templates');
  }
  // 4/5: built-in entry, headings, verbatim sections
  {
    const e = DEFAULT_PROMPT_TEMPLATE_FILES.find((x) => x.action === 'meeting-prep');
    assert.strictEqual(e.filename, `${SUB}/Prepare for meeting \u2013 Supervisor.md`);
    const skeleton = Plugin.meetingPrepTemplateSkeleton();
    const heads = (s) => s.split('\n').filter((l) => l.startsWith('## '));
    assert.deepStrictEqual(heads(skeleton), HEADINGS.map((h) => '## ' + h));
    assert.deepStrictEqual(heads(e.prompt), HEADINGS.map((h) => '## ' + h));
    const paras = [ 'Prepare me for a meeting with my supervisor. Keep the whole document short enough to read in a few minutes.', 'Start with an overview of at most 3 sentences on the most time-sensitive items across projects.', 'Write one short paragraph of at most 5 sentences: where things stand, what I finished recently, what is in progress or coming up, and any decisions or blockers. Group related tasks together instead of going through them one by one, and give follow-ups of recently completed work particular attention. Do not use sub-headings. After the paragraph, list at most 3 questions to raise, only for things that are unclear or missing.', 'Use only facts from the evidence and cite them. Leave out tasks that need no discussion, and skip a project entirely when nothing in it needs discussion. Include important items from sub-projects in their main project.' ];
    const secs = e.prompt.split(/^## .*$/m).slice(1).map((s) => s.trim());
    assert.deepStrictEqual(secs, paras);
    assert(!e.prompt.includes('%%'), 'no instruction comments in Supervisor');
    const fm = (s) => s.split('\n---')[0].split('\n').map((l) => l.split(':')[0].trim()).filter((k) => k && k !== '---');
    const expectedKeys = ['action', 'completedDays', 'projects', 'ignoreProjects', 'ignoreLabels', 'subprojects', 'taskList', 'maxTasks', 'overview', 'createTasks', 'insertResponse', 'syncTasks'];
    assert.deepStrictEqual(fm(promptTemplateFileText(e)), expectedKeys);
    assert.deepStrictEqual(fm(skeleton), expectedKeys);
    // blank values, and the settings comment explains both new keys
    for (const text of [promptTemplateFileText(e), skeleton]) {
      assert(/\nignoreProjects:[ \t]*\nignoreLabels:[ \t]*\n/.test(text), 'ignore keys written blank');
      assert(text.includes('ignoreProjects = Todoist projects to leave out, with their sub-projects \u00b7 ignoreLabels = Todoist labels to leave out, e.g. Notes'), 'comment explains ignore keys');
    }
    // lists written out and read back
    const withIgnore = promptTemplateFileText(Object.assign({}, e, { ignoreProjects: ['A', 'B'], ignoreLabels: ['Notes'] }));
    assert(withIgnore.includes('\nignoreProjects: A, B\nignoreLabels: Notes\n'));
    const back = parsePromptTemplateFile(file, withIgnore, true);
    assert.deepStrictEqual([back.ignoreProjects, back.ignoreLabels], [['A', 'B'], ['Notes']]);
    const sk = parsePromptTemplateFile(file, skeleton, true);
    assert.strictEqual(sk.action, 'meeting-prep'); assert.strictEqual(sk.completedDays, 14);
    assert.deepStrictEqual(sk.projects, []); assert.strictEqual(sk.createTasks, false);
    assert.strictEqual(sk.insertResponse, true); assert.strictEqual(sk.syncAfterInsert, false);
    assert.strictEqual(sk.subprojects, 'merge'); assert.strictEqual(sk.taskList, 'cited');
    assert.strictEqual(sk.maxTasks, 5); assert.strictEqual(sk.overview, true);
    console.log('PASS built-in subfolder, shared headings, verbatim sections');
  }
  // 4: migration
  {
    const newText = promptTemplateFileText(DEFAULT_PROMPT_TEMPLATE_FILES.find((x) => x.action === 'meeting-prep'));
    const old09038 = oldSupervisor09038Text();
    // 0.9.37 top-level unedited -> moved + NEW text
    let p = appPlugin({ [OLD_PATH]: oldFileText().replace(/\n/g, '\r\n') });
    await p.ensurePromptTemplateFolder(false);
    assert(!p.app.files.has(OLD_PATH)); assert.strictEqual(norm(p.app.files.get(NEW_PATH)), norm(newText));
    // edited 0.9.37 top-level -> moved, replaced by NEW text, edit kept in backup
    p = appPlugin({ [OLD_PATH]: oldFileText() + '\nMy edit' });
    await p.ensurePromptTemplateFolder(false);
    assert(!p.app.files.has(OLD_PATH)); assert.strictEqual(norm(p.app.files.get(NEW_PATH)), norm(newText));
    assert.strictEqual(p.app.files.get(BACKUP), oldFileText() + '\nMy edit');
    // both locations -> top-level untouched; edited Collaborate copy replaced and backed up
    p = appPlugin({ [OLD_PATH]: 'OLD', [NEW_PATH]: 'NEW' });
    await p.ensurePromptTemplateFolder(false);
    assert.strictEqual(p.app.files.get(OLD_PATH), 'OLD'); assert.strictEqual(norm(p.app.files.get(NEW_PATH)), norm(newText));
    assert.strictEqual(p.app.files.get(BACKUP), 'NEW');
    // neither -> new default created
    p = appPlugin({});
    await p.ensurePromptTemplateFolder(false);
    assert.strictEqual(p.app.files.get(NEW_PATH), newText); assert(!p.app.files.has(OLD_PATH));
    assert(p.app.folders.has(`${FOLDER}/${SUB}`));
    // 0.9.38 unedited Collaborate file -> replaced with NEW text, edited untouched
    p = appPlugin({ [NEW_PATH]: old09038 });
    await p.ensurePromptTemplateFolder(false);
    assert.strictEqual(norm(p.app.files.get(NEW_PATH)), norm(newText));
    p = appPlugin({ [NEW_PATH]: old09038 + '\nMy edit' });
    await p.ensurePromptTemplateFolder(false);
    assert.strictEqual(norm(p.app.files.get(NEW_PATH)), norm(newText)); assert.strictEqual(p.app.files.get(BACKUP), old09038 + '\nMy edit');
// one changed word in a real old file counts as edited: replaced, old bytes backed up
const oneWord = old09038.replace('Rules', 'Rule');
assert.notStrictEqual(oneWord, old09038);
p = appPlugin({ [NEW_PATH]: oneWord });
await p.ensurePromptTemplateFolder(false);
assert.strictEqual(norm(p.app.files.get(NEW_PATH)), norm(newText)); assert.strictEqual(p.app.files.get(BACKUP), oneWord);
const oneWord37 = oldFileText().replace('supervisor', 'boss');
assert.notStrictEqual(oneWord37, oldFileText());
p = appPlugin({ [OLD_PATH]: oneWord37 });
await p.ensurePromptTemplateFolder(false);
assert.strictEqual(p.app.files.get(BACKUP), oneWord37, 'edited 0.9.37 content kept in backup'); assert.strictEqual(norm(p.app.files.get(NEW_PATH)), norm(newText));
// new built-in text is not re-migrated (idempotent)
p = appPlugin({ [NEW_PATH]: old09038 });
await p.ensurePromptTemplateFolder(false);
const once = p.app.files.get(NEW_PATH);
assert.strictEqual(norm(once), norm(newText));
let modifies = 0; const origModify = p.app.vault.modify;
p.app.vault.modify = async (...a) => { modifies++; return origModify(...a); };
await p.ensurePromptTemplateFolder(false);
assert.strictEqual(modifies, 0, 'second run does not rewrite');
assert.strictEqual(p.app.files.get(NEW_PATH), once);
    console.log('PASS migration (unedited, edited, both, neither)');
  }
  // 0.9.41 one-time Supervisor upgrade: marker, backup of edited copies, never overwrite
  {
    const V = '0.9.41';
    const newText = promptTemplateFileText(DEFAULT_PROMPT_TEMPLATE_FILES.find((x) => x.action === 'meeting-prep'));
    const old09038 = oldSupervisor09038Text();
    assert.strictEqual(Plugin.DEFAULT_SETTINGS.supervisorTemplateVersion, '');
    assert.strictEqual(Plugin.SUPERVISOR_TEMPLATE_VERSION, V);
    // missing -> created, marker set + saved
    let p = appPlugin({});
    await p.ensurePromptTemplateFolder(false);
    assert.strictEqual(p.settings.supervisorTemplateVersion, V); assert.strictEqual(p.saveCount, 1);
    // marker already current: no reads, no writes, even for an edited file
    p = appPlugin({ [NEW_PATH]: 'MY EDIT' }, { supervisorTemplateVersion: V });
    let reads = 0; const rd = p.app.vault.read; p.app.vault.read = async (f) => { reads++; return rd(f); };
    await p.ensurePromptTemplateFolder(false);
    assert.strictEqual(reads, 0, 'no reads once marker is current'); assert.strictEqual(p.app.files.get(NEW_PATH), 'MY EDIT');
    assert.strictEqual(p.saveCount, 0);
    // current built-in (CRLF) -> marker only
    p = appPlugin({ [NEW_PATH]: newText.replace(/\n/g, '\r\n') });
    await p.ensurePromptTemplateFolder(false);
    assert.strictEqual(p.settings.supervisorTemplateVersion, V); assert.strictEqual(p.app.files.size, DEFAULT_PROMPT_TEMPLATE_FILES.length);
    assert.strictEqual(p.app.files.get(NEW_PATH), newText.replace(/\n/g, '\r\n'), 'current text left as is');
    // released unedited 0.9.40 (real 1525-byte file) -> replaced, no backup, marker 0.9.41, even with the 0.9.40 marker set
    const old09040 = oldSupervisor09040Text();
    assert.strictEqual(Buffer.byteLength(old09040, 'utf8'), 1525, 'real 0.9.40 file size');
    assert.strictEqual(require('crypto').createHash('sha256').update(old09040).digest('hex').slice(0, 12).toUpperCase(), 'BFEA741A3702', 'real 0.9.40 file hash');
    for (const marker of ['', '0.9.40']) {
      for (const eol of ['\n', '\r\n']) {
        notices.length = 0;
        p = appPlugin({ [NEW_PATH]: old09040.replace(/\n/g, eol) }, { supervisorTemplateVersion: marker });
        await p.ensurePromptTemplateFolder(false);
        assert(!p.app.files.has(BACKUP), 'unedited 0.9.40 is not backed up');
        assert.strictEqual(norm(p.app.files.get(NEW_PATH)), norm(newText)); assert.notStrictEqual(norm(p.app.files.get(NEW_PATH)), norm(old09040));
        assert.strictEqual(p.settings.supervisorTemplateVersion, V);
        assert.deepStrictEqual(notices, [], 'no backup notice for unedited default');
      }
    }
    // edited 0.9.40 with the old marker -> backup '(before 0.9.41)' then replace
    p = appPlugin({ [NEW_PATH]: old09040 + '\nMy edit' }, { supervisorTemplateVersion: '0.9.40' });
    await p.ensurePromptTemplateFolder(false);
    assert.strictEqual(p.app.files.get(BACKUP), old09040 + '\nMy edit'); assert.strictEqual(norm(p.app.files.get(NEW_PATH)), norm(newText)); assert.strictEqual(p.settings.supervisorTemplateVersion, V);
    assert(BACKUP.endsWith('(before 0.9.41).md'));
    // released unedited 0.9.38 -> replaced, no backup
    p = appPlugin({ [NEW_PATH]: old09038 });
    await p.ensurePromptTemplateFolder(false);
    assert(!p.app.files.has(BACKUP)); assert.strictEqual(norm(p.app.files.get(NEW_PATH)), norm(newText)); assert.strictEqual(p.settings.supervisorTemplateVersion, V);
    // edited -> backup exact bytes, replaced, one Notice, marker
    notices.length = 0;
    p = appPlugin({ [NEW_PATH]: 'MY\r\nEDIT ' });
    await p.ensurePromptTemplateFolder(false);
    assert.strictEqual(p.app.files.get(BACKUP), 'MY\r\nEDIT '); assert.strictEqual(norm(p.app.files.get(NEW_PATH)), norm(newText));
    assert.deepStrictEqual(notices, ['Updated Supervisor meeting template. Previous version saved \u201cPrepare for meeting \u2013 Supervisor (before 0.9.41)\u201d.']);
    assert.strictEqual(p.settings.supervisorTemplateVersion, V); assert.strictEqual(p.saveCount, 1);
    // second run is a no-op
    await p.ensurePromptTemplateFolder(false); assert.strictEqual(p.app.files.get(BACKUP), 'MY\r\nEDIT '); assert.strictEqual(p.saveCount, 1);
    // existing backups never overwritten
    p = appPlugin({ [NEW_PATH]: 'EDIT3', [BACKUP]: 'B1', [BACKUP.replace('.md', ' 2.md')]: 'B2' });
    await p.ensurePromptTemplateFolder(false);
    assert.strictEqual(p.app.files.get(BACKUP), 'B1'); assert.strictEqual(p.app.files.get(BACKUP.replace('.md', ' 2.md')), 'B2');
    assert.strictEqual(p.app.files.get(BACKUP.replace('.md', ' 3.md')), 'EDIT3'); assert.strictEqual(norm(p.app.files.get(NEW_PATH)), norm(newText));
    // backup fails -> original untouched, marker unset, retried next load
    p = appPlugin({ [NEW_PATH]: 'EDIT4' });
    const cr = p.app.vault.create; p.app.vault.create = async (pth, t) => { if (pth.includes('(before')) throw new Error('boom'); return cr(pth, t); };
    await p.ensurePromptTemplateFolder(false);
    assert.strictEqual(p.app.files.get(NEW_PATH), 'EDIT4'); assert.strictEqual(p.settings.supervisorTemplateVersion, ''); assert.strictEqual(p.saveCount, 0);
    p.app.vault.create = cr;
    await p.ensurePromptTemplateFolder(false);
    assert.strictEqual(p.app.files.get(BACKUP), 'EDIT4'); assert.strictEqual(p.settings.supervisorTemplateVersion, V);
    // backups are ordinary meeting templates with distinct identities
    const names = (await p.getPromptTemplates()).filter(isMeetingPrepTemplate).map((t) => t.source);
    assert(names.includes(BACKUP) && names.includes(NEW_PATH) && new Set(names).size === names.length);
    console.log('PASS 0.9.41 supervisor one-time upgrade');
  }
  // getMeetingTodoistData forwards ignoreLabels / ignoreProjects to buildTaskRecords
  {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    const at = src.indexOf('async getMeetingTodoistData(');
    const body = src.slice(at, src.indexOf('async prepareMeeting(', at));
    assert(/async getMeetingTodoistData\(\{[^}]*ignoreLabels[^}]*ignoreProjects[^}]*\}/.test(body), 'signature takes both');
    assert(/buildTaskRecords\(\{[^}]*ignoreLabels[^}]*\}\)/.test(body) && /buildTaskRecords\(\{[^}]*ignoreProjects[^}]*\}\)/.test(body), 'both passed to buildTaskRecords');
    // end to end through the real task builder: a task labelled Notes and a task in an ignored project drop out
    const mkTask = (id, extra) => Object.assign({ id, content: 'Task ' + id, projectId: 'p1', labels: [], priority: 1, description: '', dueDate: '' }, extra);
    const plugin = makePlugin();
    plugin.getMeetingTodoistRaw = async () => ({ snapshot: { projects: [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }], sections: [], tasks: [mkTask('a'), mkTask('b', { labels: ['Notes'] }), mkTask('c', { projectId: 'p2' })] }, completed: [] });
    const ids = async (extra) => (await plugin.getMeetingTodoistData(Object.assign({ completedDays: 14 }, extra))).records.map((r) => r.id).sort();
    assert.deepStrictEqual(await ids({}), ['a', 'b', 'c']);
    assert.deepStrictEqual(await ids({ ignoreLabels: ['Notes'] }), ['a', 'c'], 'ignoreLabels drops tagged task');
    assert.deepStrictEqual(await ids({ ignoreProjects: ['Beta'] }), ['a', 'b'], 'ignoreProjects drops project task');
    console.log('PASS getMeetingTodoistData ignore forwarding');
  }
  // concurrent ensure calls (sidebar, meeting presets, startup, folder events all load together) must not duplicate or clobber
  {
    const slow = (p) => {
      const tick = () => new Promise((r) => setTimeout(r, 1));
      const v = p.app.vault; const fm = p.app.fileManager;
      for (const [o, k] of [[v, 'read'], [v, 'create'], [v, 'createFolder'], [v, 'modify']]) { const f = o[k]; o[k] = async (...a) => { await tick(); const r = await f(...a); await tick(); return r; }; }
      // like Obsidian, rename is not atomic: the old path leaves the cache before the new one lands
      fm.renameFile = async (f, np) => { const t = p.app.files.get(f.path); p.app.files.delete(f.path); await tick(); await tick(); p.app.files.set(np, t); f.path = np; };
      return p;
    };
    const newText = promptTemplateFileText(DEFAULT_PROMPT_TEMPLATE_FILES.find((x) => x.action === 'meeting-prep'));
    for (const n of [2, 3]) {
      const p = slow(appPlugin({ [OLD_PATH]: oldFileText() }));
      await Promise.all(Array.from({ length: n }, () => p.ensurePromptTemplateFolder(false)));
      const supers = [...p.app.files.keys()].filter((k) => k.includes('Supervisor'));
      assert.deepStrictEqual(supers, [NEW_PATH], `${n} concurrent calls leave exactly one Supervisor`);
      assert.strictEqual(norm(p.app.files.get(NEW_PATH)), norm(newText));
      for (const t of DEFAULT_PROMPT_TEMPLATE_FILES) assert(p.app.files.has(`${FOLDER}/${t.filename}`));
      assert.strictEqual(p.app.files.size, DEFAULT_PROMPT_TEMPLATE_FILES.length);
    }
    let p = slow(appPlugin({ [OLD_PATH]: oldFileText() + '\nMy edit' }));
    await Promise.all([p.ensurePromptTemplateFolder(false), p.ensurePromptTemplateFolder(false)]);
    assert.strictEqual(p.app.files.get(BACKUP), oldFileText() + '\nMy edit', 'edited file backed up once');
    assert.strictEqual(norm(p.app.files.get(NEW_PATH)), norm(newText), 'edited file replaced by NEW text');
    assert.deepStrictEqual([...p.app.files.keys()].filter((k) => k.includes('Supervisor')).sort(), [BACKUP, NEW_PATH].sort());
    p = slow(appPlugin({ [OLD_PATH]: 'MY OLD' }));
    p.app.fileManager.renameFile = async () => { throw new Error('rename boom'); };
    await Promise.all([p.ensurePromptTemplateFolder(false), p.ensurePromptTemplateFolder(false)]);
    assert.strictEqual(p.app.files.get(OLD_PATH), 'MY OLD', 'failed rename isolated');
    // later call re-runs: deleted default comes back
    p = slow(appPlugin({}));
    await Promise.all([p.ensurePromptTemplateFolder(false), p.ensurePromptTemplateFolder(false)]);
    p.app.files.delete(NEW_PATH);
    await p.ensurePromptTemplateFolder(false);
    assert(p.app.files.has(NEW_PATH), 'later call runs again');
    console.log('PASS concurrent ensure calls');
  }
  // review fixes: unedited check reads fresh content; failed move does not block other defaults
  {
    let p = appPlugin({ [OLD_PATH]: oldFileText() });
    p.app.vault.cachedRead = async () => 'STALE CACHE';
    await p.ensurePromptTemplateFolder(false);
    assert(!p.app.files.has(OLD_PATH), 'migration decides from vault.read, not cachedRead');
    assert.strictEqual(norm(p.app.files.get(NEW_PATH)), norm(promptTemplateFileText(DEFAULT_PROMPT_TEMPLATE_FILES.find((x) => x.action === 'meeting-prep'))));
    p = appPlugin({ [OLD_PATH]: 'MY OLD' });
    p.app.fileManager.renameFile = async () => { throw new Error('rename boom'); };
    await p.ensurePromptTemplateFolder(false);
    assert.strictEqual(p.app.files.get(OLD_PATH), 'MY OLD', 'old file untouched');
    for (const t of DEFAULT_PROMPT_TEMPLATE_FILES.filter((x) => x.action !== 'meeting-prep')) assert(p.app.files.has(`${FOLDER}/${t.filename}`), `default ${t.filename} still created`);
    const crlf = parsePromptTemplateFile(file, '---\naction: meeting-prep\n---\na\r\n\r\n%% c %%\r\n\r\n\r\nb', true);
    assert.strictEqual(crlf.prompt, 'a\n\nb', 'CRLF comment gaps collapse');
    p = appPlugin({}, { promptTemplatesFolder: '' });
    await assert.rejects(p.createMeetingPrepTemplate(), (e) => e.message === 'Set the Prompt folder in Settings first.');
    console.log('PASS review fixes');
  }
  // 6: %% stripping
  {
    const body = 'A\n\n%% hidden\nmulti %%\n\n\n\nB %% inline %% C\n\n%% last %%';
    const m = parsePromptTemplateFile({ basename: 'M', path: 'P/M.md' }, `---\naction: meeting-prep\n---\n${body}`);
    assert.strictEqual(m.prompt, 'A\n\nB  C');
    const n = parsePromptTemplateFile({ basename: 'N', path: 'P/N.md' }, `---\naction: summarize\n---\n${body}`);
    assert.strictEqual(n.prompt, body);
    const f = parsePromptTemplateFile({ basename: 'F', path: 'P/F.md' }, body, true);
    assert.strictEqual(f.prompt, 'A\n\nB  C');
    console.log('PASS %% comments stripped for meeting templates only');
  }
  // 7: generator
  {
    const p = appPlugin({});
    const f1 = await p.createMeetingPrepTemplate();
    assert.strictEqual(f1.path, `${FOLDER}/${SUB}/New meeting template.md`);
    assert.strictEqual(p.app.files.get(f1.path), Plugin.meetingPrepTemplateSkeleton());
    const f2 = await p.createMeetingPrepTemplate();
    assert.strictEqual(f2.path, `${FOLDER}/${SUB}/New meeting template 2.md`);
    const f3 = await p.createMeetingPrepTemplate();
    assert.strictEqual(f3.path, `${FOLDER}/${SUB}/New meeting template 3.md`);
    assert.deepStrictEqual(p.app.opened.map((o) => o.kind), ['tab', 'tab', 'tab']);
    assert.strictEqual(p.app.opened[1].path, f2.path);
    assert.strictEqual(p.app.files.get(f1.path), Plugin.meetingPrepTemplateSkeleton(), 'never overwrites');
    const t = (await p.getPromptTemplates()).filter((x) => x.source === f1.path)[0];
    assert.strictEqual(t.action, 'meeting-prep');
    assert(/Who the meeting is with/i.test(Plugin.meetingPrepTemplateSkeleton()) || Plugin.meetingPrepTemplateSkeleton().includes('%%'));
    assert(!p.app.files.has(`${FOLDER}/Meeting prep/Supervisor.md`) && ![...p.app.files.keys()].some((k) => k.includes('Meeting prep')), 'no Meeting prep folder used');
    console.log('PASS createMeetingPrepTemplate');
  }
  // ensure:false reads the folder without re-creating a renamed/deleted default
{
  const SUPERVISOR = `${FOLDER}/${SUB}/Prepare for meeting \u2013 Supervisor.md`;
  const p = appPlugin({ [`${FOLDER}/${SUB}/Weekly sync.md`]: '---\naction: meeting-prep\n---\nx' });
  const before = [...p.app.files.keys()].sort();
  const t = await p.getPromptTemplates({ ensure: false });
  assert.deepStrictEqual([...p.app.files.keys()].sort(), before, 'no file created');
  assert(!p.app.files.has(SUPERVISOR));
  assert.deepStrictEqual(t.map((x) => x.source), [`${FOLDER}/${SUB}/Weekly sync.md`]);
  await p.getPromptTemplates();
  assert(p.app.files.has(SUPERVISOR), 'default call still re-creates the default');
  console.log('PASS getPromptTemplates ensure:false');
}
// 2: debounced refresh
  {
    const p = appPlugin({});
    let refreshes = 0;
    p.app.workspace.getLeavesOfType = () => [{ view: { populateSidebarActionOptions: async () => { refreshes++; } } }];
    p.handlePromptFolderEvent(`${FOLDER}/${SUB}/A.md`);
    p.handlePromptFolderEvent(`${FOLDER}/B.md`);
    p.handlePromptFolderEvent('Elsewhere/C.md', `${FOLDER}/${SUB}/A.md`);
    assert.strictEqual(refreshes, 0, 'debounced');
    await new Promise((r) => setTimeout(r, 700));
    assert.strictEqual(refreshes, 1, 'one refresh for the burst');
    p.handlePromptFolderEvent('Notes/Outside.md');
    p.handlePromptFolderEvent(`${FOLDER}-other/x.md`);
    await new Promise((r) => setTimeout(r, 700));
    assert.strictEqual(refreshes, 1, 'outside Prompts folder does not refresh');
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
    for (const ev of ['modify', 'create', 'delete', 'rename']) {
      const i = src.indexOf(`this.app.vault.on("${ev}"`);
      assert(src.slice(i, i + 400).includes('this.handlePromptFolderEvent('), `${ev} handler hooks the refresh`);
    }
    console.log('PASS debounced prompt-folder refresh');
  }
}
folderTests().catch((e) => { console.error(e); process.exit(1); });
