# Security and privacy

Never commit API keys, credentials, tokens, personally identifiable information, personal data, private vault content, local semantic indexes, raw private benchmark output, or local absolute paths. Use a synthetic fixture for public examples. Populated `.env`, `Testing/`, provider run output, Obsidian `data.json`, and semantic-index files are local-only.

The public `main` branch and its reachable history are the publication source.
Before publishing, scan the complete tracked tree and reachable history for
secrets, personal identifiers, private paths, and private testing artifacts. A
finding blocks publication and must not be bypassed. Release assets must be
byte-identical copies of `main.js`, `manifest.json`, and `styles.css` from the
matching tagged `main` commit.
