# Collaborative Writing Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sidebar Write mode that drafts cited, evidence-based prose into the open note, using the vault index plus a separate context-folder store (docx, xlsx/csv, pdf, images).

**Architecture:** Introduce an esbuild build: `src/main.js` (today's `main.js`, moved unchanged) bundles to the committed `main.js`. New behaviour lives in small CommonJS modules under `src/context/` and `src/writing/`; `src/main.js` gets only thin, marked hook edits, each recorded in a merge ledger.

**Tech Stack:** Node 26 / npm 11 (use `npm.cmd` in PowerShell), esbuild 0.28, mammoth, SheetJS `xlsx` (cdn.sheetjs.com tarball), Obsidian `loadPdfJs()`, existing `Module._load` obsidian mock test pattern.

**Spec:** `docs/superpowers/specs/2026-10-12-collaborative-writing-design.md`

## Global Constraints

- Branch `writing-workflow` only; nothing merges to `main` until validated. Commit per task.
- Mobile stays supported (`isDesktopOnly: false`). Node `fs`/`path` only behind `Platform.isDesktop` and required lazily inside the function that uses them.
- Release ships only `manifest.json`, `main.js`, `styles.css`; all code bundled into `main.js`. No remote code.
- Parsers (`mammoth`, `xlsx`) are `require`d lazily inside extraction functions, never at module top level.
- PDF via `loadPdfJs()` from `obsidian`; do not add pdf.js.
- Constants, not settings: file cap 20 MB, 2,000 rows per sheet, evidence quota 8 vault + 8 context, ~6,000 chars note context.
- New settings only: `writingContextFolder` (default `"Writing Context"`), `writingDescribeImages` (default `true`), `sidebarMode` (`"chat"` | `"write"`, default `"chat"`).
- Chat, Tasks, Todoist sync and the vault index behave identically when Write mode is unused.

## Merge tracking (applies to every task)

`main` keeps evolving the single-file `main.js`; this branch moves it. To keep merges tractable:

- Task 1 does the move as its **own commit** containing only `git mv main.js src/main.js` (100% similarity) so git follows the rename when merging `main` into this branch.
- Every edit to `src/main.js` after that is (a) as small as possible, (b) tagged with a `// writing-mode:` comment on the edited line or block, and (c) appended to `docs/writing-mode/MERGE-LEDGER.md` as a row: task, symbol/function, what changed, why. Verification at each task: `Select-String src/main.js -Pattern "writing-mode:"` count equals ledger row count.
- Built `main.js` is never hand-edited or hand-merged: on any conflict in it, resolve `src/` and run `npm.cmd run build`. Ledger records this rule.
- The ledger also lists every new file under `src/` and every changed test script.

## Review Focus

1. User keeps typing while the model writes → text must not land mid-word in the wrong place (Task 6 test: changed prefix → insert at current cursor + notice).
2. Note already has footnotes `[^1]…[^7]` or named `[^ref]` → new numbering continues at 8, never collides (Task 6 test).
3. Context file names with spaces, `#`, `|`, `[`/`]` → footnote link still valid (Task 6 test: falls back to plain-text name when the name has `|`, `[`, `]`, `#`).
4. Embedding model changed or no embedding access → store rebuild, or a clear "embedding access unavailable" error, never mixed-dimension vectors (Task 4 tests).
5. Outside-vault path configured and opened on mobile / path missing → falls back to in-vault folder with a notice, writing still works (Task 3 test).

---

### Task 1: Build step and rename (no behaviour change)

**Files:**
- Move: `main.js` → `src/main.js` (own commit, no edits)
- Create: `package.json`, `package-lock.json`, `esbuild.config.mjs`, `docs/writing-mode/MERGE-LEDGER.md`
- Modify: `.gitignore` (remove `package.json`, `package-lock.json` lines), `scripts/provider-settings-local-test.js:89`, `scripts/semantic-score-worker-pool-test.js:9` (read `src/main.js` instead of `main.js` — they inspect source text)
- Build output: `main.js`

**Interfaces:**
- Produces: `npm.cmd run build` → `main.js` (CJS, `module.exports` = plugin class plus existing named exports); `npm.cmd test` runs every `scripts/*-test.js` against built `main.js`.

- [ ] **Step 1:** Baseline: run every `scripts/*test*.js` with `node` on the untouched tree; save pass/fail list to `docs/writing-mode/baseline-tests.txt`. Expected: record actual result (do not fix pre-existing failures; note them in the ledger).
- [ ] **Step 2:** `git mv main.js src/main.js`; commit `refactor: move main.js to src/main.js (rename only)`. Verify `git show --stat HEAD` shows `main.js => src/main.js` with no line changes.
- [ ] **Step 3:** `package.json`: `"private": true`, scripts `build` (`node esbuild.config.mjs production`), `dev` (`node esbuild.config.mjs`), `test` (node script or one-liner that runs each `scripts/*-test.js` and fails on any non-zero exit). devDependency `esbuild@0.28.x`.
- [ ] **Step 4:** `esbuild.config.mjs` per official sample: entry `src/main.js`, `bundle`, `format: "cjs"`, `target: "es2021"`, `platform: "browser"`, `external: ["obsidian", "electron", ...builtinModules]`, `outfile: "main.js"`, `logLevel: "info"`. Production sets `minifyWhitespace: true, minifySyntax: true` (**not** `minifyIdentifiers`/`keepNames`: `makeWorkerSource()` at src/main.js ~51180 serialises `cosine.toString()` into a worker). Dev: watch, no minify, inline sourcemap.
- [ ] **Step 5:** Repoint the two source-reading tests to `src/main.js`; `npm.cmd install`; `npm.cmd run build`.
- [ ] **Step 6:** Run `npm.cmd test`. Expected: identical pass/fail list to the baseline. Also `node -e "const m=require('./main.js'); console.log(typeof m)"` with the obsidian mock from `scripts/web-research-local-test.js` → `function`. Record built size vs 3,152,600 bytes in the ledger.
- [ ] **Step 7:** Create the ledger with sections: Rules, `src/main.js` edits (empty table), New files, Test changes, Baseline. Commit `build: esbuild bundle from src/, merge ledger`.

### Task 2: Context file extraction

**Files:**
- Create: `src/context/extract.js`, `scripts/writing-extract-test.js`
- Modify: `package.json` (deps `mammoth`, `xlsx` from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` or current latest there)

**Interfaces:**
- Produces: `async extractContextFile(name: string, bytes: ArrayBuffer, deps: { htmlToMarkdown(html): string, loadPdfJs(): Promise<pdfjsLib>, describeImage?(bytes, mime): Promise<string> }) → Array<{ text: string, locator: string }>`; `CONTEXT_EXTENSIONS` = `["md","txt","docx","xlsx","csv","pdf","png","jpg","jpeg"]`; throws `Error` with `code: "unsupported-type"` for others.

- [ ] **Step 1: failing tests** (fixtures built in-test: docx via `jszip` (mammoth dependency) with a minimal `word/document.xml` containing a heading, a paragraph and a 2×2 table; xlsx via SheetJS `write`):
  - docx → segments split per heading; table survives as a Markdown table (`| a | b |`); locator = heading text (`""` before first heading).
  - xlsx with sheets `Q3`, `Q4` → two segments, locator `Sheet: Q3`, Markdown table; 2,500-row sheet → 2,000 rows + line `(truncated: 500 more rows)`.
  - csv → one segment, locator `Sheet: 1`.
  - pdf with fake `pdfjsLib` (2 pages; page 2 empty text) → one segment, locator `p. 1`.
  - png with `describeImage` stub → one segment `locator: "image"`; png without `describeImage` → `[]`.
  - `.pptx` → rejects with `code === "unsupported-type"`.
- [ ] **Step 2:** Run `node scripts/writing-extract-test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement. mammoth `convertToHtml({ arrayBuffer })` → `deps.htmlToMarkdown`; split on Markdown headings. SheetJS `read(bytes, { type: "array" })`, `sheet_to_json(ws, { header: 1 })` → pipe table, escape `|`. PDF `getDocument({ data }).promise`, `page.getTextContent()` items joined with spaces.
- [ ] **Step 4:** Test → PASS; `npm.cmd test` → baseline unchanged; `npm.cmd run build` succeeds.
- [ ] **Step 5:** Ledger "New files"; commit `feat(context): extract docx/xlsx/csv/pdf/image text`.

### Task 3: Context folder source

**Files:**
- Create: `src/context/source.js`, `scripts/writing-source-test.js`

**Interfaces:**
- Produces: `resolveContextRoot(app, settings, platform) → { kind: "vault" | "external", root: string, notice?: string }` (absolute path → external only if `platform.isDesktop`; otherwise vault folder `"Writing Context"` with `notice`); `async listContextFiles(rootInfo, app) → Array<{ id: string, name: string, size: number, mtime: number }>` (recursive, `CONTEXT_EXTENSIONS` only, `id` = vault path or absolute path); `async readContextFile(rootInfo, app, id) → ArrayBuffer`; `async ensureVaultContextFolder(app, folder)`.

- [ ] **Step 1: failing tests** with a fake `app.vault.adapter` (`list`, `stat`, `readBinary`, `exists`, `mkdir`) and a temp dir for external:
  - vault mode lists nested files, filters `.exe`, returns size/mtime.
  - external mode on desktop lists files from a real temp dir via `fs`.
  - absolute path with `isDesktop: false` → `kind: "vault"`, `notice` mentions mobile. Missing external dir → `kind: "vault"` + notice.
  - files > 20 MB are returned with `skipped: "too-large"` and are not readable through `readContextFile`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; `require("fs/promises")` / `require("path")` only inside external branches.
- [ ] **Step 4:** Run → PASS; `npm.cmd test` baseline unchanged.
- [ ] **Step 5:** Ledger; commit `feat(context): vault and desktop external folder source`.

### Task 4: Context store

**Files:**
- Create: `src/context/store.js`, `scripts/writing-store-test.js`

**Interfaces:**
- Consumes: Task 2 `extractContextFile`, Task 3 `listContextFiles`/`readContextFile`.
- Produces: `class ContextStore { constructor({ adapter, path, embed: (texts) => Promise<number[][]>, embeddingKey: string, extractDeps }); async load(); async sync(rootInfo, app) → { added, changed, removed, skipped: Array<{ id, reason }> }; search(queryVector: number[], k: number) → Array<{ id, file, locator, text, score }>; async save() }`. Persisted at `<pluginDir>/context-index.json` as `{ version: 1, embeddingKey, files: { [id]: { size, mtime } }, chunks: [{ id, file, locator, text, vector }] }`.

- [ ] **Step 1: failing tests** with in-memory adapter and deterministic fake `embed`:
  - first sync adds all; second sync with unchanged stat → `added/changed/removed` all 0 and `embed` not called.
  - changed mtime re-extracts only that file; deleted file's chunks removed.
  - different `embeddingKey` on load → full rebuild (no mixed vectors).
  - `embed` rejecting with `code: "embedding-access-unavailable"` → `sync` rejects with that code and existing store is untouched on disk.
  - extraction error for one file → listed in `skipped`, others still indexed.
  - `search` returns top-k by cosine, descending.
  - segments longer than ~1,500 chars are split into chunks with the same locator.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (`// ponytail: brute-force cosine over one JSON file; shard if a folder exceeds ~5k chunks.`). Reuse the existing cosine helper only if exported from `src/main.js`; otherwise local 5-line cosine.
- [ ] **Step 4:** PASS; baseline unchanged. **Step 5:** Ledger; commit `feat(context): separate embedded context store`.

### Task 5: Image description through the configured provider

**Files:**
- Modify: `src/main.js` near `openaiResponse()` (~13869) and its provider-specific request builders — add image-input support for one call path. Tag `// writing-mode:`.
- Create: `scripts/writing-vision-test.js`

**Interfaces:**
- Produces: plugin method `async describeImage(bytes: ArrayBuffer, mime: string) → string` using the primary model. Request shapes: OpenAI-compatible / OpenRouter / Open WebUI / custom → `{ type: "image_url", image_url: { url: "data:<mime>;base64,..." } }`; OpenAI Responses API → `{ type: "input_image", image_url: "data:..." }` if that path is used; Anthropic → `{ type: "image", source: { type: "base64", media_type, data } }`; Gemini → `{ inline_data: { mime_type, data } }`. Text instruction fixed: `"Describe this image for use as research evidence. Transcribe all visible text, tables and figure labels verbatim; then summarise what it shows."`

- [ ] **Step 1: failing test:** stub `requestUrl`, one case per provider kind, assert request body contains the shape above and the returned string is the model text; provider error → rejects (caller skips the file).
- [ ] **Step 2:** FAIL. **Step 3:** Implement by reusing each provider's existing auth/URL/response parsing; add the image part only when an `images` option is passed, so all existing calls are byte-identical.
- [ ] **Step 4:** PASS; `npm.cmd test` baseline unchanged (proves text calls unchanged). **Step 5:** Ledger rows; commit `feat(providers): image input for describeImage`.

### Task 6: Citations and insertion helpers

**Files:**
- Create: `src/writing/citations.js`, `src/writing/insert.js`, `scripts/writing-citations-test.js`

**Interfaces:**
- Produces: `rewriteCitations(markdown: string, evidence: Array<{ eid: string, source: { kind: "vault", path, heading? } | { kind: "context-vault", path, locator } | { kind: "context-external", name, locator } }>, noteText: string) → { markdown: string, footnotes: string, used: string[], dropped: number }`; `planInsertion(editor, recorded: { path, from, to, prefix: string }, currentPath: string) → { mode: "recorded" | "cursor" | "closed", from, to, notice?: string }`; `insertDraft(editor, plan, text)` = one `editor.replaceRange` call.

- [ ] **Step 1: failing tests:**
  - `[E2]` and `[E2, E5]` → `[^n]` markers; repeated evidence reuses its number; unknown `[E9]` removed, `dropped === 1`.
  - noteText containing `[^1]..[^7]` and `[^ref]` → first new footnote is `[^8]`.
  - definitions: vault `[[Folder/Note#Heading]]`; context-vault `[[Writing Context/report.docx]], p. 3`; external `report.docx, Sheet: Q3`; a name containing `|`, `[`, `]` or `#` → plain text, no wikilink.
  - `planInsertion`: same path + 40-char prefix unchanged → `recorded`; prefix changed → `cursor` with notice; other note active → `closed`.
  - `insertDraft` calls `replaceRange` exactly once with body + `\n\n` + footnotes.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (pure functions, no obsidian import). **Step 4:** PASS. **Step 5:** Ledger; commit `feat(writing): footnote citations and safe insertion`.

### Task 7: Write orchestrator

**Files:**
- Create: `src/writing/write.js`, `scripts/writing-write-test.js`
- Modify: `src/main.js` — plugin gets `contextStore` (lazy), `async writeWithEvidence(instruction, options)` delegating to `src/writing/write.js`, a `rescanContextFolder()` method, command `semantic-todoist-rescan-context` ("Rescan writing context folder"), and the context folder excluded in `isIndexablePath()` (~9164). All tagged.

**Interfaces:**
- Consumes: Tasks 2–6; plugin `retrieveSemanticContext(query, limit)` (~10159), `embedTexts()` (~10272), `openaiResponse()` (~13869), `getActiveMarkdownContext()` (~8878).
- Produces: `async writeWithEvidence(plugin, { instruction, length: "brief"|"standard"|"detailed", active: { path, text, selection, cursorOffset }, webSearchMode }) → { markdown: string, footnotes: string, sources: Array<{ eid, label, path? }>, evidenceCount: number, dropped: number }`.

- [ ] **Step 1: failing tests** with stubbed plugin methods:
  - merges 8 vault + 8 context results with ids `E1..E16`; vault-only when store empty.
  - store sync is called before retrieval; sync failure for embeddings → error surfaces; per-file skips do not.
  - prompt (captured from the stub) contains the instruction, the selection, ≤6,000 chars of note context around the cursor, every evidence id, and the rules: only supplied evidence, cite every factual claim with `[En]`, state missing evidence explicitly.
  - zero evidence → model still called, prompt says no evidence was found.
  - result passes through `rewriteCitations`.
  - `isIndexablePath("Writing Context/a.md")` → false; other paths unchanged.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; model operation id `"write"` mapped to the primary chat model the same way `"chat-query"` is. Length → target words: brief 150–250, standard 400–700, detailed 900–1,500.
- [ ] **Step 4:** PASS; baseline unchanged. **Step 5:** Ledger rows; commit `feat(writing): evidence-based write orchestrator`.

### Task 8: Sidebar Write mode and settings

**Files:**
- Modify: `src/main.js` — `DEFAULT_SETTINGS` (~3389) three new keys and their normalisation in `normalizeStableSettings()` (~2786); `SemanticTodoistView.render()` (~21508) mode selector in `actionRow` + length select; `ask()` (~21622) branches to a new `write()` when `sidebarMode === "write"`; settings tab (~22030) "Writing" section (folder, describe images). Tagged.
- Modify: `styles.css` (selector spacing only if needed)
- Create: `scripts/writing-sidebar-test.js`

**Interfaces:**
- Consumes: Task 7 `plugin.writeWithEvidence`, Task 6 `planInsertion`/`insertDraft`.

- [ ] **Step 1: failing tests** (view built with the existing obsidian mock):
  - default `sidebarMode` is `"chat"`; `ask()` in chat mode calls `plugin.chat` exactly as before.
  - switching to Write persists `sidebarMode`, relabels the button "Write", shows the length select.
  - `write()` records cursor/selection before awaiting, calls `writeWithEvidence`, then `insertDraft` once; sources rendered via `renderRelevantNotes`.
  - closed note → draft shown in sidebar with an Insert button; error → nothing inserted, error shown.
  - settings normalisation keeps the three keys and defaults invalid values; `scripts/settings-migration-local-test.js` still passes.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. Status text "Writing…" while waiting. **Step 4:** PASS; `npm.cmd test` baseline unchanged; `npm.cmd run build`.
- [ ] **Step 5:** Ledger rows; commit `feat(writing): sidebar Write mode and settings`.

### Task 9: Validation gate

- [ ] `npm.cmd run build`; `npm.cmd test` → all new tests pass, existing results match baseline.
- [ ] Ledger check: `writing-mode:` tag count in `src/main.js` == ledger rows; `git diff main --stat` reviewed; built size recorded.
- [ ] Merge rehearsal: `git merge-tree --write-tree main HEAD` (no working-tree change) and record whether `src/main.js` follows the rename cleanly.
- [ ] Manual checklist (user, scratch vault): desktop with outside folder (docx, xlsx, pdf, png); iPhone/iPad with in-vault folder; undo removes the whole draft; Chat unchanged.
- [ ] Commit ledger updates `docs: writing-mode validation evidence`.
