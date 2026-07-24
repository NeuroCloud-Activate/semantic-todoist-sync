# Semantic Todoist Sync

Semantic Todoist Sync is for people who live in Obsidian, but still need their actual action items to land in Todoist.

It builds a local semantic index of your vault, uses your own OpenAI, Gemini, OpenRouter, or OpenWebUI provider to understand note context, turns notes or forwarded emails into Todoist-ready tasks, writes those tasks back into Obsidian for traceability, and keeps the two sides synced. It can also preview a practical workday schedule from your Todoist tasks. The plugin keeps local Todoist and scheduler memory files so it can answer questions about existing tasks, plan from prior scheduling choices, and avoid pestering external APIs more than it needs to.

> **AI-assisted project:** Please review the code, security model, and workflow assumptions before using it with vault content, emails, or Todoist data you care about.

## What It Does

1. **Semantic vault search and question-answering**

   Ask questions across your vault using ranked note context. The plugin can also pull in compact task references from its local Todoist table, so answers can point to tasks you already created instead of pretending they do not exist.

2. **Notes-To-Todoist**

   Turn meeting notes, project notes, or selected text into main tasks and subtasks. The tasks are inserted back into the note with Semantic Todoist Sync markers, then synced to Todoist with local OIDs so later updates can be reconciled.

3. **Email-To-Todoist**

   Forward task-heavy emails into a user-owned Cloudflare Worker queue. The plugin can pull them into Obsidian, use AI plus vault context to identify the real tasks, write a note log, and sync the tasks into Todoist.

4. **Schedule Today's Tasks**

   Build a preview of today's work from overdue tasks and tasks due soon. The preview keeps existing Todoist times fixed, estimates missing durations, lets you adjust or swap tasks before applying, and writes only the approved due times and durations back to Todoist.

## What's New

The 0.8 line makes multi-provider task capture, task-local context, and local persistence easier to control.

### 0.8.0 multi-provider showcase

- **One gateway, clear routing.** A harmonized AI gateway handles chat, task and description generation, embeddings, discovery, and setup checks. Each operation can name its own primary provider/model and optional fallback.
- **Find models without guesswork.** Wide searchable selectors keep full native IDs visible. OpenRouter discovery lists accessible chat and embedding models; its free-router profile allows at most 20 calls per minute. OpenWebUI discovery combines `/api/models` with its proxied Ollama tags. Context-window data stays provider/model aware.
- **OpenWebUI stays orderly.** The plugin starts with one worker; each model allows up to two same-model calls by default (max four), and extra workers can serve distinct models on their own lanes. Task descriptions follow the selected model's limit, while model switches and embedding transitions wait their turn in FIFO order. Other cloud providers default to 10 concurrent calls per model.
- **Schemas adapt, validation stays strict.** Requests map structured schemas, caching, usage, reasoning, and bounded retries to each provider. Local validation still checks the original shape and patterns; retries never become an unbounded fallback.
- **Use 16k wisely.** For unknown windows, 16,384 tokens is an efficiency guide—not a product-wide input cap. Provider/model metadata and preflight still decide how much context fits each request.
- **Grounded output.** Evidence-based Vault QA chat uses selected facts and citations within bounded context. Task and description work uses safe batching and shared context where it can, while each description stays task-local.
- **Less babysitting.** Note changes update the semantic index automatically. Dedupe and Schedule Today's Tasks remain configurable, with review/apply controls for schedule writes.

#### Small validation snapshot

| Provider/model | Score /100 | Result | Quick note |
|---|---:|---|---|
| OpenAI GPT-5.6 Luna high | 95 | Pass | Strong across the workflow. |
| Gemini 3.5 Flash Lite | 89 | Pass | Strong across the workflow. |
| OpenRouter `tencent/hy3` | 60 | Mixed | Tasks/descriptions strong; chat exhausts output in reasoning. |
| OpenRouter `tencent/hy3:free` | 0 | Unavailable | 404; paid slug advertised. |
| OpenRouter `openrouter/free` | 77 | Mixed | Dynamic and inconsistent; one unchanged description failed. |
| OpenWebUI `gemma4:e4b` | 64 | Limited | Tasks and one description good; chat/description consistency insufficient. |
| OpenWebUI Qwen3.5 9B (HF) | 38 | Limited | Some chat success; grounding, timeout, and shape failures. |
| OpenWebUI Gemma 12B Agentic (HF) | 60 | Mixed | Task/description stronger; chat unreliable. |

Metric legend: **Pass** means a strong observed result; **Mixed** means results varied or one workflow was uneven; **Limited** means only part of the strict workflow was reliable; **Unavailable** means the configured endpoint/model could not be used. The same two private live-vault notes and frozen evidence were used across models; no note content is published. Sol/High judged evidence accuracy, intent/actionability, citation fidelity, structure, and useful context use. All final provider-visible inputs stayed under the 16K efficiency target (chat ≤4.5K, compacted task ≤1.7K, description ≤0.6K estimate); these are input estimates, not provider token-usage claims.

Task descriptions now keep reliable task-scoped history and all materially
useful local detail while sending less repeated context. Important decisions
and handoffs stay grounded without crowding out the work at hand or merely
repeating the task title.

Context-consuming operations remove task- and scope-irrelevant duplicates by
stable ID before provider input. Detected context windows use one adaptive input
safety curve across chat, task generation, descriptions, deduplication,
scheduling, policy, and section naming: up to 80% for windows at or below 4,096
 tokens, tapering linearly to 50% at 100,000 tokens and above. For unknown windows,
 16,384 tokens is an efficiency guide—not a product-wide input cap. Provider/model
 metadata and preflight still decide how much context fits each request.
 Preflight counts the full provider-visible request, including the stable prefix
 and strict schema, with a conservative safety margin. Task, description, and AI
  section-title calls also receive request-sized output budgets so runaway model
  prose cannot consume an unbounded number of tokens.

Every AI-provider generation, embedding, discovery, and setup attempt defaults
to 180 seconds. Selected evidence and history are delivered complete rather than
token-truncated or dropped, so an oversized complete request fails visibly before
provider dispatch. OpenWebUI timeouts keep non-abortable requests in the FIFO lane
until their transport settles, and usage/diagnostics identify the actual provider
and model attempted.

1. **Better context and task details**

   Task generation starts with the current note's request, then adds task-scoped
   semantic context without mixing neighboring work. The broad local semantic-
   evidence ceiling is 48 records per task. Each description singleton receives
 only its own protected closure and up to eight fact-backed optional rows from
 that task scope's existing semantic ranking; the provider ceiling is a maximum
 rather than a fill target. Protected
   current-source, mandatory, and material facts remain included while weaker
   optional matches stay out of the request.
   Descriptions include all materially useful task-local detail beyond the title
   or requested action, carry selected facts and citations through the workflow,
   and final Sources/Context lists show only evidence actually used or cited—not
   retrieved-candidate counts. Each singleton receives a stable-ID projection,
   token-limit telemetry, and a cache-aware shared prefix so context stays
   task-isolated without repeating the same evidence. Blank descriptions stop
   the save, and a parseable response can be retried once only after the plugin
   confirms its own prepared evidence is complete. You can also let task prompt
   profiles follow the selected model automatically or choose one manually,
   with better grounding for named artifacts and useful execution detail.

2. **Less repetition and simpler workflows**

   Shared context and facts are reused across task and description steps, and final
   dedup reuses stable IDs to serialize repeated evidence once while keeping
   task-specific semantic signals intact. Same-note source threads can retain
   more than two independently relevant facts when each passes its own checks;
   useful non-action history can contribute only after passing those checks.
   Matching review decisions and
   handoffs remain available when repeated context is merged.
   Local section titles use note and project context by default, so everyday
   captures need less setup. Automatic semantic-index compatibility rebuilds keep
   the last-good index available until a compatible replacement is ready. Settings,
   local time display, and mobile controls are clearer, with more responsive
   layouts, separate result limits, and bounded resource settings. Stale or
   mismatched semantic-routing sidecars rebuild locally from the current index.

3. **Reliable models, references, and sync**

   OpenAI defaults to GPT 5.6 Luna at High reasoning with GPT 5.6 Terra at
   Medium as the same-provider fallback. Gemini uses Gemini 3.5 Flash Lite as
   its generation default and prefers Gemini 3.5 Flash as a distinct
   same-provider fallback; provider, model, and reasoning choices remain
   configurable per operation. A single global AI fallback switch
   controls retries for every provider and operation while preserving saved
   fallback selections when disabled, and local validation keeps fallback
   references distinct from their primary model. Task-reference snapshots and
   semantic indexes upgrade or repair themselves automatically, reuse compatible
   data, and preserve Todoist IDs/OIDs, parent/subtask links, and project
   relationships through moves and swaps. Settings and background persistence
   coalesce adjacent writes, serialize revisions, and recover after a rejected
   save.

4. **Smoother Obsidian experience**

   Mobile-safe indexing, persistence, and settings continue to work across
   desktop and mobile layouts, with more reliable styling on supported Obsidian
   versions.

## What It Uses

- OpenAI by default through the user's own API key, with GPT 5.6 Luna at High reasoning as the primary model and GPT 5.6 Terra at Medium reasoning as the distinct same-provider fallback.
- Gemini through Google AI Studio, with Gemini 3.5 Flash Lite as the primary generation model and Gemini 3.5 Flash as the distinct same-provider fallback when Gemini is selected for an operation.
- OpenRouter with full provider/model slugs (including `openrouter/free`); the settings page can discover the complete accessible chat and embedding catalogs, and each operation can use its own provider-scoped model and fallback.
- Self-hosted OpenWebUI through an HTTPS base URL, using an API key or an explicit email/password login; passwords are discarded after login, and Ollama-compatible embeddings are kept in the OpenWebUI index namespace. Authenticated discovery merges `/api/models` with the OpenWebUI-proxied `/ollama/api/tags` into exact-ID generation and embedding catalogs without direct Ollama access. Generation and embeddings use model-affine lanes: one plugin worker by default, with a per-model same-model call limit of 2 (max 4); extra workers can serve distinct models, while task descriptions follow the selected model limit and model switches and embedding transitions remain sequential/FIFO. Completed SSE-compatible responses use `stream: false`. Context-window detection uses the exact active allocation from the selected model's proxied `/ollama/api/ps` first; `/api/models`, `/ollama/api/tags`, and `/ollama/api/show` remain informational catalog/show metadata, then the manual model setting is the fallback, followed by the configurable unknown default of 16,384 tokens. The manual model editor stays searchable with one model and Auto.
- A local semantic index for vault search, context-aware task descriptions, and compact task-reference retrieval.
- Todoist API access for task creation, updates, and reference reconciliation.
- Optional Cloudflare Email Routing and Workers for the Email-To-Todoist workflow.
- Local OID markers in notes, with Todoist IDs and Todoist task snapshots stored in the plugin's local reference table (to keep things local and avoid having to always do external API calls - this keeps the plugin fast).
- A small local scheduler memory file for accepted task durations, preview edits, schedule order signals, and compact vault context used by Schedule Today's Tasks.
- Markdown prompt files in the vault for reusable AI prompts, summaries, and task-generation workflows.

## Quick Setup

Open `Settings > Semantic Todoist Sync > Setup` (all the details are in there - but summary below)

The setup tab is step-wise with links to open each provider pages in the browser, gives you the field to paste each key or token directly beside the step, and includes validation buttons so you can confirm each connection before moving on. 

1. Add an AI provider key or self-hosted endpoint.
   - Default: OpenAI.
   - Use `OpenAI API keys` to open OpenAI Platform's key page.
   - Paste the OpenAI key into `OpenAI API key`.
   - Click `Test AI`.
   - The Selected AI configuration summary covers Chat, Task generation, Task descriptions, and Embeddings; fallback columns appear only when fallback is enabled.
   - `Refresh` and `Test AI` action rows keep readable intrinsic widths and stack full-width on narrow panes.
   - Optional: use Gemini for selected operations by adding a Gemini key and choosing Gemini in the operation model settings.
   - Optional: add an OpenRouter key, then choose a provider-scoped model such as `openrouter/free` from the grouped operation settings.
   - Optional: add an OpenWebUI HTTPS base URL plus an API key, or use the login control. Insecure HTTP is disabled unless you explicitly enable it for a trusted local endpoint.

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
   - Provider-scoped indexes are stored separately, including OpenAI, Gemini, OpenRouter, and OpenWebUI, so switching providers or embedding models does not overwrite an incompatible index.
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
   - Leave AI-mediated deduplication enabled for the safest automatic merges. Choose its primary and optional fallback explicitly under the `deduplication` operation model settings.
   - Operation model choices are grouped by provider; each operation has an explicit provider/model selection and optional fallback.
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

Task Workflows lets you choose Local (recommended) or AI section titles. Local uses project/purpose/topic/focus frontmatter, then falls back to the note title, folder, or generated task title; it keeps the current syntax and avoids a separate section-title AI request.

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

Mobile paths are covered by simulated iPadOS/iOS validation. Physical-device
testing is still required before claiming real-device support. Background
polling and sync run only while Obsidian is open and the plugin is loaded
because of mobile limits. The scheduler preview uses compact controls on
narrow screens, so you can adjust blocks without relying on desktop
drag-and-drop.

## License

Semantic Todoist Sync is released under the GNU General Public License v3.0. See `LICENSE` for details.
