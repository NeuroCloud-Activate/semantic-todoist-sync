# Semantic Todoist Sync

Semantic Todoist Sync connects your Obsidian notes and Todoist. Search and chat over your vault, turn notes into tasks, keep notes and tasks in sync, and plan your day. It is local-first, and you choose which providers each workflow uses.

## Install

- [Install from Obsidian Community Plugins](https://obsidian.md/plugins?id=semantic-todoist-sync)
- [Download the latest release for a manual install](https://github.com/NeuroCloud-Activate/semantic-todoist-sync/releases/latest)

Requires Obsidian 1.5.0 or later. Desktop, iPhone, and iPad are supported.

## What it does

- **Search and chat:** Ask questions about relevant vault notes and follow links to the source. Internet Search and Deep Research are optional and off by default.
- **Notes to Todoist:** Turn a note, selection, email, or prompt template into tasks, subtasks, and task descriptions.
- **Sync and deduplication:** Keep note tasks and Todoist state aligned while preserving local references and distinct work.
- **Schedule Today's Tasks:** Preview a plan for the day, adjust it, then apply or undo its Todoist changes.

## Providers and models

Choose OpenAI, Google Gemini, OpenRouter, self-hosted Open WebUI connected to Ollama, or a Custom OpenAI-compatible service. Embeddings are chosen separately and stay scoped to their provider and model.

**AI Providers** holds provider connections and credentials. **AI Models** holds the primary, fallback, and embedding choices, with searchable model pickers and a separate embedding validation button. The shipped embedding default is Custom OpenAI-compatible `qwen3-embedding-0.6b-8k:latest`.

### Custom OpenAI-compatible

This provider has the stable ID `customopenai` and uses one API root that you configure. Enter the complete root, including `/v1` when the service requires it; the plugin does not add `/v1` for you. You can set an optional connection title for display. The optional Bearer key is masked, and can be left empty if your endpoint does not need one.

`Allow insecure HTTP` is off by default. Turn it on only to use an explicit plain-HTTP root. Plain HTTP can expose credentials and content on a network you do not trust.

Model discovery shows one role-neutral list, with capability marked `Not reported`. Strict workflows require the server to support `response_format.json_schema`; if it does not, the workflow fails closed.

Custom OpenAI-compatible supports model discovery, chat completions, and embeddings. It does not support web search, the Responses API, streaming, tools, automatic model pulling, multiple endpoints, or provider-specific compatibility features.

## Accounts, costs, and network use

- The plugin has no hosted account of its own. Todoist workflows need a Todoist account and token. OpenAI, Google Gemini, and OpenRouter need a provider account and credential. Self-hosted Open WebUI, Ollama, or Custom OpenAI-compatible can work without an account when the endpoint allows it.
- The plugin is free and accepts no payments or donations. Selected third-party providers may charge for their services.
- Todoist workflows connect to `api.todoist.com`. AI and embedding workflows connect only to the selected provider service. Internet Search and Deep Research are opt-in and use the selected provider's search or research service. Email processing connects only to the optional worker URL you configure. These connections send the request content needed for the workflow.
- Credentials are stored in local Obsidian settings and sent only to their matching service.

## Quick setup

1. In `Settings > Semantic Todoist Sync`, configure a provider connection and its credential or endpoint details under **AI Providers**.
2. Under **AI Models**, choose primary, fallback, and embedding models. Use the separate button to validate the embedding provider.
3. Add your Todoist token and run the connection check.
4. Rebuild the semantic index.

## Everyday use

Use **Ask**, **Tasks**, **Index**, and **Run** from the sidebar. The command palette also has note sync, email processing, scheduling, and undo.

Use `#STsync` on main tasks and `#STSubSync` on subtasks. Required-action hashtags are configurable; `#todo` is the shipped default. These markers are required coverage anchors, but they are not an exclusive filter: clearly actionable, unmarked content in the selected note can still be considered.

Schedule Today's Tasks always shows a preview before you apply changes. You can undo the last applied schedule.

## Output quality and privacy

- Only content needed for the configured workflow is sent to the selected provider.
- Local semantic indexes, task references, and scheduling memory stay on your device. Todoist receives task fields only when you use Todoist workflows.
- The plugin has no hosted account and does not require one AI vendor.
- The plugin does not collect client-side telemetry, show ads, install or update itself or its dependencies, or access files outside your Obsidian vault. Opt-in diagnostics stay local and content-free.

## Top five quality models from completed testing

This table reflects one fixed, completed comparison, not a universal rating or a claim about every setup. Scores are rounded from the published scorecard.

| Rank | Provider | Model | Reasoning | Quality / 100 |
|---:|---|---|---|---:|
| 1 | OpenRouter | `qwen/qwen3.7-plus` | default | 94.2 |
| 2 | OpenRouter | `openai/gpt-5.6-luna` | high | 92.2 |
| 3 | OpenRouter | `deepseek/deepseek-v4-flash-0731` | high | 90.6 |
| 4 | OpenRouter | `xiaomi/mimo-v2.5` | default | 90.0 |
| 5 | Google Gemini | `gemini-3.5-flash-lite` | high | 87.5 |

See the [model-quality benchmark protocol](docs/model-quality-benchmark.md) and [published scorecard](docs/model-quality-benchmark-scorecard-2026-08-09.json) for the scoring approach and full sanitized results.

## Links

- [Changelog](CHANGELOG.md)
- [License](LICENSE), GNU General Public License v3.0
