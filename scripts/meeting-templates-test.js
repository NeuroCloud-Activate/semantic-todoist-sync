'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

const calls = [];
let responder = null;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request !== 'obsidian') return originalLoad.call(this, request, parent, isMain);
  class Empty {}
  return {
    ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty,
    Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty,
    TFile: Empty, Menu: Empty, setIcon() {},
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
  console.log('PASS parse');

  // built-in
  const entry = DEFAULT_PROMPT_TEMPLATE_FILES.find((f) => f.filename === 'Prepare for meeting \u2013 Supervisor.md');
  assert(entry, 'built-in entry exists');
  assert(/^Prepare me for a meeting with my supervisor\./.test(entry.prompt), 'verbatim spec body');
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
}

function specBody() {
  const L = require('fs').readFileSync(path.join(__dirname, '..', 'docs/superpowers/specs/2026-10-29-meeting-prep-design.md'), 'utf8').split(/\r?\n/);
  const h = L.findIndex((l) => l.startsWith('## The built-in template'));
  const dashes = []; let end = -1;
  for (let i = h + 1; i < L.length && end < 0; i++) { if (L[i] === '---') dashes.push(i); else if (dashes.length >= 2 && L[i].startsWith('```')) end = i; }
  return L.slice(dashes[1] + 1, end).join('\n').trim();
}
{
  const e = DEFAULT_PROMPT_TEMPLATE_FILES.find((x) => x.action === 'meeting-prep');
  assert.strictEqual(e.filename, 'Prepare for meeting \u2013 Supervisor.md');
  assert.strictEqual(e.prompt, specBody());
  console.log('PASS built-in verbatim');
}
main().catch((e) => { console.error(e); process.exit(1); });
