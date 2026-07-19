# Changelog

## 0.7.15

- Separated semantic note content from provenance when building embeddings, keeping scoped task references eligible without letting path metadata dominate matching.
- Required exact task-scoped historical facts in descriptions while omitting competing optional history after the relevant evidence is selected.
- Reduced description input while preserving grounded execution detail; both Luna/High and Terra/Medium provider-equivalent checks produced 6/6 accepted descriptions.

## 0.7.14

- Kept same-line marker context authoritative and grounded for its task while requiring neighboring lines to pass semantic admission before they are included.
- Added model-selectable Default, Luna, and Terra prompt-only profiles with Auto and Manual settings; profile guidance remains separate from worker and runtime transport.
- Kept irrelevant history optional, including when upstream materiality classifies it as useful; both July 6 provider-equivalent testers produced 6/6 accepted descriptions.

## 0.7.13

- Added adaptive, request-relative trimming for weak optional semantic evidence after protected context is reserved, preserving fused retrieval telemetry without lexical or note-specific rules.
- Tightened description acceptance so each description must bind at least one exact-scope execution detail beyond the title or requested action; action-only descriptions now fail safely rather than being accepted.
- Provider-equivalent Luna and Terra validation generated six tasks and six accepted descriptions with zero failures.

## 0.7.12

- Kept semantic evidence scoped to each generated task, so neighboring tasks do not share unrelated context.
- Let structurally verified current-note context enrich only its matching task without lexical or title heuristics.
- Carried selected semantic context and its supporting metadata through description generation.
- Restricted descriptions to validated task-local facts and citations; source lists now include only evidence cited in the final narrative.

## 0.7.11

- Task-reference snapshot and manifest publication now handles Obsidian adapters that reject rename-over-existing by using a verified stable write with rollback, so task creation and note sync do not fail with destination-already-exists errors.
- Incremental semantic note updates now atomically replace the complete current task-reference projection, allowing multi-note moves and swaps to converge without incremental-integrity retries while preserving Todoist IDs, OIDs, subtask parent edges, and unchanged embeddings.

## 0.7.10

- Closed shared description evidence and fact tables over each task's referenced material, with a conservative full-table fallback when closure is uncertain, reducing repeated provider-equivalent input while preserving task-local grounding.
- Clarified prompt field contracts and sentence-end citations, including numeric citation de-duplication.
- Promoted already-selected, same-scope semantic reviewer and handoff history when its material contribution changes the current action, and validated every resulting material fact sentence.
- Preserved independent dimension source reservations through final evidence fusion and kept current task/source handoffs intact.

## 0.7.9

- Removed the partially supported `scrollbar-width` declaration for compatibility with Obsidian 1.4.5.
- Replaced the rejected custom artifact-attestation path with exact tag-to-release asset verification; no runtime behavior changed.

## 0.7.8

- Added shared model-neutral task and description rules for phase shape, source-relative dates, task-local IDs, and current/history authority.
- Passed selected task-local priority fact content directly to descriptions in order, so useful context is stated and bound in detailed narratives without changing retrieval/admission or adding calls.
- A six-task live validation with Terra/Medium and Luna/High produced 6 tasks and 6 accepted descriptions with exact phrase/date/current-history semantics, embedding-only network use, and zero Todoist writes.

## 0.7.7

- Made section titles default to deterministic local generation from already-loaded frontmatter, note title, containing folder, and generated task context, while retaining configurable AI mode and the existing section-title syntax. The default workflow removes the separate section-title model call and its context cost.

## 0.7.6

- Improved semantic task-context selection so current source statements, exact terminology, historical note threads, and task-local evidence stay bound to the right work.
- Reduced description-request serialization by 8.06% losslessly, keeping the complete task-local evidence needed for grounded descriptions.

## 0.7.5

- Removed fixed output-token ceilings and special output-limit retry machinery from task and description requests; ordinary success uses one provider request with the strict schema and complete bounded context.
- Strengthened description prompts so concise briefs retain every materially useful task-local fact and expand into multiple natural sentences when the evidence supports multiple execution dimensions.

## 0.7.4

- Corrected release metadata and root/testing/shareable mirror alignment, and removed unsupported CSS selectors/declarations for Obsidian compatibility; no runtime logic changed.

## 0.7.3

- Republished the 0.7.2 code with correct Obsidian GitHub Release packaging and verified `main.js`, `manifest.json`, and `styles.css` assets; no runtime behavior changed.

## 0.7.2

- Kept device-local display times consistent across task, scheduler, and activity views.
- Simplified desktop and mobile settings into six focused groups, while removing plugin-defined email, chat, and context character caps and retaining bounded resource and provider limits.
- Added task-reference snapshot/index fingerprint alignment: durable snapshot writes queue a coalesced task-reference-only repair, reuse unchanged embeddings, persist alignment metadata after successful saves, and recover promptly on startup without rebuilding all vault notes.
- Preserved the GPT-5.6 Terra Medium primary and GPT-5.6 Luna Medium fallback defaults, and reduced repeated context serialization through shared evidence.

## 0.7.1

- Redesigned task and description generation around semantic-index evidence so
  meaning, current-source authority, task history, recency, and open-work
  continuity determine context instead of lexical heuristics that could mistake
  shared wording for shared intent.
- Admitted an exact current/open canonical task reference for its matching
  structured scope without requiring a redundant history lane, while same-title
  non-identities and historical/non-current rows retain the existing independent
  support gate; no lexical title fallback was added.
- Shared immutable evidence and facts by exact stable ID across generation
  phases, removed the redundant global 16-record catalog cap, and retained
  complete selected task-local context with bounded retrieval, deduplication,
  cache reuse, and mobile-safe yielding.
- Kept descriptions natural and source-grounded with citations restricted to
  accepted task evidence. Instructions targeting an exact phrase or object now
  remain scoped to that phrase or object rather than becoming blanket bans.
- Made duplicate outcomes exhaustive, preserved identity while refreshing
  compatible same-title subtasks, and isolated description failures so valid
  sibling tasks can continue.
- Added a safely cloned semantic-retrieval cache that invalidates on index,
  provider, model, settings, query scope, or task-reference changes.
- Normalized the shared task/description prompt without losing evidence: exact
  text and provenance serialize once, stable-ID references reuse cached records,
  later task-selected evidence remains complete, and the initial cached prefix
  stays byte-identical across both phases.
- In a six-task live-vault A/B, estimated task-generation input fell from
  68,077 tokens to 32,908 (-51.7%) and description input fell from 151,260 to
  60,726 (about 60.0%), with the same 121,061-character prefix and hash reused.
- GPT-5.6 Terra at Medium reasoning produced all six tasks and descriptions;
  plugin validation accepted 6 and failed 0. Exact-phrase semantics, named
  reviewer handoffs and history, sentence-end citations, zero Todoist writes,
  and zero provider-generation API calls all passed.
- Changed the default OpenAI primary model to `gpt-5.6-terra` with Medium reasoning and the same-provider fallback to `gpt-5.6-luna` with Medium reasoning.
- Migrated only the exact legacy OpenAI default model pair and exact legacy available-model list; legacy provider-default reasoning values move to Medium while custom models and reasoning settings remain preserved.
- Added focused regression coverage for default selection, legacy migration preservation, fallback reasoning, compliant workflow traversal, and intentional blocking before Todoist mutation.

## 0.6.39

- Added configurable required-action hashtags for notes, defaulting to `#todo`, with one task tree required for every distinct marked action while repeated references to the same action can be grouped.
- Kept required-action hashtags as minimum coverage rather than an exclusive task list, so the full note and relevant semantic-index context still surface subtly phrased user-owned work.
- Improved first-pass task and description prompts with exact marked-action scope and task-specific semantic evidence, preventing neighboring same-note topics and internal evidence labels from leaking into descriptions.
- Redesigned generation as a context-first workflow: one bounded source/marked-action/adaptive/semantic context bundle is retained after task structure, then section-title and one batched description call run concurrently.
- Shared one strict workflow schema, stable system instruction, explicit GPT-5.6 cached-prefix breakpoint, and `semantic-todoist-task-workflow` cache key across the three phases; Medium reasoning is the baseline and Gemini remains provider-compatible without OpenAI cache controls.
- Made every blocking description issue fatal before Todoist mutation: missing or duplicate indexes, empty/short/malformed, ungrounded, action-misaligned, incomplete, and cross-topic descriptions no longer trigger AI repair or deterministic fabrication.
- Recast descriptions as standalone, detailed execution briefs that preserve current state, audience/reviewer needs, criteria, dependencies, timing, and supported links without cross-task or meta completion/result narration.
- Allowed directly relevant current semantic-index evidence to enrich non-sparse sources while preserving primary-source authority and task isolation, with deterministic fatal checks for forbidden description style.
- Added regressions for custom hashtags, repeated and distinct marked actions, subtle unmarked actions, same-note evidence isolation, malformed title prefixes, nonfatal description checks, and a single generated action-items heading.

## 0.6.38

- Made generated task titles preserve the source-supported document, program, person, decision, deliverable, review focus, or current stage needed to distinguish and act on the work.
- Expanded description generation to retain multiple useful task facts when available, including current status, rationale, special review focus, criteria, stakeholder input, dependencies, and handoffs, without repeating subtask actions or generic completion language.
- Relaxed task-specific semantic evidence selection enough to admit strongly matching shared program context while continuing to reject context anchored to a neighboring task.
- Added a fast local evidence-detail gate that uses the existing single targeted repair pass only when a description omits meaningful facts already present in its bounded evidence bundle.
- Limited each task's source list to its primary note and the context notes actually cited in that task's narrative, with compact citation renumbering instead of attaching every plan-level source.
- Preserved safe grounded narratives and added an extractive task-evidence fallback so local validation does not replace an actionable description with a source-only block when useful evidence remains.
- Validated email and note generation against the live testing vault with intercepted Todoist writes, including task titles, descriptions, subtasks, labels, semantic context, source attribution, duplicate screening, and payload hygiene.

## 0.6.37

- Stopped same-batch duplicate checks from treating a shared note, person, Inbox section, label, or semantic context as sufficient duplicate evidence when generated tasks have different actionable scopes.
- Added task-title identity checks, conflicting program-identifier detection, and sequential-action separation so BEAP, ESTMTA, GFP/PDF, Performance Goals delivery, and meeting-booking work remain distinct.
- Recognized `Book`, `Develop`, and other common concrete verbs as valid leading task actions, preventing malformed local repairs such as `Send Develop ...`.
- Preserved grounded task titles when only their descriptions fail local validation; unsafe narrative text is removed and verified source links are retained instead of dropping the task.
- Added the July 9 multi-topic touchbase as a generic regression fixture and verified all six main tasks, including the Aditi funding-opportunities-page review and Sophie handoff, plus the ESTMTA subtask continue without same-batch flags, merges, or AI duplicate calls.

## 0.6.36

- Prevented task-local quality failures from cancelling an otherwise valid generated batch after duplicate review.
- Added local recovery for unsupported description sentences and unambiguous noun-only parent titles, while keeping unsupported facts and redundant child restatements out of Todoist.
- Isolated irreparable generated items individually and continued validated tasks, with a concise notice describing how many items were omitted.
- Kept the full-batch stop only when no safe task remains or a remaining task still has a blocking local quality issue.
- Stopped treating supported Markdown link labels and generic Office document artifacts as unsupported people or named entities.

## 0.6.35

- Reworked generated Todoist descriptions as concise task-specific narratives instead of mandatory intent, purpose, and expected-outcome templates.
- Rejected and locally removed prompt-like boilerplate about requested outcomes, source-supported steps, validation, and generic completion status before deciding whether an AI repair is needed.
- Kept concrete steps in subtasks rather than repeating them in descriptions, and removed dedicated completion-goal fields from description prompts.
- Used matching semantic-index notes to fill context explicitly missing from sparse source notes while preserving primary-source authority, recency preference, citations, and strict task scope.
- Reduced description input tokens by dropping near-duplicate primary-source and supporting-note excerpts, retaining one bounded task evidence bundle, and preserving default-enabled stable-prefix prompt caching without adding AI calls.

## 0.6.34

- Reduced description-generation input usage by removing repeated full-source and broad context payloads while retaining compact task-specific source, semantic-index, request-coverage, citation, and workflow evidence.
- Kept task generation and descriptions on the selected primary model reasoning effort, while optionally capping simpler scheduler and policy calls at low reasoning.
- Added an independent AI duplicate-detection reasoning setting, defaulting to Medium, while automatic duplicate checks continue to use the configured chat fallback model and confirmed updates continue through primary-model task generation.
- Kept the final quality report entirely local, reduced task-tree repair to one targeted AI call at most, strengthened first-pass action-binding instructions, and corrected unsupported labels and obvious priority mismatches locally before considering AI repair.
- Added default-enabled, configurable GPT 5.6+ OpenAI prompt caching for stable schemas and system instructions, using explicit breakpoints so changing note, email, vault, and Todoist context does not trigger dynamic-payload cache writes.
- Added local per-operation AI token-usage diagnostics for OpenAI and Gemini responses, including cache reads and GPT 5.6+ cache writes, without recording prompt or response content.

## 0.6.33

- Reflowed settings tabs on desktop so every category remains visible without being cut off, while retaining horizontal touch scrolling on narrow mobile panes.
- Expanded desktop dropdown controls to use the available settings width and removed project-select ellipsis clipping, with full-width stacked controls preserved for mobile and iPadOS layouts.

## 0.6.32

- Added independent primary and fallback reasoning controls for configured AI chat models, preserving provider defaults unless an explicit level is selected.
- Added provider-specific request mapping: OpenAI reasoning models receive `reasoning.effort`, while Gemini 3 models receive `thinkingConfig.thinkingLevel`; unsupported model families safely remain on provider defaults.

## 0.6.31

- Passed task-specific local action, object, recipient, condition, and decision requirements into the first description-generation call instead of relying only on post-generation validation.
- Reduced worst-case serial AI work by limiting task-tree repair to two focused attempts and description repair to one attempt before the grounded deterministic fallback, while clean task trees continue without any repair call.
- Added a local latency regression benchmark; full request-signal extraction and coverage validation averages under one millisecond per task tree on the development test system.

## 0.6.30

- Expanded local task-request analysis to preserve passive requests, staged work, document-specific criteria, named decision alternatives, decision criteria, requested output formats, and deliverable-recipient bindings before AI repair is considered.
- Strengthened task hierarchy and description validation so generated tasks retain source-supported intent, purpose, dependencies, constraints, exclusions, expected outcomes, and task-specific semantic-index evidence without borrowing details from neighbouring tasks.
- Improved local-first duplicate handling and post-match task generation so duplicate detection does not overwrite richer generated task details, ambiguous candidates stay out of Todoist payloads, and same-batch or existing-task updates continue through the regular grounded generation workflow.
- Unified and hardened Email-To-Todoist and Notes-To-Todoist processing for actionability, chronology, ownership, descriptive links, source-list formatting, unique email-note titles, and timezone-consistent timestamps.
- Kept provider-aware model selection configurable with GPT 5.4 and GPT 5.4 Mini as the OpenAI primary/fallback defaults and Gemini 3.5 Flash and Gemini 3.1 Flash Lite as the Gemini defaults.

## 0.6.29

- Improved semantic context retrieval with project-aware history and task-query scoping, duplicate-context collapse, and updated embedding content keys so changed index content is refreshed safely.
- Grounded generated task descriptions in task-specific source and context evidence, while preserving source links and concise citations.
- Made task deduplication faster and more conservative: clear local matches are resolved locally, credible ambiguities are flagged in chat for review, and AI confirmation is limited to unresolved strong matches without allowing it to rewrite task fields.

## 0.6.28

- Preserved wording from note and email links when building Todoist descriptions, converting bare URLs into descriptive Markdown hyperlinks instead of exposing direct links.
- Removed the repeated opening H1 from Email-To-Todoist log notes so the filename remains the document title and the note begins with workflow metadata.
- Validated the installed plugin against the live testing vault's semantic index, task-reference snapshot, email/note generation paths, and AI-mediated deduplication path.

## 0.6.27

- Updated Email-To-Todoist so forwarded emails are treated as intentional task-capture requests and soft review language can still create a useful review or follow-up task.
- Added an email-only empty-result fallback for draft/document, feedback, reply, and follow-up threads so the workflow does not silently create no tasks when the AI returns an empty task list.
- Fixed duplicate email log note titles by matching the visible note title to the unique filename, and normalized email workflow timestamps to `YYYY-MM-DD - HH:MM:SS (TZ)` in the user's device timezone.

## 0.6.26

- Fixed generated Todoist description formatting so source lists stay as multiline `Source List`, `Primary Note`, and `Context Notes` blocks instead of collapsing into one line.
- Protected raw URLs, Obsidian/Todoist links, and Markdown links during context citation insertion so numbered citations are added outside links instead of splitting link targets.

## 0.6.25

- Added an off-by-default External MCP Bridge setting that writes only small pointer files and an MCP server access profile for a separate Obsidian MCP server, leaving the existing semantic index shards, Todoist task cache, and local reference table as the only data sources.
- Aligned Email-To-Todoist duplicate prevention with Notes-To-Todoist by assigning target project context before dedupe and checking live open Todoist tasks before creating new email tasks.
- Improved generated task description citation fallback so context-note summaries can be matched per sentence while preserving the existing source list format.

## 0.6.24

- Hardened automatic same-provider fallback selection so the fallback model is never the same model as the primary, including migrated settings and AI-mediated deduplication defaults.

## 0.6.23

- Set OpenAI defaults to GPT 5.4 primary with GPT 5.4 Mini fallback, documented Gemini defaults as Gemini 3.5 Flash primary with Gemini 3.1 Flash Lite fallback, and kept settings model selectors scoped to the preferred AI provider.

## 0.6.22

- Refreshed README release notes so What's New summarizes the latest three updates and the README captures the deduplication and task-generation improvements since 0.6.14.

## 0.6.21

- Calibrated task deduplication so same-project richer same-action tasks, parent/subtask restatements, and same-title cross-parent tasks can be AI-reviewed while distinct progress steps, component subtasks, and different-project tasks stay separate.

## 0.6.20

- Fixed email and note task generation so polite draft/document review requests for comments, tracked changes, accuracy verification, or gap confirmation are treated as actionable tasks even when sent to multiple recipients.

## 0.6.19

- Kept duplicate matching local-first, required AI-mediated confirmation for all task merges, defaulted automatic dedupe model selection to the chat fallback model, and made AI-off dedupe post possible duplicate candidates to chat for manual review without merging tasks.

## 0.6.18

- Broadened duplicate validation across multiple task domains, taught dedupe to ignore generic email-routing boilerplate, and added AI-mediated merge coverage for review/decision, agreement follow-up, and inbox-impact task patterns.

## 0.6.17

- Required duplicate task merges to be AI-mediated through a task-generation-shaped merge step so likely duplicates are confirmed and combined with note/email context before updating existing tasks or collapsing same-batch tasks.

## 0.6.16

- Collapsed duplicate tasks generated in the same task-creation batch before Todoist creation while preserving useful description, due date, label, priority, and subtask details.

## 0.6.15

- Improved local task deduplication so same-project tasks with shared action context, descriptions, and subtask evidence can match even when their titles use different wording.

## 0.6.14

- Removed the separate "Use stronger model when locally justified" setting so AI requests follow the configured primary model and only use the fallback model for same-provider transient failures.
- Added a preferred AI provider selector in Setup so OpenAI and Gemini keys can both be saved without mixed-provider model choices.
- Fixed the References tab rebuild controls so long explanatory text wraps cleanly and the Rebuild / Recover IDs buttons no longer overlap it.

## 0.6.13

- Added local-first task deduplication for Notes-To-Todoist and Email-To-Todoist so confident matches reuse existing open Todoist tasks instead of creating duplicate work.
- Added a Task Deduplication settings tab with conservative matching controls, editable merge policy, optional AI-assisted ambiguous matching, and separate chat policy history while keeping runtime logs in Activity.
- Hardened the local reference table so multiple note OIDs can safely point to the same Todoist task and still sync through the existing local snapshot without extra API calls.

## 0.6.12

- Rebalanced sidebar chat answers so vault note content is treated as the primary evidence, with existing Todoist tasks shown as supporting action links instead of driving every response.
- Tightened the mobile sidebar so relevant notes can show four compact chips across two rows without clipping and the main controls take up less vertical space.

## 0.6.11

- Changed the default AI setup to OpenAI, using GPT 5.4 Mini as the primary model, GPT 5.4 as the same-provider fallback/strong model, and `text-embedding-3-large` for semantic vault indexing.
- Added an off-by-default strong-model gate that locally scores broad, recent/conflicting, multi-project, and action-heavy requests before using the configured stronger model, without making an extra AI routing call.
- Wired the local model gate into chat, task generation, task descriptions, description improvement, and scheduler duration estimation while keeping routine scheduler previews on the primary model unless escalation is clearly justified.
- Hardened the Todoist References settings table so wide columns keep their minimum widths and scroll horizontally instead of collapsing into unreadable one-character columns.

## 0.6.10

- Improved dark-mode sidebar chat links so embedded note and task links are easier to read while still standing apart from normal response text.
- Updated relevant-note chips to show up to four notes in a compact two-column layout that adapts to the sidebar width.
- Cleaned up settings tabs so the selected tab stays visible while scrolling and AI model controls live in one Setup section instead of being duplicated across Basic and API Access.
- Tightened the Todoist References table so all columns have stable widths, long cells use ellipsis, and Path/Status no longer collapse into vertical text.

## 0.6.9

- Hardened Todoist sync reconciliation so completed tasks are preserved as checked tasks in Obsidian instead of being removed when they disappear from Todoist's active-task snapshot.
- Split completed-task preservation, active-task deletion, note-side removal, and Todoist metadata updates into separate sync outcomes so the activity log can report them more clearly.

## 0.6.8

- Kept the Schedule Today's Tasks preview from jumping while shortening, lengthening, or resizing a task by preserving the modal and timeline scroll position around the edited task.

## 0.6.7

- Hardened Schedule Today's Tasks drag-and-drop so moved tasks snap to the configured time grid and only displace nearby blocking tasks instead of repacking the day from the top.
- Folded swapped-out tasks into the existing Removed from today section so displaced and manually removed tasks can be restored from one place.

## 0.6.6

- Updated Schedule Today's Tasks suggestions so eligible tasks can show Add in when they fit an open preview window, while Swap in remains available when another scheduled task needs to move out.
- Added a scheduler setting for the Add-in flexible time window and made swap rationale name the scheduled task that would be moved out.

## 0.6.5

- Tightened Schedule Today's Tasks preview controls by stacking move and duration button groups vertically while keeping the remove button separated.

## 0.6.4

- Polished the Schedule Today's Tasks preview controls by grouping move arrows, grouping duration adjustments, and separating the remove action as a round button.

## 0.6.3

- Preserved completed Todoist tasks in their original Obsidian notes by syncing completion back as checked markdown tasks instead of treating them as deleted.
- Kept completed Todoist tasks out of Schedule Today's Tasks planning and fuzzy relinking so finished work stays as a record without reappearing as active work.
- Added a conservative cache cleanup guard so previously completed note tasks are not removed if a full Todoist snapshot is temporarily unavailable.

## 0.6.2

- Expanded Schedule Today's Tasks preview suggestions from five to the top ten swap candidates so more high-priority unscheduled work can be reviewed before applying a plan.
- Integrated semantic-index context into scheduler priority selection as well as duration estimation, so Todoist priority, deadlines, recency, scheduler memory, and relevant vault context all inform the proposed day.
- Added 15-minute duration stepping while still respecting the configured minimum task block, and scaled the preview timeline to the same minimum block setting.
- Added scheduler memory policy support for quick follow-up, discussion, meeting-planning, coordination, and collaboration tasks so those items stay capped to the configured minimum block by default.
- Kept Todoist as the scheduling source of truth by applying approved due datetimes and duration fields immediately, then relying on normal note sync to update Obsidian.
- Refreshed README and scheduler documentation for the integrated scheduler workflow, preview behavior, semantic context use, Todoist writeback, and mobile-friendly controls.

## 0.6.1

- Added Schedule Today's Tasks, a Todoist-first daily scheduler that previews today's highest-priority overdue and soon-due work in compact time blocks before writing anything back to Todoist.
- Added local scheduler memory outside plugin settings so accepted durations, manual preview order changes, promoted suggestions, bumped tasks, Todoist priority, and compact vault context can improve future planning without triggering automatic rescheduling.
- Added mobile-friendly scheduler preview controls, suggested swaps for up to five unscheduled tasks, moved-out task tracking, lunch/workday constraints, undo support, and next-workday continuation subtasks for oversized work.
- Added `Schedule today's tasks` as a seeded vault prompt action using `action: schedule-today`; scheduler settings remain authoritative while the prompt coordinates duration-estimation guidance.
- Hardened same-provider AI fallback so automatic Gemini fallback chooses one usable text model, prefers Gemini 3.1 Flash Lite behind Gemini 3.5 Flash, skips known unavailable/non-text models, shows the primary plus automatic/manual fallback choice in settings, and lets Schedule Today continue with local duration estimates if AI duration estimation is unavailable.
- Clarified the sidebar toolbar so `Ask` is only for chat, `Tasks` directly generates note tasks, the compact `Run:` dropdown plus `Run` handles scheduler and prompt actions, and the active-note chat state lives in the note picker instead of a separate sidebar block.
- Updated README documentation to describe the scheduler workflow, local scheduler memory, semantic-index performance work, and current Todoist continuity features.

## 0.5.23

- Updated the README to use a more casual, plain-language overview and focus the What's New section on the three biggest functional changes.
- Added note-created-time semantic ranking so frontmatter such as `created: ["2026-05-20 13:43"]` can help newer same-topic notes win when context conflicts.
- Added a setting to disable note-created-time parsing and rely only on file metadata for semantic freshness when users want fewer note-header checks.
- Updated sidebar task references so Todoist links use the task title as linked text, and added an optional chat footer when an AI fallback model answers.

## 0.5.22

- Removed the duplicate Recent log summary from Activity settings and replaced it with one selectable Activity Log Console.
- Expanded the Activity Log Console to show the full retained local log instead of only the latest 12 entries.
- Added local workflow-start entries for AI work, semantic index rebuild/update, email processing, note sync, reference rebuilds, and semantic index purges so the console better matches plugin activity without logging every progress tick.

## 0.5.21

- Reused unchanged semantic-index chunk embeddings during full rebuilds and changed-note updates so ordinary edits only embed new or changed chunks.
- Prioritized the active note, other open notes, and recently modified notes during full rebuilds so high-value context is refreshed before older background content.
- Kept full rebuilds on a working RAM copy until the rebuilt index is ready, preserving the active index for search/chat while background indexing continues.
- Added bounded concurrent Gemini embedding requests for document batches to reduce rebuild and incremental-update wall time without increasing UI blocking.
- Refreshed cached chunk modified times when file timestamps change but chunk text does not, reducing repeated stale-note indexing.

## 0.5.20

- Deferred full semantic-index RAM hydration until idle or first use, while loading a small path-metadata snapshot at startup so Obsidian can open without parsing every shard.
- Rebuilt semantic index shard bodies from pre-serialized chunk strings, reducing repeated index-save serialization from multi-second CPU work to short yielded batches.
- Restored the semantic index shard ceiling to 4.5 MB while keeping sync-safe sharding and idle legacy-shard optimization.
- Improved context-result diversity so chat and task-description context prefer relevant unique notes before adding multiple chunks from the same note.
- Added distinct status reporting for semantic index loading and shard optimization instead of labeling all background index work as vault indexing.

## 0.5.19

- Reduced vault-indexing UI freezes by yielding during full semantic-index reads, queued note re-indexing, and embedding batches while showing indexing progress.
- Aligned inline context-note citations with the rendered Todoist description source list, skipped primary-source duplicates, and added a conservative fallback citation when the AI omits a matching `(N)` marker.

## 0.5.18

- Harmonized Email-To-Todoist log notes with the standard note sync workflow by caching full Todoist reference metadata for email-created tasks and immediately reconciling the generated note through note sync.
- Preserved email-created task project, section, label, parent, description, and completion metadata so later Todoist API updates can update the generated note task lines like normal note-created tasks.

## 0.5.17

- Reduced semantic-index startup and save overhead by tracking loaded shard files and cleaning stale shards from the known manifest instead of listing the plugin directory on each save.
- Loaded semantic index shards with bounded concurrency and skipped redundant semantic-index writes when the generated manifest and shard contents have not changed.
- Reduced automatic Email-To-Todoist poll IO by queueing the poll timestamp save instead of forcing an immediate settings write for empty background checks.
- Reduced startup blocking IO by loading task-reference snapshot files in parallel and deferring prompt-template folder seeding until after plugin startup.
- Reduced semantic-index warmup CPU and memory pressure by delaying lighter cache warmups, avoiding duplicate warmups for unchanged index files, avoiding duplicate startup index loads after embedding migrations, and dropping raw shard bodies after parsing.

## 0.5.16

- Reduced sync/index IO by debouncing local activity-log settings writes instead of saving plugin data on every log event.
- Skipped semantic re-embedding when queued file chunks and local Todoist reference chunks are unchanged.
- Prevented automatic background polling, sync, and reference rebuild from starting while another plugin workflow is already active.
- Centralized Todoist task field selection so task creation and update payloads follow the same subtask include/exclude settings with less repeated work.

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
