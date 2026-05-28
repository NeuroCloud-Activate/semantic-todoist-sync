# Semantic Todoist Sync

> **AI vibecoded project:** Semantic Todoist Sync was built collaboratively with AI using OpenAI Codex. If you're concerned, please review the code, security model, and workflow assumptions before using it with your Obsidian vault content, emails, or Todoist data.

Build a local semantic index of your vault to search, answer questions, and identify tasks from notes using AI and vault context. Generate actionable tasks from notes or forwarded emails, insert those tasks into notes for traceability, and synchronize them with Todoist. The plugin supports 2-way task sync between Obsidian and Todoist, local OID-based reference tracking, task-aware chat, configurable prompts, and mostly local reconciliation to reduce repeated API calls.

## Primary Functions

1. **Semantic vault search and question-answering**

   Build a local semantic index of your Obsidian vault so you can search and query across your notes (similar to the Copilot plugin). The plugin ranks relevant note context, uses recent matching notes when useful, and can include compact synced-task references from the local Todoist table so task-aware questions can find existing OID-backed tasks.

2. **Notes-To-Todoist**

   Generate actionable tasks from your Obsidian notes, insert them back into the note with Semantic Todoist Sync markers, and synchronize them with Todoist. Existing note tasks can be preserved using local OIDs (Obsidian IDs) and a local Todoist snapshot/reference table to reduce API calls, speed up reconciliation, update changed Todoist fields back into notes, and recover Todoist task links when needed.

3. **Email-To-Todoist**

   Forward emails containing tasks to a user-owned Cloudflare Domain and Worker process. The plugin can retrieve those emails, use AI plus ranked vault context to identify actionable main tasks and subtasks, log the created tasks into Obsidian (to keep a record), and synchronize them into Todoist.

## What's New In 0.5.0

- Todoist-to-Obsidian sync now refreshes task titles, completion state, labels, priorities, dates, deadlines, sections, projects, and subtask indentation from the local Todoist snapshot.
- Sidebar chat can use synced task references alongside note context, with descriptive task links instead of raw URLs.
- The semantic index now stores vault-relative paths, excludes the plugin data folder by default, and writes sync-safe shard files under the Obsidian Sync 5 MB file-size ceiling.
- Notes-To-Todoist and Email-To-Todoist prompts now use separate main-task and subtask requirements, ranked vault context, and optional plugin-generated source lists with context-note citations.
- The status bar now uses concise local activity text for indexing, syncing, AI calls, and other plugin work. It does not call the AI API.
- Settings were simplified by removing legacy insert/sync and date/link order toggles now handled by prompt templates and default plugin formatting.

## What It Uses

- Google Gemini by default, with OpenAI also supported through the user's own API key and available model list.
- A local semantic index for vault search, context-aware task descriptions, and compact task-reference retrieval.
- Todoist API access for task creation, updates, and reference reconciliation.
- Optional Cloudflare Email Routing and Workers for the Email-To-Todoist workflow.
- Local OID markers in notes, with Todoist IDs and Todoist task snapshots stored in the plugin's local reference table (to keep things local and avoid having to always do external API calls - this keeps the plugin fast).
- Markdown prompt files in the vault for reusable AI prompts, summaries, and task-generation workflows.

## Quick Setup

Open `Settings > Semantic Todoist Sync > Setup` (all the details are in there - but summary below)

The setup tab is step-wise with links to open each provider pages in the browser, gives you the field to paste each key or token directly beside the step, and includes validation buttons so you can confirm each connection before moving on. 

1. Add an AI provider key.
   - Default: Google Gemini.
   - Use `Gemini API keys` to open Google AI Studio's key page.
   - Paste the Gemini key into `Google Gemini API key`.
   - Click `Test AI`.
   - Optional: use OpenAI instead by adding an OpenAI API key and choosing OpenAI models.

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
   - The plugin folder is excluded from indexing and AI chat context by default.

## Sidebar And Prompts

The sidebar is the main working surface:

- `Ask` queries the vault using the active note and semantic index.
- `Tasks` runs the configured default task-generation prompt directly.
- `Prompts` opens reusable markdown prompts from the prompt folder.
- `New chat` clears the visible conversation.
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
- The local status bar and sync reconciliation logic do not use AI API calls.
- Todoist receives task content, descriptions, labels, due dates, priorities, project IDs, and section IDs needed for sync.
- The local Todoist reference table stores Todoist task snapshots on device and is used to reduce repeated Todoist API reads.
- Semantic index shards can include compact task-reference chunks derived from the local reference table.
- Email-To-Todoist uses the user's own Cloudflare Worker. The plugin reads queued email content only when that workflow is configured and run.
- No personal accounts, domains, API keys, Worker URLs, or vault paths are included in this public BYOK version.

## Mobile Notes

The plugin has been tested and is functional on iPadOS/iOS mobile Obsidian apps, However, background polling and sync run only while Obsidian is open and the plugin is loaded (limitations of iPadOS/iOS).

## License

Semantic Todoist Sync is released under the GNU General Public License v3.0. See `LICENSE` for details.
