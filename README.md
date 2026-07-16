# Semantic Todoist Sync

Semantic Todoist Sync is for people who live in Obsidian, but still need their actual action items to land in Todoist.

It builds a local semantic index of your vault, uses your own AI API key to understand note context, turns notes or forwarded emails into Todoist-ready tasks, writes those tasks back into Obsidian for traceability, and keeps the two sides synced. It can also preview a practical workday schedule from your Todoist tasks. The plugin keeps local Todoist and scheduler memory files so it can answer questions about existing tasks, plan from prior scheduling choices, and avoid pestering external APIs more than it needs to.

> **AI vibecoded project:** This plugin was built collaboratively with AI using OpenAI Codex. Please review the code, security model, and workflow assumptions before using it with vault content, emails, or Todoist data you care about.

## What It Does

1. **Semantic vault search and question-answering**

   Ask questions across your vault using ranked note context. The plugin can also pull in compact task references from its local Todoist table, so answers can point to tasks you already created instead of pretending they do not exist.

2. **Notes-To-Todoist**

   Turn meeting notes, project notes, or selected text into main tasks and subtasks. The tasks are inserted back into the note with Semantic Todoist Sync markers, then synced to Todoist with local OIDs so later updates can be reconciled.

3. **Email-To-Todoist**

   Forward task-heavy emails into a user-owned Cloudflare Worker queue. The plugin can pull them into Obsidian, use AI plus vault context to identify the real tasks, write a note log, and sync the tasks into Todoist.

4. **Schedule Today's Tasks**

   Build a preview of today's work from overdue tasks and tasks due soon. The preview keeps existing Todoist times fixed, estimates missing durations, lets you adjust or swap tasks before applying, and writes only the approved due times and durations back to Todoist.

## What's New In 0.7.3

1. **0.7.3 - Correct Obsidian release packaging**

   The 0.7.2 code is republished with version-matched GitHub Release packaging and verified `main.js`, `manifest.json`, and `styles.css` assets. No runtime behavior changed.

2. **0.7.2 - Faster, clearer, and fingerprint-aligned local workflows**

   Device-local display times now stay consistent across task, scheduler, and
   activity views. Desktop and mobile settings are organized into six focused
   groups, while plugin-defined email, chat, and context character caps are
   removed without relaxing bounded resource, provider, or Todoist-field limits.
   Task-reference snapshot writes now align the compatible semantic index with
   exact payload fingerprints, reuse unchanged embeddings, and recover promptly
   after startup without rebuilding every vault note. Shared evidence reduces
   repeated context serialization, and GPT-5.6 Terra at Medium remains the
   primary OpenAI model with GPT-5.6 Luna at Medium as the same-provider fallback.

3. **0.7.1 - Semantic Index Optimization**

   The task-generation backend has been redesigned around the semantic index so
   task titles and descriptions are selected from precise, source-grounded
   meaning instead of depending on lexical heuristics that could confuse shared
   words with shared intent. The current source remains authoritative while
   relevant task history, open-work continuity, recency, and supporting evidence
   stay connected through exact stable IDs. Complete task-local evidence remains
   available across generation phases without stale context overriding newer
   direction, unrelated matches leaking into descriptions, or a global record
   cap discarding useful context.

   The same redesign improves precision throughout duplicate detection,
   same-title subtask reconciliation, task-local failure handling, citations,
   and repeated semantic retrieval. Evidence is serialized once and reused by
   stable ID, reducing estimated task-generation input by 51.7% and description
   input by about 60.0% in a six-task live-vault A/B while retaining complete
   source grounding. This release also introduces GPT-5.6 Terra at Medium as the
   default OpenAI model, with GPT-5.6 Luna at Medium as its same-provider
   fallback, while preserving custom model and reasoning settings.

## What It Uses

- OpenAI by default through the user's own API key, with GPT 5.6 Terra at Medium reasoning as the primary model and GPT 5.6 Luna at Medium reasoning as the same-provider fallback.
- Gemini through Google AI Studio, with Gemini 3.5 Flash as the primary model and Gemini 3.1 Flash Lite as the same-provider fallback when Gemini is selected as the preferred provider.
- A local semantic index for vault search, context-aware task descriptions, and compact task-reference retrieval.
- Todoist API access for task creation, updates, and reference reconciliation.
- Optional Cloudflare Email Routing and Workers for the Email-To-Todoist workflow.
- Local OID markers in notes, with Todoist IDs and Todoist task snapshots stored in the plugin's local reference table (to keep things local and avoid having to always do external API calls - this keeps the plugin fast).
- A small local scheduler memory file for accepted task durations, preview edits, schedule order signals, and compact vault context used by Schedule Today's Tasks.
- Markdown prompt files in the vault for reusable AI prompts, summaries, and task-generation workflows.

## Quick Setup

Open `Settings > Semantic Todoist Sync > Setup` (all the details are in there - but summary below)

The setup tab is step-wise with links to open each provider pages in the browser, gives you the field to paste each key or token directly beside the step, and includes validation buttons so you can confirm each connection before moving on. 

1. Add an AI provider key.
   - Default: OpenAI.
   - Use `OpenAI API keys` to open OpenAI Platform's key page.
   - Paste the OpenAI key into `OpenAI API key`.
   - Click `Test AI`.
   - Optional: use Gemini instead by adding a Gemini key and choosing Gemini as the preferred provider.

2. Add Todoist access.
   - Use `Token instructions` if Todoist does not open directly to the token page.
   - Use `Todoist web settings` to open Todoist's browser settings.
   - Paste the personal API token into `Todoist API token`.
   - Click `Test Todoist`.
   - Refresh projects and choose the default Todoist project. Inbox is used by default.

3. Choose your workflow.
   - Notes-To-Todoist requires AI plus Todoist.
   - Email-To-Todoist also requires AI plus Todoist.
   - Existing note tasks can be preserved, or compatible Todoist ID markers from older workflows can be converted to Semantic Todoist Sync OIDs from the setup page.
   - If note tasks already have OIDs but the local reference table is missing Todoist IDs, use `Recover Todoist IDs` to match note task names against existing Todoist tasks and rebuild the local table.
   - Cloudflare connectivity (through the Email-to-Todoist workflow) is optional overall, and is only needed if the user wants Email-To-Todoist activity.
   - Email-To-Todoist additionally requires the user's own Cloudflare Worker URL and Worker token.
   - The setup tab can generate the shared Worker token locally. This is not a Cloudflare account API token. Use the same value as the authorization secret in your Cloudflare Worker.
   - Use the Email Routing button for Cloudflare email routing. Use the API Tokens button only if your Worker deployment tooling asks for a Cloudflare account token (it should not).

4. Rebuild the semantic index.
   - This creates the local semantic index manifest and shard files in the plugin folder.
   - Gemini and OpenAI indexes are stored separately so switching providers does not overwrite the other index (so you can test whichever works best for you!)
   - Index shards are kept under Obsidian Sync's 5 MB file-size ceiling so the index can sync across devices instead of rebuilding separately on each device.
   - A small path-metadata snapshot helps startup and note-change checks avoid loading full shard files until the in-memory index is needed.
   - Existing unchanged chunks are reused from the persistent index during rebuilds and changed-note updates, so ordinary edits should only embed new or changed chunks.
   - During rebuilds, the active note, open notes, and recently modified notes are indexed first before older background content.
   - Existing larger legacy shards are loaded with idle yields, then optimized later when the plugin is idle.
   - The plugin folder is excluded from indexing and AI chat context by default.

5. Optional: configure Schedule Today's Tasks.
   - Open `Settings > Semantic Todoist Sync > Schedule Today`.
   - Set your workday, lunch window, minimum block, maximum block, due window, excluded labels, and simple scheduling weights.
   - Run the scheduler from the sidebar prompt chooser or command palette. It opens a preview first and does not write Todoist changes until you choose `Apply`.
   - The preview shows scheduled tasks, unscheduled work, moved-out tasks, and up to ten suggested swaps.
   - The default `Schedule today's tasks` prompt is created in the prompts folder and can be edited there. Settings still control the scheduler rules; the prompt coordinates the duration-estimation request.

6. Optional: configure task deduplication.
   - Open `Settings > Semantic Todoist Sync > Setup`.
   - Keep task deduplication on to compare newly generated tasks against existing open Todoist tasks and other tasks generated in the same batch.
   - Leave AI-mediated deduplication enabled for the safest automatic merges. The default dedupe model follows the configured chat fallback model, and you can choose another model if you prefer.
   - Model choices shown in settings stay scoped to the preferred AI provider selected during setup.
   - If AI-mediated deduplication is disabled, local-only detection can still flag possible duplicates in chat for manual review, but it will not merge tasks automatically.

7. Optional: publish an MCP bridge manifest.
   - Open `Settings > Semantic Todoist Sync > Setup`.
   - Leave `Publish MCP bridge manifest` off unless a separate Obsidian MCP server is installed and configured to read the plugin data directory.
   - When enabled, the plugin writes only a small manifest and README in a normal vault folder. These files point to the existing semantic index manifest and shard files, `task-reference-snapshot.json`, and `task-reference-index.json`.
   - The bridge does not start an MCP server, copy the Todoist snapshot, copy the reference table, rebuild the semantic index, or create new shard files for MCP access.
   - MCPVault-style file servers can discover the bridge folder with their normal vault tools. Full access to the existing database files requires a narrow read-only allowlist for the paths listed in `bridge-manifest.json`, because stock MCPVault blocks `.obsidian` paths by default.
   - Use the manifest's safe read-only MCPVault tool list for bridge access, and hide or approval-gate MCPVault write/move/delete/tag-management tools for the plugin data directory.
   - For ChatGPT-facing querying, expose the bridge's suggested read-only tools: `semantic_todoist.search_semantic_index`, `semantic_todoist.get_todoist_snapshot`, and `semantic_todoist.get_reference_table`.

## Sidebar And Prompts

The sidebar is the main working surface:

- The active-note picker shows whether the selected note is included in chat search, without taking a separate sidebar row.
- `Ask` queries the vault using the active note and semantic index.
- `Tasks` runs the configured default task-generation prompt directly and creates Todoist-ready tasks from the selected or active note.
- The one-line `Run:` dropdown sits below the chat box. Choose `Schedule today's tasks` or another prompt template, then press `Run`.
- `Run` executes only the selected dropdown action. It does not send a chat question or run the default task generator unless that is the selected prompt template.
- The header icon starts a new chat.
- `Index` rebuilds the semantic vault index.

When task context is relevant, chat can also use the local Todoist reference table and semantic task chunks. Task links are shown as descriptive linked text rather than full raw URLs.

Prompt files live in the configured prompts folder, defaulting to `Semantic Todoist Sync/Prompts`. Prompt frontmatter controls behavior:

```md
---
createTasks: true
insertResponse: true
syncTasks: true
taskGenerationTemplate: false
taskHeading: '## Semantic Todoist Sync - Summary'
---
```

- `createTasks: false` runs a normal prompt response, such as a summary.
- `createTasks: true` with `taskGenerationTemplate: true` marks the prompt as a dedicated Todoist task-generation prompt.
- `createTasks: true` with `taskGenerationTemplate: false` runs the original prompt response first, then runs the configured task-generation prompt as a separate second step.
- `action: schedule-today` marks a prompt as the scheduler action. Scheduler settings remain authoritative, while the prompt coordinates duration estimates, split suggestions, and practical sequencing guidance.
- `insertResponse` controls whether the response is inserted into the active note.
- `syncTasks` controls whether generated tasks sync to Todoist after insertion.
- `taskHeading` controls the heading inserted above the response or generated task list.

## Command Palette Options

- `Semantic Todoist Sync: Open sidebar`
- `Semantic Todoist Sync: Rebuild semantic vault index`
- `Semantic Todoist Sync: Ask AI with active context`
- `Semantic Todoist Sync: Prompt AI from command palette`
- `Semantic Todoist Sync: Run prompts`
- `Semantic Todoist Sync: Search vault semantically`
- `Semantic Todoist Sync: Process pending email tasks`
- `Semantic Todoist Sync: Create Todoist tasks from active note`
- `Semantic Todoist Sync: Schedule today's tasks`
- `Semantic Todoist Sync: Undo last schedule today apply`
- `Semantic Todoist Sync: Sync note tasks with Todoist`
- `Semantic Todoist Sync: Rebuild local Todoist reference table`

## Note Task Syntax 
*- This is based directly from the amazing "Another Simple Todoist Sync" and "Ultimate Todoist Sync" plugins which work well!*

Main tasks use `#STsync`. Subtasks use `#STSubSync` (to not conflict with the default markers from those other 2 plugins)

```md
- [ ] Review the draft agreement #STsync #Legal !!4 ///Notes_26_05_22_Agreement %%[p:: Legal Review]%% {{2026-06-01}} 📅 2026-05-28 %%[oid:: A1B2C]%%
    - [ ] Confirm comments were addressed #STSubSync #Legal !!3 %%[oid:: D4E5F]%%
```

Local task marker: `%%[oid:: A1B2C]%%`

Todoist IDs are stored in the local index/reference table, but are viewable in the plugin's settings, not in note text.

Subtasks are kept indented under their parent tasks during insertion and sync. If Todoist updates or older note content collapse the indentation, sync normalization repairs subtasks to the configured indentation width.

It is recommended, when writing meeting notes, to flag action items with a consistent marker such as `#todo` so task extraction has a strong signal. Settings include separate plain-language instruction areas for main tasks, subtasks, section titles, dates, deadlines, tags, priorities, descriptions, links, and optional source/citation behavior.

## Changelog

Release history is maintained in [CHANGELOG.md](CHANGELOG.md).

## Community Plugin Release

This repository includes the files Obsidian expects for community plugin review:

- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- `manifest.json`
- `versions.json`

Each GitHub release tag matches the version in `manifest.json` and includes `main.js`, `manifest.json`, and `styles.css` as release assets.

## Privacy And Security

- API keys are stored in Obsidian plugin settings on the user's device and sync only if the user syncs Obsidian settings.
- Vault content is sent to the selected AI provider when using chat, semantic indexing, task extraction, or task description generation.
- AI-mediated task deduplication sends the likely duplicate pair and relevant task/note context to the selected dedupe model when automatic merging is enabled.
- The local status bar and sync reconciliation logic do not use AI API calls.
- Todoist receives task content, descriptions, labels, due dates, priorities, project IDs, and section IDs needed for sync.
- The local Todoist reference table stores Todoist task snapshots on device and is used to reduce repeated Todoist API reads.
- The local scheduler memory stores compact scheduling signals on device, including accepted durations, preview edits, task order signals, labels, relative note paths, and lightweight context terms.
- Semantic index shards can include compact task-reference chunks derived from the local reference table.
- Email-To-Todoist uses the user's own Cloudflare Worker. The plugin reads queued email content only when that workflow is configured and run.
- No personal accounts, domains, API keys, Worker URLs, or vault paths are included in this public BYOK version.

## Mobile Notes

The plugin has been tested and is functional on iPadOS/iOS mobile Obsidian apps. Background polling and sync run only while Obsidian is open and the plugin is loaded because of iPadOS/iOS limits. The scheduler preview uses compact controls on narrow screens, so you can adjust blocks without relying on desktop drag-and-drop.

## License

Semantic Todoist Sync is released under the GNU General Public License v3.0. See `LICENSE` for details.
