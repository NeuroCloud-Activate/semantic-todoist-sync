'use strict';

/*
 * stable-core-characterization-local-test.js
 *
 * Deterministic, self-contained characterization harness for the 0.7.19 stable
 * core of the semantic-todoist-sync plugin.
 *
 * Purpose:
 *   - Establishes a RED baseline against a corrupted/changed core (fails on the
 *     authoritative SHA-256 gates), then verifies a restored 0.7.19 core is
 *     byte-identical to the canonical published release and statically healthy.
 *
 * Design constraints (per task):
 *   - Deterministic: no network, no external deps, no randomness/timing.
 *   - Node built-ins only (fs, crypto, vm, path).
 *   - Static only: main.js is an Obsidian plugin bundle that requires the
 *     Obsidian runtime; it must NOT be executed. Syntax is validated by static
 *     compilation (vm.Script), which parses without running.
 *   - Run from the repo root:
 *         node scripts/stable-core-characterization-local-test.js
 *
 * Exit code: 0 when ALL checks pass (known-good stable 0.7.19 core), 1 on any
 * failure. Output is plain-text PASS/FAIL per check (no TDD framework needed).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

// Canonical known-good 0.7.19 published-release artifacts (SHA-256).
// These are the authoritative acceptance gates (the stable core signature).
const TARGETS = {
  'main.js': '2758fc7bc51c5c504644606f30b55e753c73b509ca835c87de69aca996ce98f3',
  'styles.css': '8afc25ecac104c8b627a61034d663f38345f9d777e5c9b95b6e4649fd2b9c279',
};

// Stable-surface markers a genuine 0.7.19 Obsidian plugin bundle must contain.
// (Used as a corruption/identity sanity gate, NOT the primary discriminator.)
const STABLE_SURFACE_MARKERS = [
  'obsidian', // runtime import specifier present in every plugin bundle
  'semantic-todoist-sync', // plugin id embedded in the bundle
];

const REPO_ROOT = path.resolve(__dirname, '..');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readBuffer(rel) {
  const abs = path.join(REPO_ROOT, rel);
  const stat = fs.statSync(abs); // throws if missing -> surfaced as a failed check
  return { abs, buf: fs.readFileSync(abs), size: stat.size };
}

// A tiny structural well-formedness check for CSS: non-empty and brace-balanced
// without embedded NUL bytes. Purely a corruption guard, not a content assertion.
function cssWellFormed(text) {
  if (text.length === 0) return false;
  if (text.indexOf('\0') !== -1) return false;
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

// Static syntax check: compile main.js as a script without executing it.
function mainSyntaxValid(buf) {
  try {
    // eslint-disable-next-line no-new
    new vm.Script(buf, { filename: 'main.js' });
    return true;
  } catch (_e) {
    return false;
  }
}

function main() {
  const checks = [];
  const push = (name, ok, detail) =>
    checks.push({ name, ok, detail: detail || '' });

  for (const [file, target] of Object.entries(TARGETS)) {
    try {
      const { abs, buf, size } = readBuffer(file);
      const actual = sha256(buf);
      const ok = actual.toLowerCase() === target;
      push(
        `hash:${file}`,
        ok,
        `${ok ? 'ok' : 'MISMATCH'}  sha256=${actual}  size=${size}B  (target=${target})`,
      );
    } catch (e) {
      push(`hash:${file}`, false, `${e.message} (file missing/unreadable)`);
    }
  }

  // main.js: static health / stable-surface characterization (no execution).
  try {
    const { buf } = readBuffer('main.js');
    push('syntax:main.js', mainSyntaxValid(buf), buf.length > 0 ? `compiled ${buf.length}B` : 'empty');

    const text = Buffer.from(buf, 'utf8').toString('utf8');
    const present = STABLE_SURFACE_MARKERS.filter((m) => text.includes(m));
    const missing = STABLE_SURFACE_MARKERS.filter((m) => !text.includes(m));
    push(
      'surface:main.js',
      missing.length === 0,
      present.length ? `markers=${present.join(',')}` : `missing=${missing.join(',')}`,
    );
  } catch (_e) {
    // readBuffer failure already recorded under hash:main.js
  }

  // styles.css: well-formedness guard.
  try {
    const { buf } = readBuffer('styles.css');
    push('format:styles.css', cssWellFormed(buf.toString('utf8')), `len=${buf.length}B`);
  } catch (_e) {
    // readBuffer failure already recorded under hash:styles.css
  }

  let failed = 0;
  for (const c of checks) {
    const icon = c.ok ? 'PASS' : 'FAIL';
    failed += c.ok ? 0 : 1;
    console.log(`${icon}  ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);
  }

  console.log(
    `\n${failed === 0 ? 'OK' : 'BROKEN'}  ${checks.length - failed}/${checks.length} checks passed`,
  );
  return failed === 0 ? 0 : 1;
}

process.exit(main());
