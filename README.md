# Semantic Todoist Sync

Semantic Todoist Sync connects Obsidian notes with Todoist work. It supports
grounded chat, note or selection to task capture, local references and
deduplication, note/task synchronization, and a preview-first daily schedule.
It is local-first: you choose the AI providers, models, and external services
used for each workflow.

## Install

- [Install from Obsidian Community Plugins](https://obsidian.md/plugins?id=semantic-todoist-sync)
- [Download the latest release for a manual install](https://github.com/NeuroCloud-Activate/semantic-todoist-sync/releases/latest)

The plugin supports Obsidian 1.5.0 and later on desktop, iPhone, and iPad.

## What it does

- **Search and chat:** Ask questions over relevant vault context and follow
  links back to source material. Internet Search and Deep Research are
  request-local, off by default, and retain supporting citations.
- **Notes to Todoist:** Turn a note, selected text, email, or prompt template
  into structured tasks, subtasks, and execution descriptions.
- **Sync and deduplication:** Keep note tasks and Todoist state aligned while
  preserving local references and distinct work.
- **Schedule Today's Tasks:** Preview a practical day, adjust it, then choose
  whether to apply or undo the Todoist changes.

## Providers and model choice

The plugin supports OpenAI, Google Gemini, OpenRouter, and self-hosted Open
WebUI connected to Ollama. Each workflow has a searchable provider/model picker
and can use an optional fallback. Embedding indexes remain partitioned by their
selected provider and model, so incompatible data is not mixed.

Embedding models remain user-selected and provider-scoped. The shipped default
remains OpenAI `text-embedding-3-large`; choosing an OpenRouter embedding model
such as `openai/text-embedding-3-small` creates a separate index identity rather
than silently replacing an index built by another provider or model.

Provider defaults are conservative and adaptable rather than implicit model
assumptions. OpenRouter starts with prompt-grounded JSON unless fresh capability
evidence for the requested model or served route supports a native response
schema. Open WebUI/Ollama starts with a prompt-grounded completed-object path
unless authoritative discovery supports a native structured response. Exact
Open WebUI model profiles may refine carrier, thinking, streaming, pacing, or
output handling only after validation; stale, missing, or ambiguous metadata
never enables an optional provider feature.

OpenRouter defaults to concurrency 10 and enforces a maximum of 16. Open WebUI
defaults to one model-affine worker. Benchmark concurrency is a run-specific
scheduling choice, not a model-quality claim.

All provider-visible generation, embedding, and native web-search inputs use a
local preflight estimate below 16,000 tokens. The estimate is an admission and
batching safeguard, not a provider-token guarantee. Provider-reported usage,
when available, remains the post-dispatch observation.

Current Gemma4 exact-model profiles do not impose a hard model-specific output
ceiling. Actual requests remain bounded by discovered context capacity, shared
workflow safeguards, and any endpoint- or run-specific limits reported by the
provider.

## Quick setup

1. Open `Settings > Semantic Todoist Sync` and choose an AI provider.
2. Add the credential or configure an Open WebUI endpoint and sign-in details.
3. Add a Todoist token and run the connection check.
4. Choose models in the searchable operation settings and rebuild the semantic
   index from the setup screen.

## Everyday use

Open the sidebar to use `Ask`, `Tasks`, `Index`, or `Run`. The command palette
offers the same actions, plus note sync, email processing, scheduling, and
undo.

For note task capture, use `#STsync` on main tasks and `#STSubSync` on
subtasks. Required-action hashtags are configurable in settings; `#todo` is a
shipped default example rather than a hard-coded retrieval rule. Configured
action markers are mandatory coverage anchors, but they are not an exclusive
source filter: clearly actionable unmarked content in the selected whole note
is also examined. Normal note capture has no note-wide task cap; an explicitly
selected single-task mode is the intentional exception.

Schedule Today's Tasks always opens a preview first. Todoist changes occur only
after you select `Apply`, and the last applied schedule can be undone.

## Output quality and privacy

- AI-assisted tasks and descriptions use the current request and relevant
  context. Only content needed for the configured workflow is sent to the
  selected provider.
- Local semantic indexes, task references, and scheduling memory stay on the
  device. Todoist receives task fields only when you use Todoist workflows.
- The plugin does not create a hosted account or require a single AI vendor.

## Top five quality models from completed testing

This ranking retains only configurations marked `completed` with all expected
rendered outputs in the published sanitized scorecard. It reflects the retained
completed evidence for that fixed comparison, not a universal model rating,
release-readiness statement, or claim about the current plugin state. Scores
are rounded to one decimal from the published scorecard.

| Rank | Provider | Model | Reasoning | Quality / 100 |
|---:|---|---|---|---:|
| 1 | OpenRouter | `qwen/qwen3.7-plus` | default | 94.2 |
| 2 | OpenRouter | `openai/gpt-5.6-luna` | high | 92.2 |
| 3 | OpenRouter | `deepseek/deepseek-v4-flash-0731` | high | 90.6 |
| 4 | OpenRouter | `xiaomi/mimo-v2.5` | default | 90.0 |
| 5 | Google Gemini | `gemini-3.5-flash-lite` | high | 87.5 |

For the scoring approach and the complete sanitized aggregate, see the
[model-quality benchmark protocol](docs/model-quality-benchmark.md) and its
[published scorecard](docs/model-quality-benchmark-scorecard-2026-08-09.json).

### Optimizations in 0.8.21

- Fixed remaining selector usability regressions in primary/fallback model controls:
  - typed search input no longer gets overwritten by the selected label after user typing,
  - query text stays local to the search box until an explicit model is selected,
  - and minimum-3-character matching checks full provider/model text as before for dense OpenRouter/OpenAI/OpenWebUI catalogs.
- Confirmed selector lists are still grouped by provider and remain scrollable through long catalog lengths.

### Optimizations in 0.8.20

- Settings model pickers now keep their behavior consistent across all primary/fallback and operation contexts:
  - both pickers are searchable from the selected provider list,
  - popup lists remain scrollable with dense long catalogs,
  - and query typing preserves the active filter when opening via typing or arrow-key navigation.
- Model selection remains provider-scoped in picker rows, so the configured primary/fallback selection set matches the active provider family used for each role.

### Optimizations in 0.8.19

**Task quality and scope safety**

- Whole-note capture now treats configured required-action markers as mandatory
  coverage anchors rather than an exclusive filter. Clearly actionable unmarked
  sentences remain eligible, and the legacy per-note main-task cap is no longer
  applied. Context preflight and the configured per-task subtask limit still
  provide operational bounds.
- Each detected action is generated from an isolated source scope. Scope
  discriminators catch sibling-action substitutions and identical normalized
  outputs across different actions; one bounded recovery is allowed when the
  shared request budget remains, otherwise the conflict stays explicit.
- Task generation preserves exact actors, artifacts, conditions, timing, and
  explicit urgency. Deterministic priority correction and narrowly admitted
  structural repair can fix safe local issues without silently broadening the
  requested work.
- Task descriptions use compact singleton, task-local evidence ledgers with a
  cacheable shared prefix. They exclude stale or sibling work, avoid filler and
  source-title narration, and bind only facts actually stated. Unused canonical
  references can be removed or fixed deterministically without rewriting the
  model's prose; supplied context is guidance, not a fact-reproduction checklist.

**Retrieval and request efficiency**

- Local semantic routing adds an indexed lexical seed path, bounded top-K
  handle selection, revision-scoped caches, and source-thread corroboration so
  the plugin does not need to rescan every compatible chunk for each query.
- Eligible Open WebUI queries can use the configured local embedding model as a
  live ranking handle. Query vectors are identity-checked, deduplicated, cached,
  and batched within the same provider-input safeguards; indexed handles remain
  the fallback when a live query embedding is unavailable or ineligible.
- Generation, embeddings, and native web-search requests receive a local
  preflight below 16,000 estimated input tokens. Embedding batches split or stop
  before that boundary, while generation output allowances remain derived from
  the discovered context and operation rather than a Gemma-specific ceiling.
- Every logical generation lineage shares one budget of two provider dispatches:
  the initial request plus at most one additional request across carrier,
  transient, fallback, and workflow recovery paths. Deterministic parsing and
  normalization do not consume that budget.

**Provider compatibility and reliability**

- OpenRouter capabilities are accepted only from fresh model metadata; stale
  metadata falls back safely, and `openrouter/free` is treated as a dynamic
  served route rather than one fixed model identity. Free routes keep bounded
  rolling-rate admission, while paid-route limits remain provider-managed.
- Open WebUI uses conservative completed-object defaults and exact-model
  compatibility profiles where validation supports different thinking,
  streaming, schema, cooldown, or deadline behavior. Gemma4 E4B disables native
  thinking, uses completed delivery, and retains the provider-native schema for
  chat while task and description calls use prompt-grounded JSON.
- Open WebUI response handling now covers completed JSON, native NDJSON, and
  SSE. Error envelopes returned with HTTP 200 are classified and sanitized as
  provider failures instead of being accepted as model output or mislabeled as
  missing content, and oversized response bodies are rejected before parsing.
- Provider/model/operation-specific focus guidance supplements the shared
  schema contract for OpenAI, Gemini, OpenRouter, and Open WebUI without making
  unsupported transport assumptions for every provider.
- Global task-insertion and immediate-sync settings are authoritative over
  prompt-template defaults, preventing a template from enabling note or Todoist
  writes that the user disabled globally.

## Links

- [Changelog](CHANGELOG.md)
- [License](LICENSE) — GNU General Public License v3.0
