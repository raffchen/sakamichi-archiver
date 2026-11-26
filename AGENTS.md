# Agent notes

Before working in this repo or deploying, read **`docs/runbook.md`** — it
documents the environment (WSL + OMV server), the deploy flow, verification
recipes, and the environment-specific gotchas (localhost vs 127.0.0.1, Docker
volume vs local DB, CDP testing rules). `docs/deployment.md` covers the
architecture; `README.md` is viewer-first.

House rules:
- Machine-specific *values* stay out of git: they live in `deploy.env` and
  `ssh-creds.txt` (both gitignored; `deploy.env.example` is the tracked
  template). The runbook and AGENTS.md are tracked — they describe how
  things work and reference `deploy.env` for this machine's targets.
- Commits follow `type(scope): subject — detail`:
  - `type` is `feat` or `fix` (others like `docs:`/`refactor:` when they fit);
  - `scope` is the area touched — `viewer` for the app, `tools` for the
    grabber/repair scripts;
  - the subject names the feature/fix (no stage/phase prefixes like
    "stage N of the search DB");
  - after the em dash, one clause of why or the behavior it fixes
    (e.g. `feat(viewer): blog directory settings gear — hide graduated
    members, persisted per device`);
  - keep the whole subject line under 100 characters — if the why needs
    more than one clause, put the long explanation in the commit body
    instead of stretching the subject.
- When an agent commits finished work, deploy it right away with `./deploy.sh` —
  don't leave commits pending a deploy decision or batch them up. Only skip the
  push (`--no-push`) when the deploy is explicitly a rebuild-only request.
- `docs/search-db.md` is intentionally untracked — leave it that way.
- `media/`, `logs/`, `chrome-profile/` never go into git or images.
- When running headless Chrome, only kill the PIDs you spawned.
