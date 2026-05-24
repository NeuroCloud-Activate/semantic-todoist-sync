# Semantic Todoist Sync

> **AI vibecoded project:** Semantic Todoist Sync was built collaboratively with AI assistance. Please review the code, security model, and workflow assumptions before using it with private vault content, email, or Todoist data.

Semantic Todoist Sync is a bring-your-own-key Obsidian plugin for using AI and semantic vault context to search notes, generate tasks, and synchronize those tasks with Todoist.

## Primary Functions

1. **Semantic vault search and question-answering**

   Build a local semantic index of your Obsidian vault so you can search and query across your notes. The plugin uses relevant note context to answer questions, summarize sources, and support task generation with better background information than the active note alone.

2. **Notes-To-Todoist**

   Generate actionable tasks from your Obsidian notes, insert them back into the note with Semantic Todoist Sync markers, and synchronize them with Todoist. Existing note tasks can be preserved, converted to local OIDs, or reconciled with Todoist through the local reference table.

3. **Email-To-Todoist**

   Forward emails containing tasks to a user-owned Cloudflare Worker processor. The plugin can retrieve those emails, use AI plus vault context to identify actionable tasks, log the created tasks into Obsidian, and synchronize them into Todoist.

## What It Uses

- Google Gemini by default, with OpenAI also supported.
- A local semantic index for vault search and context-aware task descriptions.
- Todoist API access for task creation, updates, and reference reconciliation.
- Optional Cloudflare Email Routing and Workers for Email-To-Todoist.
- Local OID markers in notes, with Todoist IDs stored in the plugin reference table.

## Quick Setup

Open `Settings > Semantic Todoist Sync > Setup`.

The setup tab is step-wise. It opens official provider pages in the browser, gives you the field to paste each key or token directly beside the step, and includes validation buttons so you can confirm each connection before moving on. This avoids bundling a shared OAuth client or proxy service into the plugin.

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
   - Cloudflare is optional overall, and is only needed if the user wants Email-To-Todoist.
   - Email-To-Todoist additionally requires the user's own Cloudflare Worker URL and Worker token.
   - The setup tab can generate the shared Worker token locally. This is not a Cloudflare account API token. Use the same value as the authorization secret in your Cloudflare Worker.
   - Use the Email Routing button for Cloudflare email routing. Use the API Tokens button only if your Worker deployment tooling asks for a Cloudflare account token.
   - Worker URLs are saved as HTTPS automatically if the scheme is omitted.

4. Rebuild the semantic index.
   - This creates a local index file in the plugin folder.
   - Gemini and OpenAI indexes are stored separately so switching providers does not overwrite the other index.

## Commands

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

## Note Task Syntax

Main tasks use `#STsync`. Subtasks use `#STSubSync`.

```md
- [ ] Review the draft agreement #STsync #Legal !!4 ///Notes_26_05_22_Agreement %%[p:: Legal Review]%% {{2026-06-01}} 📅 2026-05-28 %%[oid:: A1B2C]%%
    - [ ] Confirm comments were addressed #STSubSync #Legal !!3 %%[oid:: D4E5F]%%
```

Todoist project marker: `%%[p:: Project Name]%%`

Local task marker: `%%[oid:: A1B2C]%%`

Todoist IDs are stored in plugin settings, not in note text.

## Privacy And Security

- API keys are stored in Obsidian plugin settings on the user's device and sync only if the user syncs Obsidian settings.
- Vault content is sent to the selected AI provider only when using chat, semantic indexing, task extraction, or task description generation.
- Todoist receives task content, descriptions, labels, due dates, priorities, project IDs, and section IDs needed for sync.
- Email-To-Todoist uses the user's own Cloudflare Worker. The plugin reads queued email content only when that workflow is configured and run.
- No personal accounts, domains, API keys, Worker URLs, or vault paths are included in this public BYOK version.

## Mobile Notes

The plugin is not desktop-only. On iPadOS and mobile Obsidian, background polling and sync run only while Obsidian is open and the plugin is loaded.
