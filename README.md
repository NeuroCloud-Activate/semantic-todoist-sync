# Semantic Todoist Sync

Semantic Todoist Sync connects the notes you write in Obsidian with the work
you manage in Todoist. Ask grounded questions, turn notes or selected text into
useful tasks and subtasks, keep a traceable copy in Obsidian, spot duplicates,
and plan today's work before changing anything in Todoist.

It is local-first: you choose the AI provider, models, and external services
you want to use.

## What's New

The current 0.8 series makes everyday capture more flexible and more private.

1. **More provider and model choice.**
   Searchable settings cover OpenAI, Gemini, OpenRouter, and local OpenWebUI/Ollama, with per-workflow choices and optional fallbacks.

2. **More grounded output.**
   Search keeps the full index available and uses one provider-neutral check before model choice to filter out action-only false matches. Chat also tidies simple recognized label aliases before checking an answer, so responses stay clearer without changing the original model output.

3. **Smoother everyday control.**
   A clearer sidebar and searchable settings make task capture, scheduling previews, and duplicate review easier to manage.

4. **Model learning that stays useful.**
   Exact-model profiles save carrier and concurrency behavior. Chat only announces material new saves, while AI & Search shows a compact, scrollable list of exact-model operation memories with a Delete button that removes only that memory; the model relearns it next time.

5. **Cleaner presentation.**
   Obsidian no longer reports the `:has` CSS warning.

## Install

- [Install from Obsidian Community Plugins](https://obsidian.md/plugins?id=semantic-todoist-sync)
- [Download the latest release for a manual install](https://github.com/NeuroCloud-Activate/semantic-todoist-sync/releases/latest)

Semantic Todoist Sync works with Obsidian 1.5.0 and newer on desktop, iPhone,
and iPad.

## What it does

- **Search and chat:** Ask questions across your notes with relevant semantic
  context and links back to the source.
- **Notes to Todoist:** Turn a meeting note, project note, or selection into
  main tasks and subtasks. The generated work keeps the requested action,
  people, deliverables, criteria, dates, and dependencies when they are
  present. Descriptions are written as clear, standalone execution briefs.
- **Email to Todoist:** With an optional Cloudflare Worker, forward task-heavy
  emails into the same grounded task workflow.
- **Sync and deduplication:** Keep note tasks and Todoist state aligned, retain
  local references, and review likely duplicates without collapsing distinct
  work.
- **Schedule Today's Tasks:** Preview a practical day from your Todoist work,
  adjust it, and apply or undo the approved schedule.
- **Prompt templates:** Run reusable prompts for summaries, task capture, and
  scheduling from the sidebar or command palette.

## Providers and model choice

The plugin supports:

- OpenAI, with GPT-5.6 Luna at High reasoning as the default generation choice.
- Google Gemini, with Gemini 3.5 Flash Lite as the default generation choice.
- OpenRouter, including full native model IDs such as `openrouter/free`.
- Self-hosted OpenWebUI connected to Ollama.

Each workflow has a searchable provider/model picker. You can choose models
and reasoning levels independently for chat, task generation, descriptions,
and embeddings, then set an optional fallback. Embedding indexes stay tied to
their selected provider and model, so switching providers does not mix
incompatible data.

If OpenWebUI is connected to Ollama, all AI work in this plugin—including
generation, embeddings, semantic search, chat, task generation, and
descriptions—can run locally on your own machine or network. You do not need a
cloud AI provider for that setup. Todoist, OpenAI, Gemini, OpenRouter, and
Cloudflare remain external services and are contacted only when you configure
and use the related workflow.

## Quick setup

1. Open `Settings > Semantic Todoist Sync` and choose an AI provider. Add its
   credential, or configure your OpenWebUI endpoint and sign-in details.
2. Add your Todoist personal token and run the connection check.
3. Choose models in the searchable operation settings. Add a fallback only if
   you want one.
4. Rebuild the semantic index from the setup screen.
5. Optionally configure the email workflow, prompt templates, deduplication,
   or Schedule Today's Tasks.

## Everyday use

Open the sidebar to use `Ask`, `Tasks`, `Index`, or `Run`. The command palette
offers the same actions, plus note sync, email processing, scheduling, and
undo.

For note task capture, use `#STsync` on main tasks and `#STSubSync` on
subtasks. A marker such as `#todo` is a useful signal when writing notes. The
plugin adds local references so later syncs can follow the same work even when
it moves between notes or projects.

Schedule Today's Tasks always opens a preview first. Todoist changes happen
only when you choose `Apply`, and the last applied schedule can be undone.

## Output quality and privacy

- AI-assisted tasks and descriptions are grounded in the current request and
  relevant context, with useful history included only when it helps the work.
- Only content needed for a configured workflow is sent to the provider you
  selected.
- Local semantic indexes, task references, and scheduling memory stay on your
  device and reduce repeat external reads.
- Todoist receives task fields needed for sync only when you use Todoist
  workflows. The optional email flow contacts Cloudflare only when enabled and
  run.
- The plugin does not create a hosted account or require a single AI vendor.

## Model validation snapshot

This final model comparison gave every model the same evidence bundles.
Scores are GPT 5.6 Sol/high judgments of evidence accuracy and actionability, not
provider claims.

| Provider/model | Quality /100 | Passed | Avg input (Tokens) | Avg time | What we saw |
|---|---:|---:|---:|---:|---|
| OpenAI GPT-5.6 Luna high | 95 | 6/6 | ~24.3K | ~42s | Most complete, precise, and grounded; final-evidence chat completed in one call. |
| Gemini 3.5 Flash Lite high | 92 | 6/6 | ~24.5K | ~27s | Close quality and the fastest cloud option; occasionally broader than needed. |
| OpenWebUI Qwen3.5 9B HF | 88 | 6/6 | ~26.5K | ~260s | Strongest local interpretation and broad historical/action coverage; slowest local option. |
| OpenWebUI `gemma4:e4b` thinking | 82 | 6/6 | ~26.5K | ~93s | Reliable and concise after its learned JSON-mode profile, but omitted some useful notes. |
| OpenRouter `tencent/hy3` high | 79 | 6/6 | ~28.7K | ~88s | Strong tasks and descriptions, but chat was broader than the narrow action; one historical concurrent-description recovery is reflected in reliability/input. |
| OpenWebUI Gemma 12B Agentic HF | 74 | 6/6 | ~26.5K | ~144s | Broader chat than E4B, but a task typo and unsupported timing/detail lowered semantic quality; minor wrapper/category repair had little impact. |
| OpenRouter `openrouter/free` | 64 | 6/6 | ~29.1K | ~124s | Dynamic pool completed but was inconsistent; chat needed one sequential retry after a bounded truncation/timeout and returned an over-narrow, mislabeled answer. |
| OpenWebUI Google Gemma4 12B (`gemma4:12b`) | n/a | Could not complete within 300 seconds | ~23.2K attempted* | >300s | A simple test prompt completed in 33.6 seconds and a valid grounded task was produced, but the complete workflow could not finish on the test hardware, so no quality score was assigned. |
| OpenRouter `tencent/hy3:free` | 0 | 0/6 | n/a | 0.5s | Unavailable/404 in the tested catalog; the paid slug worked. |

*Footnote: Avg input is the approximate average total input for a complete
note workflow (chat + task + description across two actual test notes), not a per-call
cap. Scores are GPT 5.6 Sol/high judgments, not provider claims; minor
wrapper/category repairs are reported separately from model quality. The
`gemma4:12b` row shows one attempted workflow plus bounded diagnostics; the
second workflow was not sent because chat and description remained incomplete.
Local OpenWebUI/Ollama tests ran on an NVIDIA RTX 3070 GPU with 8 GB of VRAM;
hardware can materially affect completion time.*

## Links

- [Changelog](CHANGELOG.md)
- [License](LICENSE) — GNU General Public License v3.0
