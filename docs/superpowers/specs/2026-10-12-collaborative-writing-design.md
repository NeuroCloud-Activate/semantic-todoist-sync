# Collaborative writing mode — design

Date: 2026-10-12 · Status: draft for review · Plugin: Semantic Todoist Sync 0.9.16

## Goal

Let the plugin write, not just answer. In a new sidebar **Write** mode the user gives an instruction
("answer this question", "draft the background section", "expand the selection"); the plugin gathers
evidence from the vault index plus a dedicated context folder (Word, Excel/CSV, PDF, images) and writes
professional, detailed, evidence-based prose straight into the open note, with footnote citations.

Success: the text lands at the cursor (or replaces the selection) as one undoable edit, every factual
claim carries a footnote to a real source, gaps are stated instead of invented, and nothing changes for
Chat, Tasks, Todoist sync or the vault index when Write mode is not used. Works on desktop, iPhone and iPad.

## Decisions (from planning)

| Topic | Decision |
|---|---|
| Entry point | Sidebar mode selector: **Chat / Write**. Not a separate command or modal. |
| Output | Inserted at the cursor, or replaces the selection, as a single undoable edit. |
| Citations | Markdown footnotes `[^n]` with definitions inserted right after the block. |
| Context folder | Default in-vault folder `Writing Context/` (created on first use). May be set to an absolute path outside the vault — desktop only; mobile falls back to the in-vault folder. |
| File types | `.docx`, `.xlsx`, `.csv`, `.pdf` (text layer), `.png`/`.jpg`/`.jpeg` (vision model), plus `.md`/`.txt`. |
| Context store | Separate store, only built and searched when Write mode is used. Vault index and Chat untouched. |
| Mobile | Full support. Only the outside-vault path is desktop-only. |
| Code structure | Option 1: add an esbuild build step; move today's `main.js` unchanged into `src/`; new code in small modules. |

## Phase 0 — build step (no behaviour change)

Official Obsidian installs only download `manifest.json`, `main.js`, `styles.css`, so everything must be
bundled into one `main.js`. Follow the official sample plugin.

- `package.json` with devDependencies `esbuild`, runtime deps `mammoth` and SheetJS `xlsx`
  (from the official `cdn.sheetjs.com` tarball; the npm-registry `xlsx` 0.18.x is stale and has advisories).
- `esbuild.config.mjs`: entry `src/main.js`, `bundle: true`, `format: "cjs"`, `target: "es2021"`,
  `external: ["obsidian", "electron", ...builtinModules]`, `outfile: "main.js"`, `keepNames: true`,
  `minify` only for `npm run build`; `npm run dev` watches unminified.
- `git mv main.js src/main.js` with **no edits**, then build. Built `main.js` stays committed, so the
  existing release flow and the 26 `scripts/*.js` tests (which `require("../main.js")`) keep working.
- `.gitignore` already ignores `node_modules/`.
- Acceptance: every existing `scripts/*.js` test passes against the minified build; any test that reads
  `main.js` as source text is pointed at `src/main.js` instead. Built size is reported (expected well under
  today's 3 MB even with the parsers).

From here on `src/` is the source of truth; `main.js` is build output.

## Phase 1 — context folder and separate store

New modules (each small and testable on its own):

- `src/context/extract.js` — `extractContextFile(name, bytes, deps)` → `[{ text, locator }]`.
  - `.docx`: mammoth `convertToHtml` → Obsidian `htmlToMarkdown` (keeps tables). One segment per heading.
  - `.xlsx`/`.csv`: SheetJS, one segment per sheet as a Markdown table; locator `Sheet: <name>`.
    Rows capped per sheet (2,000) with a "truncated" note.
  - `.pdf`: Obsidian `loadPdfJs()` (no bundled pdf.js), text per page; locator `p. N`.
    Pages with no text layer are skipped (no OCR in v1).
  - Images: sent to the configured primary model as an image input with "describe and transcribe any
    visible text, tables, figures". Requires a vision-capable model; on failure the file is skipped with a
    one-line reason in the scan summary. Toggle **Describe images** (on) because it costs tokens.
  - `.md`/`.txt`: read as text.
  - Parsers are required lazily inside the function, so they never run at plugin start.
- `src/context/source.js` — lists and reads files: in-vault via `vault.adapter` (`list`, `stat`,
  `readBinary`); outside-vault via Node `fs/promises`, only behind `Platform.isDesktop`. Recursive,
  files over 20 MB skipped with a notice. One file at a time (memory on iOS).
- `src/context/store.js` — the separate store. Chunks `{ id, file, locator, text, vector }` plus per-file
  `{ size, mtime }` and the embedding model id, saved as one JSON file in the plugin folder
  (`context-index.json`). `sync()` re-extracts only new/changed files, drops deleted ones, rebuilds
  everything if the embedding model changed. Embeddings reuse the plugin's existing `embedTexts()`.
  `search(query, k)` is brute-force cosine.
  `// ponytail: brute-force cosine over one JSON file; move to shards if a folder exceeds ~5k chunks.`
- Sync runs when Write mode is opened and before each Write request (stat-only when nothing changed),
  plus a **Rescan context folder** command. No file watcher.
- The context folder is excluded from the vault index (one check in `isIndexablePath`) so `.md` files
  there are not indexed twice.
- Provider layer gains image input for one call path (`describeImage(bytes, mime)`): OpenAI / OpenRouter /
  Open WebUI / custom use `image_url` data URIs, Anthropic `image` base64 source, Gemini `inline_data`.

## Phase 2 — Write mode in the sidebar

- **Mode selector** in the sidebar action row: Chat | Write, remembered in settings (`sidebarMode`).
  Write mode relabels Ask → **Write**, keeps the prompt box and the web-search toggle, and adds a length
  choice (Brief / Standard / Detailed). Chat behaviour is unchanged when Chat is selected.
- **Inputs to the model**: the instruction; the selection (if any); the note title, headings and up to
  ~6k characters around the cursor so the text fits what is already written; evidence.
- **Evidence**: vault results from the existing `retrieveSemanticContext()` plus top results from the
  context store, merged by a fixed quota (e.g. 8 + 8), each tagged with an evidence id `[E1]…`.
  `// ponytail: quota merge because the two score scales differ; calibrate if one source keeps crowding out the other.`
- **Generation**: existing `openaiResponse()` with a new `write` operation and the user's primary model.
  Prompt rules: use only supplied evidence; cite every factual claim with its `[En]` id; professional,
  detailed prose in Markdown matching the note's style; when evidence is missing, say so explicitly
  ("No evidence in the vault or context folder covers …") rather than inventing.
- **Citations**: the plugin rewrites `[En]` to `[^n]`, numbering after the highest footnote already in
  the note, and appends definitions after the block:
  vault note → `[[Note#Heading]]`; in-vault context file → `[[Writing Context/report.docx]], p. 3`;
  outside-vault file → `report.docx, Sheet: Q3` (plain text). Unknown ids are removed and counted.
- **Insertion**: at request time record the note and the cursor/selection. On completion, if that note is
  still open, one `editor.replaceRange` (single undo step); the sources used appear in the sidebar's
  relevant-notes list. If the note was closed, the draft is shown in the sidebar with an **Insert** button.
  If the user edited the note during generation, insert at the recorded position only if the text just
  before it is unchanged; otherwise insert at the current cursor and show a notice.
- **No streaming in v1.** No provider path streams today and Obsidian's `requestUrl` cannot stream;
  `fetch` streaming hits CORS on mobile for several providers. The sidebar shows "Writing…" until the
  single edit lands. Revisit if long waits are a real problem.

## Settings (new "Writing" section)

- Context folder (default `Writing Context`; absolute path allowed on desktop).
- Describe images (on).
- Everything else uses constants (20 MB cap, 2,000 rows, 8 + 8 quota) until a need appears.

## Errors

- Unreadable/oversized/unsupported files: skipped, listed in the scan summary, never block writing.
- No evidence found: the model is still called and must state the gap; the notice says so.
- Provider failure: nothing is inserted; error shown in the sidebar like Chat errors today.
- External path on mobile or missing: notice, fall back to the in-vault folder.

## Testing

New `scripts/writing-mode-local-test.js` using the existing `Module._load` obsidian mock:
- extraction: small fixture `.docx`, `.xlsx`, `.csv` → expected segments/locators; PDF via a fake
  `pdfjsLib`; image path with a stubbed provider (success and failure).
- store: incremental sync (add/change/delete), embedding-model change forces rebuild, top-k order.
- citations: `[En]` → `[^n]` continues existing numbering, unknown ids dropped, definition formats.
- insertion: replaceRange called once with the expected range; closed-note fallback.
- Phase 0 gate: all existing tests pass on the built file.
- Manual: desktop with an outside folder; iPhone/iPad with the in-vault folder.

## Out of scope (v1)

OCR for scanned PDFs, streaming output, suggestion/track-changes mode, file watching, `.pptx`,
full modularisation of the existing code (pieces move to `src/` only when touched).
