# Runbook — working on the project & deploying to the server

Everything an agent (or a future you) needs to work in this repo without
re-learning the hard way. For architecture and design rationale see
`README.md` (§ file map) and `docs/deployment.md`; for the search stack's
design decisions see the local `docs/search-db.md` (untracked, see §7).

## 1. Environment map

| Piece | Value |
|---|---|
| Local repo | `/mnt/c/Users/raffe/Desktop/projects/sakamichi-archiver` (WSL, Windows drive) |
| Server | `SERVER-REDACTED` (OMV NAS, over Tailscale) |
| Server app dir | `/srv/DISK-UUID-REDACTED/appdata/Sakamichi Archive` |
| Public URL | `https://PUBLIC-URL-REDACTED` (auth-gated — API tests can't use it) |
| Local test | `http://127.0.0.1:8080` (docker, container `sakamichi-archiver-viewer-1`) |
| Server API tests | `http://172.17.0.1:8484` via ssh (viewer port is not exposed publicly) |
| Remotes | `omv` = the appdata dir itself (`receive.denyCurrentBranch=updateInstead`, push = deploy's code step); `github` = mirror (`raffchen/sakamichi-archiver`) |
| Archive data | `media/` — bind-mounted into containers; **never in git, never in an image** |

Server-host facts: **no node** on the OMV host — pipe JSON through local node
(`ssh … curl … | node -e …`). Docker on the server is rootless-ish? No — run
docker via the ssh user directly; the compose project name is
`sakamichiarchive` (different from local `sakamichi-archiver`).

## 2. Daily loop (local)

```bash
cd viewer
npm run index            # rebuilds public/index.json + thumbs + index.sqlite
npm run index            # run twice: 2nd run must be a warm no-op (0 embedded)
npm run check            # svelte-check, expect 0 errors
npm test                 # vitest (format/display/store/actions)
npm run build            # vite production build
cd ..
docker compose build viewer && docker compose up -d viewer
# then test the BUILT app at http://127.0.0.1:8080 (see §5 for why not localhost)
```

`npm run index` writes `viewer/public/` (gitignored: index.json, thumbs/,
index.sqlite). The **container has its own DB copy** in the `viewer-db` named
volume, built by the image's own code at boot — a local `npm run index` does
NOT update the container. Testing a scripts/ fix in Docker always needs
`docker compose build viewer` first.

## 3. Deploying

```bash
./deploy.sh              # push (omv + github mirror) → build all images → up -d → health poll
./deploy.sh --no-push    # rebuild/restart from what's already on the server
```

What it does, precisely:

1. `git push omv main` — updates the server's working tree in place; only
   changed files cross the wire. Also pushes to `github`.
2. Copies `docker-compose.yml` → `Sakamichi Archive.yml` (OMV regenerates its
   compose copy from its DB; this keeps them in sync).
3. `docker compose build && docker compose up -d`, then polls the health
   endpoint on the docker bridge for 2 min.

Deploy behavior you can rely on:

- **One-off grab containers survive** (`sakamichiarchive-syncer-run-*` —
  created by `docker compose run`, not `up`). A long blog backfill is NOT
  killed by a deploy.
- The syncer daemon (`-syncer-1`) restarts cleanly; grab-media rounds are
  incremental, nothing is lost.
- Viewer restart: boot re-syncs its SQLite DB from media. When code changes
  strip/derive differently (e.g. body md5 changes), rows update and affected
  embedding chunks re-embed lazily — minutes, not hours. A genuinely fresh
  volume is the slow path: the server's first build embedded ~12k vectors in
  ~14 min at 99% CPU (stay calm, watch `docker top`).

Volumes on the server (survive image rebuilds): `media` (bind),
`viewer-db` (SQLite index), `viewer-model` (embedding model, ~120 MB,
downloads once from HF on first boot).

## 4. Architecture quick facts

- **Search index** (`viewer/scripts/db.mjs`, schema v5): `posts` + `messages`
  mirrored from media files, FTS5 trigram index, kuromoji `reading` columns,
  embeddings in sqlite-vec (`vec_posts` chunks, `vec_messages` whole-message).
  Everything derivable; delete the DB and it rebuilds.
- **Search API** `/api/search?q=&limit=&type=message|blog`: `exact` (FTS5,
  bm25, `<mark>` snippets) + `related` (cosine groups — blog cap 12 / message
  cap 8 unscoped, full 20 scoped; array order blog-group then messages;
  deduped vs exact). `SEMANTIC_LOG=1` logs score distributions.
- **`/api/index`** serves a slim index (texts truncated except the 5 newest
  messages per member); threads/gallery fetch `/api/member/<slug>` on demand.
  Dev mode (`vite`) serves the raw file — full texts + client-scan fallback.
- **`/api/blog`** feed reads the DB (O(1)) with the file scan as fallback.
- **Syncer**: grab-media for each site in `SYNC_SITES` every `SYNC_INTERVAL`
  (30 min). **Blogs are manual** (`grab-blog.py`); wiring them into the loop
  is planned — when doing it, target current members only (graduated
  members' blogs are erased from the official site → their images 404; that
  noise is expected, not a bug).
- One-off manual grabs: `docker compose run --rm syncer python grab-blog.py …`
  on the server (needs `--site sakurazaka46` / `--all`; entries are
  incremental per member).

## 5. Gotchas — read before debugging anything

1. **`localhost` vs `127.0.0.1` from Windows Chrome.** The Windows-side
   `localhost:8080` has served a *stale* bundle while `127.0.0.1:8080` hit the
   real container. Always test against **`http://127.0.0.1:8080`** in CDP
   scripts. Symptom if you forget: your new code "doesn't run" (listeners
   missing, old overlay present) with zero console errors — check the loaded
   asset filename (`performance.getEntriesByType('resource')`) before
   debugging the code.
2. **Never kill all Chrome processes** — only the specific PIDs your script
   spawned. The user runs a real browser.
3. **CDP screenshots**: spawn `/mnt/c/Program Files/Google/Chrome/Application/chrome.exe`
   with `--headless=new --remote-debugging-port=<unique> --user-data-dir=/tmp/<unique>`
   (unique per run — persistent profiles serve cached bundles), disable cache
   (`Network.setCacheDisabled`) for good measure, and wait for
   `http://127.0.0.1:<port>/json/list`. Raw WebSocket CDP (no npm deps) —
   see `viewer/scripts/shot.mjs` and /tmp test scripts for the pattern.
4. **Programmatic focus in CDP needs a synthetic `FocusEvent` dispatch** —
   real `.focus()` doesn't land in headless runs.
5. **`/tmp` writes occasionally don't persist** (WSL/9p weirdness) — after
   writing a script, `stat`/`head` it before running; after a confusing
   failure, verify the file you ran is the file you wrote.
6. **`node:sqlite` prints ExperimentalWarning** — use `--no-warnings` for
   clean output; inside containers use `node --no-warnings -e "…"`.
7. **SQL inside JS strings in db.mjs uses `--` comments**, not `//` (JS comment
   syntax inside SQL strings breaks the query).
8. **server.mjs is plain JS** — no TS syntax (`null as string | null` crashes
   the container at boot). Use JSDoc casts.
9. **sqlite-vec vec0 quirk**: no explicit-rowid inserts (use autoassigned
   rowids + a mapping column `vec_rowid`); bind float32 arrays as
   `Buffer.from(f32.buffer)`.
10. **Docker COPY layers on /mnt/c** are checksum-based and reliable, but the
    *container DB volume* isn't — see §2. When a "fix didn't work", first
    check which bundle the page actually loaded (§5.1), then whether the
    container was rebuilt.
11. **Commit style**: subject = the feature after the em dash; no "stage N of
    the search DB" prefixes. Deploy runs `git push` — never leave the tree
    dirty when deploying.
12. **`docs/search-db.md` stays untracked** (gitignored with a pointer
    comment) — it's the local design/tracker doc with §7 checkboxes.
    Everything else in docs/ is committed.
13. **Blog bodies in the search DB are HTML-stripped** (`stripHtml` in
    `build-index.mjs`) — including `<style>`/`<script>` *content* (official
    blogs embed mail-app CSS; before the fix, "margin" matched every post).
    If you touch stripHtml, expect md5 churn → row updates + chunk re-embeds.
14. **Slim index**: `textsTruncated` flags gate the client-scan fallback.
    Tests that rely on full texts should run against dev (vite) or
    `/api/member/<slug>`.

## 6. Verification recipes

- **Search API**: `curl -s 'http://127.0.0.1:8080/api/search?q=…&type=blog'`
  piped to a `node -e` summarizer (exact/related counts, type mix, dup
  checks, took_ms). On the server, wrap the same in `ssh … "curl -s http://172.17.0.1:8484/…"`
  and parse locally (no node on the host).
- **DB inspection in-container**:
  `docker exec <viewer> node --no-warnings -e "const {DatabaseSync}=require('node:sqlite'); …"`
  against `/data/db/index.sqlite` (readOnly).
- **UI checks**: CDP screenshot scripts in /tmp (pattern in §5.3) — click
  through the real UI, capture PNG, then read the image. Verify state via
  `location.hash` and DOM queries, not screenshots alone.
- **Sync health**: `ssh … docker logs sakamichiarchive-syncer-1 --tail 20`
  (per-site rounds every 30 min); one-off backfills log to their
  `sakamichiarchive-syncer-run-*` container — `docker logs -f` it.
- **Viewer health**: `curl -fsS http://172.17.0.1:8484/api/health` from the
  server; `GET /api/version` for the index build stamp.

## 7. Open items at time of writing

- Wire blog grabbing into the syncer round (after the sakurazaka backfill
  finishes; current members only — see §4).
- Resume the nogizaka blog backfill later: `grab-blog.py --all --site
  nogizaka46` (incremental; graduated members will 404 their thumbs — skip
  them fast, don't retry).
- `github` mirror may lag behind `omv` if a deploy was made with
  `--no-push`-style manual pushes; keep both in sync.
