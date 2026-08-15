# Security and privacy

Never commit API keys, credentials, tokens, personally identifiable information, personal data, private vault content, local semantic indexes, raw private benchmark output, or local absolute paths. Use a synthetic fixture for public examples. Populated `.env`, `Testing/`, provider run output, Obsidian `data.json`, and semantic-index files are local-only.

Before publishing, run `node scripts/build-public-share.js` from a private development checkout and publish only the generated, reviewed `public-share/` tree. A scanner finding blocks publication and must not be bypassed.
