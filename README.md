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

## What's New In 0.6.13

1. **Duplicate task prevention**

   Notes-To-Todoist and Email-To-Todoist now check the local reference table before creating tasks. When a confident open-task match is found, the plugin reuses the existing Todoist task, links the new note line with its own local OID, and updates the task instead of making duplicate work.

2. **Editable merge policy**

   A new Task Deduplication settings tab keeps the matching behavior understandable: conservative by default, labels additive by default, optional AI only for ambiguous matches, and an editable plain-language policy you can also update from the chat sidebar.

3. **Stronger local OID mapping**

   The local reference table now supports multiple note OIDs pointing to the same Todoist task, so reused tasks can stay traceable across notes without extra Todoist API calls.

## What It Uses

- OpenAI by default through the user's own API key, with GPT 5.4 Mini as the primary model, GPT 5.4 as the same-provider fallback/optional strong model, and Gemini still supported through Google AI Studio.
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
   - Optional: use Gemini instead by adding a Gemini key and choosing Gemini models.

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

6. Optional: enable stronger-model routing.
   - Open `Settings > Semantic Todoist Sync > Setup`.
   - Leave `Use stronger model when locally justified` off for the fastest and cheapest default behavior.
   - Turn it on when you want broad portfolio questions, recency/conflict-heavy answers, complex task generation, or richer task descriptions to use the configured stronger model only when the local score is high enough.

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
- The optional strong-model gate is decided locally from already-retrieved context and does not make an extra AI call just to choose a model.
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
