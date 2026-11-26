"use strict";
// getTodoistSnapshot changes-only sync (sync_token) and the background keep-warm in backgroundTick. requestUrl is stubbed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = path.join(__dirname, "..", "src/main.js");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
let requestHandler = () => { throw new Error("network disabled in test"); };
const originalLoad = Module._load;
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
  class Empty { open() {} }
  return {
    ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice: Empty, Plugin: Empty,
    PluginSettingTab: Empty, Setting: Empty, TFile: Empty, setIcon() {},
    requestUrl: async (options) => requestHandler(options)
  };
};
let Plugin;
try {
  global.window = { setTimeout, clearTimeout, requestIdleCallback: null };
  testModule._compile(fs.readFileSync(mainPath, "utf8"), mainPath);
  Plugin = testModule.exports;
} finally {
  Module._load = originalLoad;
}

const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const ok = (json) => ({ status: 200, json, text: "" });
const rawItem = (id, content, extra = {}) => ({ id, content, project_id: "p1", ...extra });

function makePlugin() {
  const plugin = Object.create(Plugin.prototype);
  plugin.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { todoistToken: "tok" });
  plugin.saveSettings = async () => {};
  plugin.logs = [];
  plugin.logLocal = (message) => plugin.logs.push(message);
  plugin.sent = [];
  requestHandler = async (options) => {
    const body = new URLSearchParams(options.body);
    plugin.sent.push(body.get("sync_token"));
    return plugin.reply(body.get("sync_token"), plugin.sent.length);
  };
  return plugin;
}
const FULL = ok({ full_sync: true, sync_token: "T1", items: [rawItem("1", "A"), rawItem("2", "B")], projects: [{ id: "p1", name: "Home" }], sections: [] });
const ids = (snapshot) => snapshot.tasks.map((t) => t.id).sort();

test("first fetch is full and the returned token is stored", async () => {
  const p = makePlugin();
  p.reply = () => FULL;
  const snapshot = await p.getTodoistSnapshot();
  assert.deepEqual(p.sent, ["*"]);
  assert.deepEqual(ids(snapshot), ["1", "2"]);
  assert.equal(p.lastTodoistSnapshot.snapshot, snapshot);
});

test("forced refresh sends the stored token and returns the merged snapshot", async () => {
  const p = makePlugin();
  p.reply = (token, n) => n === 1 ? FULL : ok({ full_sync: false, sync_token: "T2", items: [rawItem("2", "B2"), rawItem("3", "C"), rawItem("1", "A", { is_deleted: true })] });
  await p.getTodoistSnapshot();
  const snapshot = await p.getTodoistSnapshot(["items", "projects", "sections"], true);
  assert.deepEqual(p.sent, ["*", "T1"]);
  assert.deepEqual(ids(snapshot), ["2", "3"]);
  assert.equal(snapshot.tasks.find((t) => t.id === "2").content, "B2");
  assert.equal(p.settings.availableTodoistProjects.length, 1);
});

test("expired cache also uses the token; a fresh cache sends nothing", async () => {
  const p = makePlugin();
  p.reply = (token, n) => n === 1 ? FULL : ok({ sync_token: "T2" });
  await p.getTodoistSnapshot();
  await p.getTodoistSnapshot();
  assert.equal(p.sent.length, 1);
  p.todoistSnapshotCache.fetchedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const snapshot = await p.getTodoistSnapshot();
  assert.deepEqual(p.sent, ["*", "T1"]);
  assert.deepEqual(ids(snapshot), ["1", "2"]);
});

test("full_sync: true in a token response replaces the snapshot", async () => {
  const p = makePlugin();
  p.reply = (token, n) => n === 1 ? FULL : ok({ full_sync: true, sync_token: "T9", items: [rawItem("7", "G")], projects: [], sections: [] });
  await p.getTodoistSnapshot();
  const snapshot = await p.getTodoistSnapshot(undefined, true);
  assert.deepEqual(ids(snapshot), ["7"]);
});

test("a failing token request retries once with * and replaces", async () => {
  const p = makePlugin();
  p.reply = (token, n) => n === 1 ? FULL : token === "T1" ? { status: 400, json: {}, text: "bad token" } : ok({ full_sync: true, sync_token: "T3", items: [rawItem("8", "H")], projects: [], sections: [] });
  await p.getTodoistSnapshot();
  const snapshot = await p.getTodoistSnapshot(undefined, true);
  assert.deepEqual(p.sent, ["*", "T1", "*"]);
  assert.deepEqual(ids(snapshot), ["8"]);
  p.reply = () => ok({ sync_token: "T4" });
  await p.getTodoistSnapshot(undefined, true);
  assert.equal(p.sent.at(-1), "T3");
});

test("a failing first request still throws", async () => {
  const p = makePlugin();
  p.reply = () => ({ status: 500, json: {}, text: "down" });
  await assert.rejects(() => p.getTodoistSnapshot(), /returned 500/);
  assert.deepEqual(p.sent, ["*"]);
});

test("nulling todoistSnapshotCache keeps the token: next request is changes-only", async () => {
  const p = makePlugin();
  p.reply = (token, n) => n === 1 ? FULL : ok({ sync_token: "T2", items: [rawItem("5", "E")] });
  await p.getTodoistSnapshot();
  p.todoistSnapshotCache = null;
  const snapshot = await p.getTodoistSnapshot();
  assert.deepEqual(p.sent, ["*", "T1"]);
  assert.deepEqual(ids(snapshot), ["1", "2", "5"]);
});

test("different resource keys keep separate tokens", async () => {
  const p = makePlugin();
  p.reply = () => FULL;
  await p.getTodoistSnapshot();
  await p.getTodoistSnapshot(["items"], true);
  assert.deepEqual(p.sent, ["*", "*"]);
});

function tickPlugin() {
  const p = makePlugin();
  p.canStartBackgroundWork = () => true;
  p.refreshes = [];
  p.releases = [];
  p.getTodoistSnapshot = (types, force) => { p.refreshes.push({ types, force }); return new Promise((resolve, reject) => p.releases.push({ resolve, reject })); };
  return p;
}
test("backgroundTick refreshes a missing snapshot once at a time", async () => {
  const p = tickPlugin();
  p.backgroundTick();
  p.backgroundTick();
  assert.equal(p.refreshes.length, 1);
  assert.deepEqual(p.refreshes[0], { types: ["items", "projects", "sections"], force: true });
  p.releases[0].resolve({});
  await new Promise((r) => setImmediate(r));
  p.todoistSnapshotCache = null;
  p.backgroundTick();
  assert.equal(p.refreshes.length, 2);
});

test("backgroundTick skips a fresh snapshot and a missing token, and logs failures", async () => {
  const p = tickPlugin();
  p.todoistSnapshotCache = { key: "items,projects,sections", fetchedAt: new Date().toISOString(), snapshot: {} };
  p.backgroundTick();
  assert.equal(p.refreshes.length, 0);
  p.todoistSnapshotCache.fetchedAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  p.settings.todoistToken = "";
  p.backgroundTick();
  assert.equal(p.refreshes.length, 0);
  p.settings.todoistToken = "tok";
  p.backgroundTick();
  assert.equal(p.refreshes.length, 1);
  p.releases[0].reject(new Error("offline"));
  await new Promise((r) => setImmediate(r));
  assert.equal(p.logs.length, 1);
  assert.equal(p.todoistBackgroundRefresh, null);
});

test("backgroundTick backs off for the snapshot TTL after a failed refresh", async () => {
  const p = tickPlugin();
  p.backgroundTick();
  p.releases[0].reject(new Error("429"));
  await new Promise((r) => setImmediate(r));
  p.backgroundTick();
  assert.equal(p.refreshes.length, 1);
  p.todoistBackgroundFailedAt = Date.now() - 6 * 60 * 1000;
  p.backgroundTick();
  assert.equal(p.refreshes.length, 2);
});

for (const status of [429, 500, 503, 401]) {
  test(`a ${status} on the token request is not retried with *`, async () => {
    const p = makePlugin();
    p.reply = (token, n) => n === 1 ? FULL : { status, json: {}, text: "nope" };
    await p.getTodoistSnapshot();
    await assert.rejects(() => p.getTodoistSnapshot(undefined, true), new RegExp(`returned ${status}`));
    assert.deepEqual(p.sent, ["*", "T1"]);
  });
}

test("a 410 on the token request still retries once with *", async () => {
  const p = makePlugin();
  p.reply = (token, n) => n === 1 ? FULL : token === "T1" ? { status: 410, json: {}, text: "gone" } : ok({ full_sync: true, sync_token: "T3", items: [], projects: [], sections: [] });
  await p.getTodoistSnapshot();
  await p.getTodoistSnapshot(undefined, true);
  assert.deepEqual(p.sent, ["*", "T1", "*"]);
});

test("changing the API token discards the stored sync state; the fingerprint is not the token", async () => {
  const p = makePlugin();
  p.settings.todoistToken = "secret-token-ABCD";
  p.reply = (token, n) => n === 1 ? FULL : ok({ full_sync: true, sync_token: "T2", items: [rawItem("9", "Z")], projects: [], sections: [] });
  await p.getTodoistSnapshot();
  await p.getTodoistSnapshot(undefined, true);
  assert.deepEqual(p.sent, ["*", "T1"]);
  const state = p.todoistSyncState["items,projects,sections"];
  assert.ok(!JSON.stringify(state).includes("secret-token-ABCD"));
  p.settings.todoistToken = "other-token-WXYZ";
  await p.getTodoistSnapshot(undefined, true);
  assert.deepEqual(p.sent, ["*", "T1", "*"]);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed += 1; console.error(`FAIL - ${name}\n${e.stack}`); }
  }
  console.log(`${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exit(1);
})();
