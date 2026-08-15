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

OpenRouter embedding workflows use `openai/text-embedding-3-small`.

Provider defaults are conservative and adaptable rather than implicit model
profiles. OpenRouter starts with prompt-grounded JSON unless fresh exact-model
discovery supports a native response schema. Open WebUI/Ollama starts with a
prompt-grounded completed-object path unless authoritative discovery supports a
native structured response. Exact provider/model profiles may refine carrier,
streaming, pacing, or output handling only after validation; stale, missing, or
ambiguous metadata never enables an optional provider feature.

OpenRouter defaults to concurrency 10 and enforces a cap of 16. A separately
run benchmark uses a cap of 5. Open WebUI defaults to one worker. These are
scheduling controls, not model-quality claims.

All provider-visible generation, embedding, and native web-search inputs use a
local preflight estimate below 16,000 tokens. The estimate is an admission and
batching safeguard, not a provider-token guarantee. Provider-reported usage,
when available, remains the post-dispatch observation.

Gemma4 has no model-specific output-token ceiling. Its output allowance is
bounded only by the current discovered context window and the shared workflow
safeguards.

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

### Compatibility improvements in 0.8.18

- Version `0.8.18` adds conservative, capability-driven OpenRouter and Open
  WebUI defaults plus identity-scoped model profiles across OpenAI, Gemini,
  OpenRouter, and Open WebUI.
- Optional native provider features are enabled only when fresh exact-model
  capability evidence supports them; otherwise the compatible default carrier
  remains in use.

## Links

- [Changelog](CHANGELOG.md)
- [License](LICENSE) — GNU General Public License v3.0
