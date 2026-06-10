# Changelog

## 0.5.15

- Fixed Email-To-Todoist task notes so the Email-To-Todoist log folder remains eligible for note sync and local reference rebuilds even when the plugin data folder is excluded from semantic indexing.
- Kept Email-To-Todoist log notes excluded from AI indexing/search while allowing Todoist sync-back updates to reach the generated note.
- Added clearer local logging for generated email task notes, including cached task count and sync eligibility.

## 0.5.14

- Updated the artifact attestation workflow to use `actions/checkout@v6` to avoid the GitHub Actions Node 20 deprecation warning.

## 0.5.13

- Added a GitHub Actions artifact attestation workflow for the Obsidian release assets `main.js`, `manifest.json`, and `styles.css` on pushes, releases, and manual runs.
- Added workflow validation that rejects leading-`v` manifest versions and confirms the manifest version is present in `versions.json` before generating attestations.

## 0.5.12

- Added a separate Todoist task reference snapshot file so normal plugin settings saves no longer rewrite the full local task reference table.
- Added an in-memory task reference index and compact persistent OID/index cache for OID, path, section, child-task, and pending-reference lookups used by sync, chat task context, subtask indentation repair, and semantic task-reference chunks.
- Added lightweight task-reference de-duplication for duplicate note references, labels, pending OID references, and same-note duplicate OIDs before snapshotting.
- Reduced sync overhead by using the RAM index for per-file deleted-task checks and empty-section cleanup instead of scanning the full local reference table.

## 0.5.11

- Reduced startup and task-generation lag by deferring background maintenance, warming semantic-index caches in smaller idle batches, and avoiding the extra prompt-response pass for task-generating prompts.
- Prevented duplicate inserted task lists by routing prompts with `createTasks: true` directly through the structured task-generation workflow.
- Removed local due-date/deadline autofill so customizable Dates and Deadlines instructions control whether due dates and deadlines are created.
- Made section names model-generated from the Section Title settings, with the previous plugin-derived name used only as a fallback.
- Stopped stripping model-generated labels when label settings are written in plain language without `#Label` syntax.

## 0.5.10

- Kept Todoist description context-note citations aligned with the plugin-generated context source list.
- Stopped numbering extra vault context chunks during description generation so the AI cannot cite a context number that is not present in the final source list.
- Added local cleanup for out-of-range context-note citations before source lists are appended to Todoist descriptions.

## 0.5.9

- Added same-provider AI model fallback for transient overload, rate-limit, and temporary 5xx model errors.
- Added settings to enable or disable fallback and choose the fallback model, with Automatic using the next available model from the same provider.

## 0.5.8

- Replaced the always-visible active-note search field with a compact selector so desktop sidebar chat has only one persistent text-entry box.
- Hid the included active-note summary card on mobile to keep the chat transcript prioritized while preserving excluded/unavailable active-note status messages.
- Cleaned up Obsidian CSS lint warnings for partially supported scrollbar styling and duplicate mobile `max-height` declarations.

## 0.5.7

- Reworked the iPhone/iOS sidebar layout so the chat transcript keeps usable vertical space by compacting the header, active-note controls, relevant-note chips, prompt field, and action buttons.

## 0.5.6

- Restored the GitHub repository source layout so plugin files are published at the repository root.
- Kept release assets aligned with the root plugin files.

## 0.5.5

- Added iPadOS and iOS-friendly layout constraints for the plugin sidebar, settings tabs, prompt modals, and reference table so controls remain usable in narrow panes and mobile modal shells.
- Added mobile touch-target sizing, safe-area padding, bounded scrolling, and iOS input zoom prevention for plugin settings, sidebar chat, and prompt/template modals.
- Improved the local validation workflow while keeping published plugin files aligned.

## 0.5.4

- Hardened Todoist-to-Obsidian sync-back so `#STSubSync` subtasks keep the configured indentation across direct activity updates, note reconciliation, section/project marker cleanup, task creation, relinking, and deleted-task cleanup.
- Added retroactive synced-subtask indentation repair that runs once per repair version/indent setting over cached synced-task note paths, with a manual command for an explicit full-vault repair.
- Prevented plugin-generated note writes from queuing automatic note sync or semantic index updates, reducing sync/index churn and avoiding repair/sync loops after Todoist sync-back writes.
- Added guards so automatic email processing cannot re-enter while already running, and optimized subtask repair lookups to avoid repeatedly scanning the local reference table.

## 0.5.2

- Fixed Todoist-to-Obsidian sync-back so subtasks marked with `#STSubSync` keep or regain the configured indentation even if a prior sync flattened the note line.

## 0.5.1

- Changed automatic Email-To-Todoist polling to a 420-second minimum so open Obsidian sessions stay well below Cloudflare KV Free tier list-operation limits.
- Updated automatic email polling so failed background checks record the attempted poll time before contacting Cloudflare, preventing rapid retry loops.
- Updated Email-To-Todoist setup language, generated Cloudflare setup notes, and settings descriptions to explain the 420-second poll floor and the compatible Worker's `state/pending.json` queue-state behavior.
- Deployed and audited the Cloudflare Worker queue optimization so empty `/pending` checks use a lightweight KV read path instead of repeatedly using `KV.list()`.

## 0.5.0

- Updated Todoist-to-Obsidian sync so Todoist task title, completion state, labels, priority, dates, deadlines, section, and project changes refresh the note task line from the local reference cache/snapshot instead of only updating project markers.
- Added section marker reconciliation so Todoist section moves update the `///Section` marker in Obsidian and the local reference table.
- Preserved subtask indentation during Todoist-to-Obsidian sync, including re-indenting synced subtasks that would otherwise be written at the parent-task level.
- Aligned indentation parsing with the configured subtask indent width so one-space collapsed subtasks still retain parent relationships and are repaired to the configured indentation during sync.
- Standardized task-generation requests into separate Main task and Subtask requirement sections so the AI model consistently decides labels, priorities, dates, and deadlines from the configured settings, with validation guardrails still applied before note insertion or Todoist sync.
- Added a built-in requirement for task and description generation to use relevant ranked vault context when available, and trimmed each context excerpt to the most relevant lines before sending it to the AI model.
- Updated sidebar chat to consider generated/synced tasks from the local Todoist reference table alongside note context and to surface supplied Todoist task links when existing tasks are referenced.
- Improved sidebar chat task lookup so questions about dated meetings or people can find OID-backed tasks from matching note titles/paths even when semantic vault retrieval does not select that note, while sending only a small set of the most relevant task references to reduce prompt size.
- Added compact local Todoist reference-table task chunks to the semantic index so synced task content, labels, dates, sections, projects, descriptions, and OIDs can be retrieved through semantic search without flattening every task into one prompt line.
- Rendered sidebar chat links as descriptive markdown links so AI responses do not display full raw Todoist, Obsidian, or web URLs.
- Excluded the plugin's `Semantic Todoist Sync` vault folder from semantic embedding and AI sidebar context by default, including runtime filtering of older indexed chunks from that folder.
- Updated the sidebar status line so it reflects queued and active plugin work without duplicating the detail row for a single activity; detail items now appear only when multiple distinct activities are running.
- Normalized stored note paths for semantic index entries, local Todoist reference-table rows, pending references, and source lists so they remain vault-relative when a vault folder moves.
- Kept Todoist description source lists plugin-generated, with separate Primary Note and Context Notes sections that show only vault-relative note paths.
- Saved semantic embedding indexes as a small manifest plus sync-safe shard files under the Obsidian Sync Standard 5 MB file-size ceiling, while still loading and automatically converting older single-file indexes.
- Deleted empty Todoist sections after all generated tasks from a note are removed, while keeping sections that still have local or live Todoist tasks.
- Simplified the sidebar status line so it uses one concise local summary of all active plugin work instead of generic activity counts or duplicated detail rows.
- Added in-memory semantic keyword scoring cache for indexed chunks to reduce repeated text parsing during chat and vault search, especially on mobile.
- Warmed the semantic index's in-memory keyword cache in small background batches after plugin load so first searches are faster without extra AI/API calls.
- Added explicit AI activity status during chat, task generation, and task-description writing, and renamed description quality follow-up from repair language to calmer improvement language.
- Tightened the first-pass task-description prompt with the local quality criteria so the model is less likely to trigger an extra description-improvement call.
- Updated task-description prompting and cleanup so descriptions begin with actionable context instead of naming the active note, source title, or filename.
- Enforced the configured subtask indentation width during note insertion and sync normalization so subtasks do not collapse to one-space indentation.
- Added per-workflow settings to include or omit plugin-generated source lists and matching context-note sentence citations like `(1)` in Todoist descriptions, enabled by default.
- Removed legacy note-generation insert/sync and Obsidian Tasks ordering controls from settings because prompt templates and default plugin formatting now own that behavior.
- Updated Activity settings to show sharded semantic index files and separate AI model summaries by provider.
- Reworked excluded-folder settings so the add control is a searchable folder text box and the selected excluded folders appear below it.
- Preserved AI-generated subtask metadata after task generation so subtask settings are primarily enforced through the model request instead of generation-stage field stripping.
- Made Email-To-Todoist and Notes-To-Todoist instruction fields more compact so prompt customization stays concise and the settings pages are shorter.
- Normalized inserted prompt and task sections so new headings are separated from existing note content by exactly one blank line.

## 0.4.3

- Fixed semantic index rebuilds so full rebuilds run exclusively and clear queued incremental folder-change updates before starting.
- Prevented empty or no-text rebuild attempts from overwriting an existing usable semantic index with a tiny empty index file.
- Changed automatic incremental indexing so it triggers a full rebuild when no complete semantic index exists, avoiding partial indexes after folder rearrangements.
- Improved Activity index status text when an index file exists but contains no chunks.
- Made vault folder creation tolerate already-existing folders during Obsidian Sync races.

## 0.4.2

- Fixed the local reference table layout so all 17 columns have explicit widths after adding Project and Project ID in v0.4.1.
- Moved Last email poll and Process pending email tasks under the Email-To-Todoist Automation heading.
- Audited Todoist sync paths to confirm project-move, delete, and reconcile checks continue to prefer the Todoist snapshot plus local OID reference table to minimize API calls.

## 0.4.1

- Changed the default Email-To-Todoist note folder to `Semantic Todoist Sync/Email-To-Todoist`.
- Changed Email-To-Todoist logging so each processed email creates a separate note titled `YYYY-MM-DD - Email Subject`, using the original email received date rather than the processing date.
- Preserved Todoist project IDs and project names in the local OID reference table for newly created note and email tasks.
- Updated Todoist activity handling so project moves are confirmed against the all-project Todoist snapshot before a removed/deleted activity can remove a task from Obsidian.
- Added Project and Project ID columns to the reference table view.

## 0.4.0

- Added a sidebar chat option to include or exclude the active note from vault search context.
- Added configurable subtask criteria for labels, priority, due dates, and deadlines.
- Made sidebar chat text selectable.
- De-duplicated the Relevant Notes tabs so each note appears only once.
- Added Todoist task links to AI task context from the local OID reference table, using either web URLs or Todoist app URLs based on settings.
- Added automatic prompt folder creation with a default note-summary prompt.
- Migrated the default task-generation prompts into the prompt folder so default and custom prompts appear the same way.
- Added concise prompt run choices showing whether the selected prompt creates tasks, inserts into the active note, and syncs to Todoist.
- Expanded prompts so custom prompts can insert normal AI responses into notes, while task-generation prompts can still create and sync Todoist tasks.
- Defaulted custom prompt files without frontmatter to plain AI responses unless they explicitly set `createTasks: true`.
- Aligned Gemini structured JSON requests with the v1beta response-schema shape and normalized nullable/date/array-limit constraints to reduce unnecessary retry calls, while keeping a schema-free fallback for provider-side 400 errors.
- Added cleanup for Gemini JSON responses that include accidental trailing text after a valid structured payload.
- Reduced repeated active-note citations in prompt responses while preserving citations for supporting context notes.
- Moved generated task-list headings into task prompt frontmatter with `taskHeading`.
- Changed prompt-template action indicators to use `Generate tasks` and made insert/sync behavior read from the template instead of modal toggles.
- Added mixed prompt handling so prompts with `createTasks: true` can insert their original prompt response, then run a separate configurable task-generation prompt.
- Added `taskGenerationTemplate` frontmatter and a settings dropdown for the default task-generation prompt used by mixed summary-plus-task prompts.
- Added a `Tasks` button to the sidebar to run the configured default task-generation prompt directly.
- Renamed visible prompt-template UI language to `Prompts`/`Prompt` for clearer wording.
- Improved migration and relinking so existing Todoist tasks can be matched across all Todoist projects and preserve their project context instead of being recreated in the default project.
- Added more granular sidebar status messages during task description writing and source-context finalization.
- Preserved the v0.3 Obsidian community release metadata while bumping the working version to 0.4.0.
