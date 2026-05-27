# Changelog

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
