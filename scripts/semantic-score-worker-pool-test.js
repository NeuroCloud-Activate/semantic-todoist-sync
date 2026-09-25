const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Worker: ThreadWorker } = require('node:worker_threads');

const root = path.resolve(__dirname, '..');
const fragmentPath = path.join(root, 'main.js');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const helperStart = mainSource.indexOf('function createSemanticScoreWorkerPool(');
const helperEnd = mainSource.indexOf('\nfunction cosine(', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'main.js must provide the score worker pool');
const fragment = mainSource.slice(helperStart, helperEnd);

// Captured from main.js cosine at lines 36723-36731. Keep this test baseline
// independent of the worker source assembled by the production helper.
const cosineSource = `function cosine(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / ((Math.sqrt(magA) * Math.sqrt(magB)) || 1);
}`;

const defaultIdlePause = async () => { await new Promise((resolve) => setImmediate(resolve)); };

function createWorkerEnvironment(mode = 'real', delayMs = 0) {
  const blobs = new Map();
  const state = { created: 0, active: 0, maxActive: 0, messages: [], revoked: 0, terminated: 0 };
  let nextUrl = 0;
  class TestBlob {
    constructor(parts) { this.source = parts.join(''); }
  }
  const TestURL = {
    createObjectURL(blob) {
      const url = `blob:test/${++nextUrl}`;
      blobs.set(url, blob.source);
      return url;
    },
    revokeObjectURL(url) {
      if (blobs.delete(url)) state.revoked += 1;
    }
  };
  class TestWorker {
    constructor(url) {
      state.created += 1;
      if (mode === 'throw-constructor') throw new Error('worker construction failed');
      this.listeners = new Map();
      this.closed = false;
      this.mode = mode;
      if (mode === 'throw-constructor') return;
      const source = blobs.get(url);
      if (!source) throw new Error('worker source URL missing');
      if (mode === 'real' || mode === 'delayed' || mode === 'late') {
        const boot = `
          const { parentPort } = require('node:worker_threads');
          globalThis.self = {
            set onmessage(fn) { parentPort.on('message', (data) => fn({ data })); },
            postMessage(message) { parentPort.postMessage(message); }
          };
          ${source}
        `;
        this.thread = new ThreadWorker(boot, { eval: true });
        this.thread.on('message', (data) => this.emit('message', { data }));
        this.thread.on('error', (error) => this.emit('error', error));
        this.thread.on('exit', () => { state.active = Math.max(0, state.active - (this.countedActive ? 1 : 0)); });
      }
    }
    addEventListener(name, callback) {
      const list = this.listeners.get(name) || [];
      list.push(callback);
      this.listeners.set(name, list);
    }
    removeEventListener(name, callback) {
      this.listeners.set(name, (this.listeners.get(name) || []).filter((entry) => entry !== callback));
    }
    emit(name, event) {
      for (const callback of this.listeners.get(name) || []) callback(event);
    }
    postMessage(message, transfer = []) {
      const packedBytes = (message.vectors || []).reduce((total, vector) => total + vector.buffer.byteLength, 0);
      state.messages.push({ pairCount: (message.pairs || []).length, packedBytes, transferCount: transfer.length });
      if (mode === 'throw-post') throw new Error('postMessage failed');
      if (mode === 'error') {
        queueMicrotask(() => this.emit('error', new Error('worker runtime failed')));
        return;
      }
      if (mode === 'timeout') return;
      if (mode === 'malformed') {
        queueMicrotask(() => this.emit('message', { data: { jobId: message.jobId, scores: [NaN] } }));
        return;
      }
      if (mode === 'late') {
        setTimeout(() => this.thread.postMessage(message, transfer), delayMs || 40);
      } else {
        if (!this.countedActive) {
          this.countedActive = true;
          state.active += 1;
          state.maxActive = Math.max(state.maxActive, state.active);
        }
        const send = () => this.thread.postMessage(message, transfer);
        if (mode === 'delayed') setTimeout(send, delayMs || 20);
        else send();
      }
    }
    terminate() {
      if (this.closed) return;
      this.closed = true;
      state.terminated += 1;
      if (this.countedActive) {
        this.countedActive = false;
        state.active = Math.max(0, state.active - 1);
      }
      if (this.thread) this.thread.terminate();
    }
  }
  return { Worker: TestWorker, Blob: TestBlob, URL: TestURL, state };
}

function loadFactory(environment = createWorkerEnvironment(), hardwareConcurrency = 8, idle = defaultIdlePause) {
  const context = {
    ...environment,
    navigator: { hardwareConcurrency },
    hardwareConcurrency,
    idlePause: idle,
    setTimeout,
    clearTimeout,
    performance,
    console,
    Math,
    Number,
    Map,
    WeakMap,
    Array,
    Float64Array,
    Error,
    Promise
  };
  const executable = `${cosineSource}\n${fragment}\ncreateSemanticScoreWorkerPool`;
  return vm.runInNewContext(executable, context, { filename: fragmentPath });
}

function refCosine(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / ((Math.sqrt(magA) * Math.sqrt(magB)) || 1);
}

async function waitFor(predicate, timeoutMs = 1000) {
  const stopAt = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= stopAt) throw new Error('timed out waiting for worker adapter state');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

async function testExactWorkerParityAndCopiedInputs() {
  const env = createWorkerEnvironment('real');
  const create = loadFactory(env);
  const pool = create({ maxWorkers: 2 });
  const a = new Float64Array([1, -2, 3.5, 4]);
  const b = new Float64Array([-3, 1, 2]);
  const zero = new Float64Array([0, 0]);
  const nearA = new Float64Array([1, 1e-14, -1e-14]);
  const nearB = new Float64Array([1, 0, -1e-14]);
  const before = [a, b, zero, nearA, nearB].map((vector) => Buffer.from(vector.buffer).toString('hex'));
  const pairs = [[a, b], [zero, b], [nearA, nearB], [a, a], [b, zero]];
  const scores = await pool.scorePairs(pairs);
  assert.equal(scores.length, pairs.length);
  scores.forEach((score, index) => {
    assert.equal(Number.isFinite(score), true);
    assert.equal(Object.is(score, refCosine(...pairs[index])), true, `score ${index} must be bit exact`);
  });
  assert.deepEqual([a, b, zero, nearA, nearB].map((vector) => Buffer.from(vector.buffer).toString('hex')), before);
  assert.equal(pool.stats.workerBatches, 1);
  pool.dispose();
  await waitFor(() => env.state.terminated >= 1);
}

async function testBatchLimitsDedupeAndConcurrentWorkers() {
  const env = createWorkerEnvironment('delayed', 20);
  const create = loadFactory(env);
  const pool = create({ maxWorkers: 2 });
  const sharedA = new Float64Array([1, 2, 3]);
  const sharedB = new Float64Array([3, 2, 1]);
  const sharedPairs = Array.from({ length: 300 }, () => [sharedA, sharedB]);
  const vectorPairs = Array.from({ length: 70 }, (_, index) => [
    new Float64Array(2048).fill(index + 1),
    new Float64Array(2048).fill(index + 2)
  ]);
  const first = pool.scorePairs(sharedPairs);
  const second = pool.scorePairs(vectorPairs);
  const [sharedScores, vectorScores] = await Promise.all([first, second]);
  assert.equal(sharedScores.length, 300);
  assert.equal(sharedScores.every((score) => Object.is(score, refCosine(sharedA, sharedB))), true);
  assert.equal(vectorScores.length, 70);
  assert.equal(vectorScores.every(Number.isFinite), true);
  assert.ok(env.state.maxActive <= 2, `active worker count was ${env.state.maxActive}`);
  assert.ok(env.state.maxActive >= 2, 'independent calls should use both available slots');
  assert.ok(env.state.messages.length > 4, 'pair and byte caps should split the calls into batches');
  assert.ok(env.state.messages.every(({ pairCount }) => pairCount <= 128));
  assert.ok(env.state.messages.every(({ packedBytes }) => packedBytes <= 1024 * 1024));
  assert.ok(env.state.messages.every(({ transferCount }) => transferCount <= 256));
  assert.ok(env.state.messages.some(({ pairCount, transferCount }) => pairCount === 128 && transferCount === 2),
    'repeated vector references are packed once per batch');
  assert.ok(pool.stats.maxPackedBytes <= 1024 * 1024);
  pool.dispose();
}

async function testUnsupportedAndThrowingWorkersFallbackCooperatively() {
  for (const kind of ['unsupported', 'throw-constructor', 'throw-post', 'error', 'malformed', 'timeout']) {
    const env = createWorkerEnvironment(kind);
    if (kind === 'unsupported') delete env.Worker;
    const idleCalls = { count: 0 };
    const create = loadFactory(env, 8, async () => {
      idleCalls.count += 1;
      await new Promise((resolve) => setImmediate(resolve));
    });
    const pool = create({ maxWorkers: 2, timeoutMs: 25 });
    const pairs = Array.from({ length: 140 }, (_, index) => [
      new Float64Array([index + 1, 2, 3]),
      new Float64Array([3, index + 2, 1])
    ]);
    const scores = await pool.scorePairs(pairs);
    assert.equal(scores.length, pairs.length, `${kind}: fallback result length`);
    assert.equal(scores.every(Number.isFinite), true, `${kind}: fallback scores are finite`);
    assert.ok(idleCalls.count >= 1, `${kind}: bounded fallback yields to the event loop`);
    assert.ok(pool.stats.fallbackBatches >= 1, `${kind}: fallback counter is updated`);
    const batchesAfterFallback = pool.stats.workerBatches;
    const more = await pool.scorePairs([[new Float64Array([1, 0]), new Float64Array([0, 1])]]);
    assert.equal(Object.is(more[0], 0), true);
    assert.equal(pool.stats.workerBatches, batchesAfterFallback, `${kind}: no worker retry after failure`);
    pool.dispose();
  }
}

async function testCpuLimitUnknownAndSmallDevicesUseOneWorker() {
  for (const hardwareConcurrency of [undefined, 0, 2]) {
    const env = createWorkerEnvironment('delayed', 10);
    const create = loadFactory(env, hardwareConcurrency === undefined ? NaN : hardwareConcurrency);
    const pool = create({ maxWorkers: 2 });
    const vector = new Float64Array([1, 2, 3]);
    await Promise.all([
      pool.scorePairs(Array.from({ length: 8 }, () => [vector, vector])),
      pool.scorePairs(Array.from({ length: 8 }, () => [vector, vector]))
    ]);
    assert.equal(env.state.created, 1);
    assert.ok(env.state.maxActive <= 1);
    pool.dispose();
  }
}

async function testLateResponseCannotSettleTwice() {
  const env = createWorkerEnvironment('late', 60);
  const create = loadFactory(env);
  const pool = create({ maxWorkers: 1, timeoutMs: 10 });
  const a = new Float64Array([1, 2]);
  const b = new Float64Array([2, 1]);
  let settlements = 0;
  const pending = pool.scorePairs([[a, b]]).then((value) => { settlements += 1; return value; });
  const scores = await pending;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(settlements, 1);
  assert.equal(Object.is(scores[0], refCosine(a, b)), true);
  assert.equal(pool.stats.fallbackBatches, 1);
  pool.dispose();
}

async function testDisposeRejectsActiveWaitingAndFutureCalls() {
  const env = createWorkerEnvironment('timeout');
  const create = loadFactory(env);
  const pool = create({ maxWorkers: 1, timeoutMs: 500 });
  const vector = new Float64Array([1, 2, 3]);
  const active = pool.scorePairs([[vector, vector]]);
  const waiting = pool.scorePairs([[vector, new Float64Array([3, 2, 1])]]);
  await waitFor(() => env.state.messages.length === 1);
  pool.dispose();
  const future = pool.scorePairs([[vector, vector]]);
  for (const pending of [active, waiting, future]) {
    await assert.rejects(pending, (error) => error && error.code === 'semantic-scoring-disposed');
  }
  assert.equal(pool.stats.fallbackBatches, 0);
  assert.equal(env.state.terminated, 1);
}

async function testFailedInnerYieldRejectsInsteadOfContinuing() {
  const env = createWorkerEnvironment('real');
  delete env.Worker;
  const create = loadFactory(env, NaN, async () => { throw new Error('event loop yield unavailable'); });
  const pool = create({ maxWorkers: 1 });
  const makeSlowVector = (value) => new Proxy({ length: 100000 }, {
    get(target, key) {
      if (key === 'length') return target.length;
      if (typeof key === 'string' && /^\d+$/.test(key)) return value;
      return target[key];
    }
  });
  await assert.rejects(pool.scorePairs([[makeSlowVector(1), makeSlowVector(2)]]),
    (error) => error && error.code === 'semantic-scoring-yield-failed');
  assert.equal(pool.stats.fallbackBatches, 1);
  assert.equal(pool.stats.workerBatches, 0);
  pool.dispose();
}

async function main() {
  const testCases = [
    testExactWorkerParityAndCopiedInputs,
    testBatchLimitsDedupeAndConcurrentWorkers,
    testUnsupportedAndThrowingWorkersFallbackCooperatively,
    testCpuLimitUnknownAndSmallDevicesUseOneWorker,
    testLateResponseCannotSettleTwice,
    testDisposeRejectsActiveWaitingAndFutureCalls,
    testFailedInnerYieldRejectsInsteadOfContinuing
  ];
  for (const testCase of testCases) {
    await testCase();
    process.stdout.write(`PASS ${testCase.name}\n`);
  }
  process.stdout.write(`PASS ${testCases.length} worker-pool cases\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
