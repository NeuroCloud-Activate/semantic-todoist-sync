# Project rules

## Live Obsidian testing vault

- The `Testing` vault is the required live-validation vault for this project. Before any validation that uses Obsidian or the semantic index, it **must** reflect the current development version from the repository root.
- Synchronize the development plugin into `Testing/.obsidian/plugins/semantic-todoist-sync/` before validation. At minimum, synchronize `main.js`, `manifest.json`, and `styles.css`.
- Verify that the repository and testing-vault manifest versions match and that the SHA-256 hashes of the synchronized plugin files match before relying on live-validation results.
- Reload Obsidian after synchronization and confirm that `Testing` is the active vault. Never report live Obsidian or semantic-index results from a stale testing-vault copy.
- Keep `Testing/` private and ignored by Git. Do not commit vault state, semantic-index data, credentials, or generated testing artifacts.

## Local coding-agent task sizing

- Treat the local coding agent's controller limit of `max_context_bytes=32000` as a hard per-request budget. This is a byte budget for delegated tool context, not the model's 32K-token context-window claim.
- Never delegate an entire large source file. For files larger than 32 KB, the primary session must first use targeted search and line-range inspection, then delegate only the smallest relevant file set and snippets needed for the bounded task.
- If a delegated request is rejected for `file exceeds max_patch_bytes` or `cumulative context exceeds max_context_bytes`, record the coverage gap and retry with narrower slices or use the configured native fallback. Do not raise the controller limit merely to fit a large file.
