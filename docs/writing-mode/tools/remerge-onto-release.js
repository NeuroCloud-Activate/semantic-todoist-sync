#!/usr/bin/env node
/**
 * remerge-onto-release.js
 *
 * Re-runnable, deterministic rehearsal: merge the writing-workflow branch onto an
 * arbitrary release tag and prove the result. Repeat after every change.
 *
 * Usage:
 *   node docs/writing-mode/tools/remerge-onto-release.js [--tag 0.9.20] [--ours HEAD]
 *     [--workdir .superpowers/validation/merge-<tag>] [--base a62bfb4] [--keep]
 *     [--clean] [--refresh-baseline]
 *
 *   --tag               release tag to merge onto (default 0.9.20)
 *   --ours              rev to merge from (default HEAD)
 *   --workdir           merged worktree directory (default .superpowers/validation/merge-<tag>)
 *   --base              0.9.16-ish common ancestor for 3-way merge (default a62bfb4)
 *   --keep              leave worktrees in place (default)
 *   --clean             remove worktrees at the end
 *   --refresh-baseline  rebuild the pristine-release baseline cache
 *
 * Method (see .superpowers/validation/merge-0.9.20-findings.md):
 *   git's own merge fails on src/main.js because our working tree is CRLF while
 *   the base (a62bfb4:main.js) and release are LF. We therefore run a 3-way
 *   `git merge-file` on LF-normalised copies: ours = ours:src/main.js (CRLF->LF),
 *   base = base:main.js, theirs = tag:main.js. Result written to src/main.js as
 *   UTF-8 without BOM. Blobs are extracted as raw bytes (never via PowerShell '>').
 *
 * Safety:
 *   * Never touches the real branch or working tree; all work happens in isolated
 *     git worktrees under <project>/.superpowers/validation/.
 *   * Refuses to operate on any path outside <project>/.superpowers/validation/.
 *   * Node modules are linked with Windows directory junctions; junctions are
 *     removed with fs.rmdirSync/fs.unlinkSync (never recursive) so the target is
 *     never deleted.
 *
 * Exit code: 0 only when there are no regressions (tests that passed on the
 * release but fail after the merge).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const VALIDATION_ROOT = path.join(PROJECT_ROOT, '.superpowers', 'validation');

function parseArgs(argv) {
  const opts = {
    tag: '0.9.20',
    ours: 'HEAD',
    base: 'a62bfb4',
    workdir: null,
    keep: true,
    clean: false,
    refreshBaseline: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tag') opts.tag = argv[++i];
    else if (a === '--ours') opts.ours = argv[++i];
    else if (a === '--base') opts.base = argv[++i];
    else if (a === '--workdir') opts.workdir = argv[++i];
    else if (a === '--keep') opts.keep = true;
    else if (a === '--clean') opts.clean = true;
    else if (a === '--refresh-baseline') opts.refreshBaseline = true;
    else throw new Error('Unknown argument: ' + a);
  }
  if (!opts.workdir) opts.workdir = `.superpowers/validation/merge-${opts.tag}`;
  return opts;
}

function ensureInsideValidation(absPath, label) {
  const resolved = path.resolve(absPath);
  const root = path.resolve(VALIDATION_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing to touch path outside validation root (${root}): ${resolved} (${label})`);
  }
  return resolved;
}

function sh(cwd, cmd, args, opts) {
  opts = opts || {};
  const r = spawnSync(cmd, args, Object.assign({ cwd, encoding: opts.encoding || 'utf8', timeout: opts.timeout }, opts));
  if (opts.ignoreError) return r;
  if (r.error) throw r.error;
  return r;
}

function git(cwd, args, opts) {
  return sh(cwd || PROJECT_ROOT, 'git', args, opts);
}

function removeJunction(junctionPath) {
  // Never recursive: removes the junction itself only.
  try { fs.rmdirSync(junctionPath); return; } catch (e) {}
  try { fs.unlinkSync(junctionPath); return; } catch (e) {}
}

function cleanWorktreePath(absPath) {
  const nm = path.join(absPath, 'node_modules');
  if (fs.existsSync(nm)) removeJunction(nm);
  try { git(PROJECT_ROOT, ['worktree', 'remove', '--force', absPath], { ignoreError: true }); } catch (e) {}
  if (fs.existsSync(absPath)) {
    try { fs.rmSync(absPath, { recursive: true, force: true }); } catch (e) { fs.rmSync(absPath, { recursive: true, force: true }); }
  }
  git(PROJECT_ROOT, ['worktree', 'prune'], { ignoreError: true });
}

function linkNodeModules(worktreePath) {
  const link = path.join(worktreePath, 'node_modules');
  try {
    if (fs.existsSync(link)) removeJunction(link);
  } catch (e) {}
  fs.symlinkSync(path.join(PROJECT_ROOT, 'node_modules'), link, 'junction');
}

function createWorktree(absPath, rev, detached) {
  cleanWorktreePath(absPath);
  const args = ['worktree', 'add'];
  if (detached) args.push('--detach');
  args.push('--force', absPath, rev);
  const r = git(PROJECT_ROOT, args);
  if (r.status !== 0) {
    throw new Error('git worktree add failed:\n' + (r.stderr || r.stdout));
  }
  linkNodeModules(absPath);
}

function rawBlob(rev, filePath) {
  return execFileSync('git', ['show', `${rev}:${filePath}`], {
    cwd: PROJECT_ROOT,
    encoding: 'buffer',
    maxBuffer: 1 << 29,
  });
}

function isSourceReader(content) {
  return (
    /readFileSync\s*\([\s\S]*?main\.js/.test(content) ||
    /Module\._compile/.test(content) ||
    /\b(mainPath|repoMain|candidatePath|fragmentPath|mainSource)\s*=/.test(content) ||
    /HEAD:main\.js/.test(content) ||
    /candidatePath\b/.test(content) && /main\.js/.test(content)
  );
}

function repointTests(worktreePath) {
  const scriptsDir = path.join(worktreePath, 'scripts');
  const files = fs.readdirSync(scriptsDir)
    .filter((f) => f.endsWith('.js'))
    .sort();
  const changed = [];
  for (const f of files) {
    const full = path.join(scriptsDir, f);
    const content = fs.readFileSync(full, 'utf8');
    if (!/main\.js/.test(content)) continue;
    if (!isSourceReader(content)) continue;
    const lines = content.split(/\r?\n/);
    let anyChanged = false;
    const outLines = lines.map((line) => {
      if (/require\s*\(\s*[^)]*main\.js[^)]*\)/.test(line)) return line;
      // Assertions about the default runtime path (e.g. endsWith("main.js")) describe the BUILT bundle: leave them alone.
      if (/endsWith\s*\(/.test(line)) return line;
      // skip lines already migrated to src/main.js or src', 'main.js'
      const alreadySrc = /src['"]?\s*,\s*['"]main\.js['"]|['"]src\/main\.js['"]|['"]src\\main\.js['"]/.test(line);
      const isPropKey = /['"]main\.js['"]\s*:/.test(line);
      let newline = line;
      if (!alreadySrc && !isPropKey) {
        newline = newline.replace(/"main\.js"/g, '"src/main.js"');
        newline = newline.replace(/'main\.js'/g, "'src/main.js'");
      }
      newline = newline.replace(/HEAD:main\.js/g, 'HEAD:src/main.js');
      if (newline !== line) anyChanged = true;
      return newline;
    });
    if (anyChanged) {
      fs.writeFileSync(full, outLines.join('\n'), 'utf8');
      changed.push(f);
    }
  }
  return changed;
}

function runTests(worktreePath) {
  const scriptsDir = path.join(worktreePath, 'scripts');
  const files = fs.readdirSync(scriptsDir)
    .filter((f) => f.endsWith('-test.js'))
    .sort();
  const results = [];
  for (const f of files) {
    const scriptPath = path.join(scriptsDir, f);
    const r = sh(worktreePath, process.execPath, [scriptPath], { timeout: 120000, ignoreError: true });
    const status = (r.status === 0) ? 'PASS' : 'FAIL';
    results.push({ file: f, status, code: r.status });
  }
  return results;
}

function writeResults(filePath, results) {
  const text = results.map((r) => `${r.status} ${r.file}`).join('\n') + '\n';
  fs.writeFileSync(filePath, text, 'utf8');
}

function parseResultsFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const map = new Map();
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^(PASS|FAIL)\s+(.+)$/);
    if (m) map.set(m[2].trim(), m[1]);
  }
  return map;
}

function countPassFail(results) {
  let pass = 0, fail = 0;
  for (const r of results) { if (r.status === 'PASS') pass++; else fail++; }
  return { pass, fail };
}

function countEmoji(text) {
  // U+1F4C5
  let n = 0;
  for (const ch of text) if (ch.codePointAt(0) === 0x1F4C5) n++;
  return n;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const workdirAbs = ensureInsideValidation(
    path.isAbsolute(opts.workdir) ? opts.workdir : path.join(PROJECT_ROOT, opts.workdir),
    'workdir'
  );
  const baseWorkdirAbs = ensureInsideValidation(
    path.join(VALIDATION_ROOT, `base-${opts.tag}`),
    'base workdir'
  );

  // Merged worktree: recreate.
  console.log(`[remerge] project root: ${PROJECT_ROOT}`);
  console.log(`[remerge] tag: ${opts.tag}  ours: ${opts.ours}  base: ${opts.base}`);
  console.log(`[remerge] merged worktree: ${workdirAbs}`);
  createWorktree(workdirAbs, opts.ours, true);

  // Step 2: non-source files from release via git merge --no-commit.
  const mergeR = git(workdirAbs, ['merge', '--no-commit', '--no-ff', opts.tag], { ignoreError: true });
  // Expected to possibly exit non-zero due to main.js conflict; that's fine.
  if (mergeR.status !== 0 && mergeR.status !== 1) {
    console.warn('[remerge] git merge returned non-zero (may be okay):');
    console.warn((mergeR.stderr || mergeR.stdout || '').trim());
  }
  // Resolve main.js conflict by taking release's version temporarily (built output later).
  git(workdirAbs, ['checkout', '--theirs', '--', 'main.js'], { ignoreError: true });

  // Step 3: 3-way merge-file on LF-normalised copies.
  const oursBuf = rawBlob(opts.ours, 'src/main.js');
  const baseBuf = rawBlob(opts.base, 'main.js');
  const theirsBuf = rawBlob(opts.tag, 'main.js');
  let oursText = oursBuf.toString('utf8').replace(/\r\n/g, '\n');
  const baseText = baseBuf.toString('utf8').replace(/\r\n/g, '\n');
  const theirsText = theirsBuf.toString('utf8').replace(/\r\n/g, '\n');

  const oursFile = path.join(workdirAbs, 'ours-lf.js');
  const baseFile = path.join(workdirAbs, 'base-lf.js');
  const theirsFile = path.join(workdirAbs, 'theirs-lf.js');
  fs.writeFileSync(oursFile, oursText, 'utf8');
  fs.writeFileSync(baseFile, baseText, 'utf8');
  fs.writeFileSync(theirsFile, theirsText, 'utf8');

  const mf = spawnSync('git', ['merge-file', oursFile, baseFile, theirsFile], {
    cwd: workdirAbs, encoding: 'utf8', timeout: 300000,
  });
  if (mf.status !== 0) {
    const conflictDest = path.join(workdirAbs, 'CONFLICT-main.js');
    try { fs.copyFileSync(oursFile, conflictDest); } catch (e) {}
    console.error(`[remerge] ABORT: git merge-file conflicts (exit ${mf.status}).`);
    console.error('[remerge] conflict-marker file written to: ' + conflictDest);
    console.error((mf.stderr || mf.stdout || '').trim());
    process.exit(2);
  }
  const mergedText = fs.readFileSync(oursFile, 'utf8');
  const firstBytes = Buffer.from(mergedText.slice(0, 4), 'utf8');
  if (!(firstBytes[0] === 99 && firstBytes[1] === 111 && firstBytes[2] === 110 && firstBytes[3] === 115)) {
    console.error('[remerge] ABORT: merged src/main.js does not start with "cons" (bad encoding?). bytes=' + Array.from(firstBytes).join(','));
    process.exit(2);
  }
  const mergedEmoji = countEmoji(mergedText);
  const theirsEmoji = countEmoji(theirsText);
  if (mergedEmoji !== theirsEmoji) {
    console.error(`[remerge] ABORT: calendar emoji count mismatch merged=${mergedEmoji} release=${theirsEmoji}`);
    process.exit(2);
  }
  fs.writeFileSync(path.join(workdirAbs, 'src', 'main.js'), mergedText, 'utf8');
  console.log(`[remerge] 3-way merge clean. emoji=${mergedEmoji} firstBytes=cons`);

  // Step 4: repoint tests.
  const changedTests = repointTests(workdirAbs);
  console.log('[remerge] repointed tests (' + changedTests.length + '):');
  for (const f of changedTests) console.log('  ' + f);

  // Step 5: build.
  console.log('[remerge] building...');
  // Same as `npm run build`; spawning npm.cmd without a shell fails (EINVAL) on current Node for Windows.
const buildR = sh(workdirAbs, process.execPath, ['esbuild.config.mjs', 'production'], { timeout: 590000, ignoreError: true });
  if (buildR.status !== 0) {
    console.error('[remerge] build FAILED:');
    console.error((buildR.stderr || buildR.stdout || '').slice(-4000));
    process.exit(3);
  }
  console.log('[remerge] build OK');

  // Baseline: cache results file.
  const baselineFile = path.join(VALIDATION_ROOT, `results-${opts.tag}-baseline.txt`);
  let baselineMap = null;
  if (fs.existsSync(baselineFile) && !opts.refreshBaseline) {
    baselineMap = parseResultsFile(baselineFile);
    console.log('[remerge] using cached baseline: ' + baselineFile);
  } else {
    console.log('[remerge] building pristine baseline worktree...');
    createWorktree(baseWorkdirAbs, opts.tag, true);
    const baseResults = runTests(baseWorkdirAbs);
    writeResults(baselineFile, baseResults);
    baselineMap = parseResultsFile(baselineFile);
    console.log('[remerge] cached baseline: ' + baselineFile);
    if (opts.clean) {
      cleanWorktreePath(baseWorkdirAbs);
    }
  }

  // Run merged suite.
  console.log('[remerge] running merged test suite...');
  const mergedResults = runTests(workdirAbs);
  const mergedFile = path.join(VALIDATION_ROOT, `results-merged-${opts.tag}.txt`);
  writeResults(mergedFile, mergedResults);
  console.log('[remerge] merged results: ' + mergedFile);

  // Comparison.
  const baselineStatus = (name) => (baselineMap ? baselineMap.get(name) : undefined);
  const regressions = [];
  const preexisting = [];
  const newTests = [];
  for (const r of mergedResults) {
    const b = baselineStatus(r.file);
    if (b === undefined) {
      newTests.push(r.file + ' (' + r.status + ')');
    } else {
      if (b === 'PASS' && r.status === 'FAIL') regressions.push(r.file);
      if (b === 'FAIL' && r.status === 'FAIL') preexisting.push(r.file);
    }
  }
  const bc = baselineMap ? (() => {
    let p = 0, f = 0;
    for (const v of baselineMap.values()) { if (v === 'PASS') p++; else f++; }
    return { pass: p, fail: f };
  })() : null;
  const mc = countPassFail(mergedResults);

  console.log('');
  console.log('=== Comparison ===');
  if (bc) console.log(`Baseline (${opts.tag}): ${bc.pass} pass, ${bc.fail} fail`);
  console.log(`Merged (${opts.tag}):   ${mc.pass} pass, ${mc.fail} fail`);
  console.log(`Regressions (pass->fail): ${regressions.length}`);
  regressions.forEach((t) => console.log('  REGRESSION: ' + t));
  console.log(`Pre-existing (fail in both): ${preexisting.length}`);
  preexisting.forEach((t) => console.log('  preexisting: ' + t));
  console.log(`New in merged: ${newTests.length}`);
  newTests.forEach((t) => console.log('  new: ' + t));

  // METRICS
  const mergedMainJs = path.join(workdirAbs, 'main.js');
  const mergedMainSize = fs.statSync(mergedMainJs).size;
  const srcMainContent = fs.readFileSync(path.join(workdirAbs, 'src', 'main.js'), 'utf8');
  const tagCount = (srcMainContent.match(/\/\/\s*writing-mode:/g) || []).length;
  const ledgerPath = path.join(PROJECT_ROOT, 'docs', 'writing-mode', 'MERGE-LEDGER.md');
  const ledgerContent = fs.readFileSync(ledgerPath, 'utf8');
  const rowRegex = /^\|\s*\d+\s*\|/gm;
  const rowCount = (ledgerContent.match(rowRegex) || []).length;
  console.log('');
  console.log('=== Metrics ===');
  console.log(`merged built main.js size: ${mergedMainSize} bytes`);
  console.log(`// writing-mode: tags in merged src/main.js: ${tagCount}`);
  console.log(`MERGE-LEDGER rows (| <digits> |): ${rowCount}`);
  if (tagCount !== rowCount) {
    console.warn(`[remerge] WARN: tag count (${tagCount}) != ledger row count (${rowCount})`);
  }

  if (opts.clean) {
    cleanWorktreePath(workdirAbs);
    // Keep base cache already written; remove base if requested too.
    // Default --clean removes merged only? spec: add --clean to remove (worktrees). Remove both.
    cleanWorktreePath(baseWorkdirAbs);
    console.log('[remerge] cleaned worktrees');
  } else {
    console.log('[remerge] keeping worktrees (use --clean to remove)');
  }

  if (regressions.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();