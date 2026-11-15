# Agent notes

Before working in this repo or deploying, read **`docs/runbook.md`** — it
documents the environment (WSL + OMV server), the deploy flow, verification
recipes, and the environment-specific gotchas (localhost vs 127.0.0.1, Docker
volume vs local DB, CDP testing rules). `docs/deployment.md` covers the
architecture; `README.md` is viewer-first.

House rules:
- Commit subjects describe the feature; no stage/phase prefixes.
- `docs/search-db.md` is intentionally untracked — leave it that way.
- `media/`, `logs/`, `chrome-profile/` never go into git or images.
- When running headless Chrome, only kill the PIDs you spawned.
