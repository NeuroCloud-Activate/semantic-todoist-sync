# Semantic Todoist Sync

> **AI vibecoded project:** Semantic Todoist Sync was built collaboratively with AI using OpenAI Codex. If you're concerned, please review the code, security model, and workflow assumptions before using it with your Obsidian vault content, emails, or Todoist data.

Semantic Todoist Sync is a bring-your-own-key Obsidian plugin for using AI and semantic vault context to search notes, generate tasks, and conduct 2-way synchronization of those tasks with Todoist. Goal here is to use your meeting notes, and identify actionable items right away and synchronize them to Todoist (saving you the hassle of manually creating all your tasks, and focusing more on getting them done!)

## Primary Functions

1. **Semantic vault search and question-answering**

   Build a local semantic index of your Obsidian vault so you can search and query across your notes (similar to the Copilot plugin). The plugin uses relevant note context to answer questions, summarize sources, and support task generation with better background information than the active note alone.

2. **Notes-To-Todoist**

   Generate actionable tasks from your Obsidian notes, insert them back into the note with Semantic Todoist Sync markers, and synchronize them with Todoist. Existing note tasks can be preserved, using a local OIDs (Obsidian IDs) reference table to reduce API calls and enhance speed, with the ability to reconcile with Todoist automatically and manually.

3. **Email-To-Todoist**

   Forward emails containing tasks to a user-owned Cloudflare Domain and Worker process. The plugin can retrieve those emails, use AI plus vault context to identify actionable tasks, log the created tasks into Obsidian (to keep a record), and synchronize them into Todoist.

## What It Uses

- Google Gemini by default (recommend the new Gemini 3.5 Flash), with OpenAI also supported (found best cost/benefit using GPT 5.4).
- A local semantic index for vault search and context-aware task descriptions.
- Todoist API access for task creation, updates, and reference reconciliation.
- Optional Cloudflare Email Routing and Workers for the Email-To-Todoist workflow.
- Local OID markers in notes, with Todoist IDs stored in the plugin's local reference table (to keep things local and avoid having to always do external API calls - this keeps the plugin fast).

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
   - This creates the local index file in the plugin folder.
   - Gemini and OpenAI indexes are stored separately so switching providers does not overwrite the other index (so you can test whichever works best for you!)

## Commands Palette Options (the majority of these options are in the settings and Chat sidebar panes, so don't "need" to use the command palette")

- `Semantic Todoist Sync: Open sidebar`
- `Semantic Todoist Sync: Rebuild semantic vault index`
- `Semantic Todoist Sync: Ask AI with active context`
- `Semantic Todoist Sync: Prompt AI from command palette`
- `Semantic Todoist Sync: Run task prompt template`
- `Semantic Todoist Sync: Search vault semantically`
- `Semantic Todoist Sync: Process pending email tasks`
- `Semantic Todoist Sync: Create Todoist tasks from active note`
- `Semantic Todoist Sync: Sync note tasks with Todoist`
- `Semantic Todoist Sync: Rebuild local Todoist reference table`

## Note Task Syntax (this is based directly from the amazing "Another Simple Todoist Sync" and "Ultimate Todoist Sync" plugins which work well!)

Main tasks use `#STsync`. Subtasks use `#STSubSync` (to not conflict with the default markers from those other 2 plugins)

```md
- [ ] Review the draft agreement #STsync #Legal !!4 ///Notes_26_05_22_Agreement %%[p:: Legal Review]%% {{2026-06-01}} 📅 2026-05-28 %%[oid:: A1B2C]%%
    - [ ] Confirm comments were addressed #STSubSync #Legal !!3 %%[oid:: D4E5F]%%
```

Local task marker: `%%[oid:: A1B2C]%%`

Todoist IDs are stored in the local index/reference table, but are viewable in the plugin's settings, not in note text.

It is highly recommended, when writing your meeting notes, to flag tasks with some kind of tag (I used for example #todo), to help make sure that all your tasks are captured. Within the settings, plain language rompt areas are separated and available for you to customize all the Tasks creation aspects for Todoist (to help determine what works best for you). For example, Main Tasks, Subtasks, Section Titles, Dates, Deadlines, Tags, Priorities, Descriptions and any links.

## Community Plugin Release

This repository includes the files Obsidian expects for community plugin review:

- `README.md`
- `LICENSE`
- `manifest.json`
- `versions.json`

Each GitHub release tag matches the version in `manifest.json` and includes `main.js`, `manifest.json`, and `styles.css` as release assets.

## Privacy And Security

- API keys are stored in Obsidian plugin settings on the user's device and sync only if the user syncs Obsidian settings.
- Vault content is sent to the selected AI provider when using chat, semantic indexing, task extraction, or task description generation.
- Todoist receives task content, descriptions, labels, due dates, priorities, project IDs, and section IDs needed for sync.
- Email-To-Todoist uses the user's own Cloudflare Worker. The plugin reads queued email content only when that workflow is configured and run.
- No personal accounts, domains, API keys, Worker URLs, or vault paths are included in this public BYOK version.

## Mobile Notes

The plugin has been tested and is functional on iPadOS/iOS mobile Obsidian apps, However, background polling and sync run only while Obsidian is open and the plugin is loaded (limitations of iPadOS/iOS).

## License

Semantic Todoist Sync is released under the GNU General Public License v3.0. See `LICENSE` for details.
