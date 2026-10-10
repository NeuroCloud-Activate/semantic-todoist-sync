# Semantic Todoist Sync

Your Obsidian notes and your Todoist tasks, finally working together.
Ask about your notes, turn them into clear tasks, and plan today from what you already wrote.
See what's new in the [Changelog](CHANGELOG.md).

## Why you'll love it

- **Ask your notes anything** - Type a question and jump straight to the note it came from,
  so you stop hunting through folders.
- **Turn notes into tasks** - Turn a note, a selection, an email, or a saved prompt into tasks and subtasks
  with clear descriptions that point back to your own notes.
- **Email into Todoist** - Send an email to your own queue, even one with attachments or images,
  and get tasks whose descriptions cite related notes from your vault.
- **Stay in sync without doubles** - Note tasks and Todoist stay matched, repeats link to the same Todoist task
  instead of duplicating, and possible matches get flagged for you to check.
- **Plan today in one pass** - Preview "Schedule Today's Tasks" and tweak the plan before it touches your list,
  then apply it. Changed your mind, undo it.
- **Look beyond your vault when you want** - Internet Search and Deep Research are there
  for questions your notes cannot answer, and both stay off unless you turn them on.
- **Bring your own models** - Use OpenAI, Gemini, Anthropic, OpenRouter, Open WebUI with Ollama, or any OpenAI-compatible service.
  No single vendor is required, self-hosted setups work, and your notes stay on your device.

## Set up in minutes

1. Install from [Obsidian Community Plugins](https://obsidian.md/plugins?id=semantic-todoist-sync), or grab the
   [latest release](https://github.com/NeuroCloud-Activate/semantic-todoist-sync/releases/latest) for a manual install.
   Needs Obsidian 1.5.0 or later, on desktop, iPhone, and iPad.
2. Open `Settings > Semantic Todoist Sync`, add a provider under **AI Providers**, and press **Validate connection**.
3. Pick your models under **AI Models** and check the embedding choice.
4. Add your Todoist token, run the connection check, and rebuild the semantic index.
5. Optional, for email: add your Cloudflare Worker URL and token in settings, then send yourself a test email before turning on automatic processing.

## Everyday use

- Sidebar buttons **Ask**, **Tasks**, **Index**, and **Run** cover daily life.
  The command palette adds note sync, email runs, scheduling, and undo.
- Mark actions with `#todo` (changeable in settings). Main tasks get `#STsync`, subtasks get `#STSubSync`.
  Add `!!1`-`!!4` for priority, a calendar date for a due date, and `{{date}}` for a deadline.
- Each task gets a plain description drawn from your notes, with short source notes below.
  A source link that cannot be resolved is skipped quietly instead of failing the run.
- If an email pauses after a failure, press **Resume** in settings and it carries on.
- Your label, priority, and date rules in settings guide the rest.

## Good to know

- Thinking models are handled for you. Reasoning defaults to **Automatic**, and any level you pick yourself always wins.
- Prompt caching for Claude models is on by default, so repeat requests across a note cost less.
- The deduplication toggle links repeats to the same Todoist task instead of creating doubles.
- Search mode defaults to Exact, and Routed is an opt-in speed setting for very large vaults.
  Custom OpenAI-compatible endpoints support chat and embeddings, but not web search.

## Privacy and network

- The plugin is free, takes no payments or donations, has no account of its own, and is open source under the GNU General Public License v3.0.
- You need a Todoist account and token for Todoist jobs, and a provider account for paid providers. Self-hosted options can run without one.
- Todoist jobs reach only `api.todoist.com`. AI jobs reach only the provider you picked.
  Internet Search and Deep Research use your provider's search service. Email jobs reach only the Worker address you enter.
  The optional System One decision model reaches only the server address you type (task text and short note excerpts go there; leave it off to send nothing).
  Debug logging talks only to the collector on your own computer. Each call sends only what that job needs.
- Your index, task links, and scheduling memory stay on your device. Todoist receives task fields only when you run Todoist jobs.
- No telemetry is sent to us, there are no ads, and the plugin never installs or updates itself.

## Links

- [Changelog](CHANGELOG.md) and [License](LICENSE), GNU General Public License v3.0.
- We compared models on a real, messy meeting note. See the [benchmark protocol](docs/model-quality-benchmark.md)
  and the [earlier scorecard](docs/model-quality-benchmark-scorecard-2026-08-09.json) for results.
