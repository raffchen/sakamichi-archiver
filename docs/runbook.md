# Runbook — working on the project & deploying to the server

Everything an agent (or a future you) needs to work in this repo without
re-learning the hard way. For architecture and design rationale see
`README.md` (§ file map) and `docs/deployment.md`; for the search stack's
design decisions see the local `docs/search-db.md` (untracked, see §7).

## 1. Environment map

| Piece | Value |
|---|---|
| Local repo | `/mnt/c/Users/raffe/Desktop/projects/sakamichi-archiver` (WSL, Windows drive) |
| Server | see **`deploy.env`** (gitignored; `deploy.env.example` is the tracked template) — OMV NAS over Tailscale |
| Server app dir | see `deploy.env` (`APP_DIR`) — also the `omv` git remote (`receive.denyCurrentBranch=updateInstead`, push = deploy's code step) |
| Public URL | see `deploy.env` (`HEALTH_URL`) — login-gated talk side (`VIEWER_PASSWORD` in the server's `.env`; blog endpoints + `/api/blog` are public, message endpoints answer 401 to curl) |
| Local test | `http://127.0.0.1:8080` (docker, container `sakamichi-archiver-viewer-1`) |
| Server API tests | `http://172.17.0.1:$VIEWER_PORT` via ssh (docker bridge gateway; the viewer port is not exposed publicly) |
| Remotes | `omv` = the appdata dir itself (see `deploy.env`); `origin` = GitHub mirror (`raffchen/sakamichi-archiver`) |
| Archive data | `media/` — bind-mounted into containers; **never in git, never in an image**. The full archive exists **only on the server** — the local `media/` is a partial mirror, so anything that must see every entry (surveys, grep sweeps, counts) runs on the server: see §6 |
| Machine secrets | `ssh-creds.txt`, `deploy.env` — gitignored, this machine only |

Server-host facts: **no node** on the OMV host — pipe JSON through local node
(`ssh … curl … | node -e …`). Docker on the server is rootless-ish? No — run
docker via the ssh user directly; the compose project name is
`sakamichiarchive` (different from local `sakamichi-archiver`).

## 2. Daily loop (local)

```bash
cd viewer
npm run index            # rebuilds public/index.json + thumbs + index.sqlite
npm run index            # run twice: 2nd run must print "index unchanged —
                         # skipped write + db sync" (content-hash no-op check)
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
./deploy.sh              # push (omv + GitHub mirror) → build all images → up -d → health poll
./deploy.sh --no-push    # rebuild/restart from what's already on the server
```

What it does, precisely:

1. `git push omv main` — updates the server's working tree in place; only
   changed files cross the wire. Also pushes to `origin` (the GitHub mirror).
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
  embedding vectors re-embed lazily — minutes, not hours. A genuinely fresh
  volume, or a **model/schema switch** (`EMBED_MODEL`, `SCHEMA_VERSION`), is
  the slow path: the full blog+message corpus re-embeds. On the server (granite
  q8, 768d) that is ~3.7k blog vectors + messages — watch `docker logs -f` for
  `embedded N post chunks + M messages` (stay calm, `docker top`).

Volumes on the server (survive image rebuilds): `media` (bind),
`viewer-db` (SQLite index), `viewer-model` (embedding model; granite ~279 MB,
downloads once from HF on first boot), `viewer-thumbs` (ffmpeg thumbs — chat
grid + blog card crops; write-once per source file, so a deploy only encodes
new posts instead of the whole archive, which was ~10 min of ffmpeg per boot).

## 4. Architecture quick facts

- **Search index** (`viewer/scripts/db.mjs`, schema v6): `posts` + `messages`
  mirrored from media files, FTS5 trigram index, kuromoji `reading` columns,
  embeddings in sqlite-vec (`vec_posts`: a cleaned-title vector `idx=-1` +
  ~280-char body chunks per post, `vec_messages` whole-message). Model is
  granite-embedding-278m (768d) by default — see `viewer/scripts/embed.mjs`.
  Everything derivable; delete the DB and it rebuilds.
- **Search API** `/api/search?q=&limit=&type=message|blog`: `exact` (FTS5,
  bm25, `<mark>` snippets) + `related` (cosine groups — blog cap 12 / message
  cap 8 unscoped, full 20 scoped; array order blog-group then messages;
  deduped vs exact). `SEMANTIC_LOG=1` logs score distributions.
- **`/api/index`** serves a slim index (texts truncated except the 5 newest
  messages per member); threads/gallery fetch `/api/member/<slug>` on demand.
  Dev mode (`vite`) serves the raw file — full texts + client-scan fallback.
- **`/api/blog`** feed reads the DB (O(1)) with the file scan as fallback.
- **Syncer**: each `SYNC_INTERVAL` (30 min) runs, per site in `SYNC_SITES`,
  `grab-media.py --site <site> --subscribed` (messages; refreshes the API
  token). Blogs ride on their own schedule (`SYNC_BLOG_INTERVAL`, default
  1h — blogs are far rarer than messages): the phase piggybacks on the next
  due round and covers all sites in that pass, running
  `grab-blog.py --all --site <site>`. The blog grab's generation-map filter
  reduces the roster to **current members** — graduated members are skipped
  (their blogs are erased upstream; images 404) and unranked accounts
  (運営スタッフ, 期生リレー, 研究生) too. `SYNC_BLOG=0` disables the blog
  phase; its failure is loud but doesn't flip the Kuma heartbeat (media is
  the paging signal). Up-to-date members cost one API page each (~1–2 min
  per site).
- One-off manual grabs: `docker compose run --rm syncer python grab-blog.py …`
  on the server (`--all`, optionally `--site`; entries are incremental per
  member). Use `--full` only to force a refetch.

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
11. **Commit style**: `type(scope): subject — detail` — see AGENTS.md for the
    full convention (types, scopes, the em-dash detail clause). Deploy runs
    `git push` — never leave the tree dirty when deploying.
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
15. **Blog image filenames carry the entry id** (`<eid>_<basename>` in
    `blog/files/`). The official CDNs don't use unique basenames — old
    nogizaka posts serve `0000.jpeg`, `0001.jpeg`, … from per-post
    directories — so caching by bare basename made colliding posts display
    whichever post's image was grabbed first. Historical damage (564 entries
    / 13 members, mostly 2020–2022) was repaired with
    `tools/repair-blog-images.py` (refetches affected entries from the
    public diary API, which still serves original content); it is
    idempotent and safe to rerun.

## 6. Verification recipes

- **Search API**: `curl -s 'http://127.0.0.1:8080/api/search?q=…&type=blog'`
  piped to a `node -e` summarizer (exact/related counts, type mix, dup
  checks, took_ms). On the server, wrap the same in `ssh … "curl -s http://172.17.0.1:8484/…"`
  and parse locally (no node on the host).
- **DB inspection in-container**:
  `docker exec <viewer> node --no-warnings -e "const {DatabaseSync}=require('node:sqlite'); …"`
  against `/data/db/index.sqlite` (readOnly).
- **Full-archive queries** (the full `media/` exists only on the server —
  the local copy is a partial mirror, so surveys/counts/greps must run
  there): ssh in and `docker exec` against the viewer container, which sees
  everything under `/data/media`. Only the server has every entry, so a
  result from the local mirror is a *lower bound*, never the answer.
  Gotchas learned the hard way:
  - The blog trees are tens of GB, but almost all of it is photos — the
    JSON is ~130 files / ~120 MB. A bare `grep -r /data/media/*/blogs`
    reads every image byte and will look hung; always target the JSON:
    `find /data/media -path "*blogs*" -name "*.json" | xargs grep …`.
  - Quoting through `ssh` → `docker exec sh -c` is brittle. For anything
    non-trivial, write the script locally and pipe it in:
    `ssh <target> 'docker exec -i <viewer> sh -c "cat > /tmp/x.mjs"' < x.mjs`
    then run it (avoid `node /dev/stdin` — it eats the stdin pipe).
  - Long jobs: run detached (`docker exec -d … "… > /tmp/out.txt 2>&1;
    echo done > /tmp/job-done"`) and poll — pipelines only write output at
    the end, and an aborted ssh kills the job mid-flight.
- **UI checks**: CDP screenshot scripts in /tmp (pattern in §5.3) — click
  through the real UI, capture PNG, then read the image. Verify state via
  `location.hash` and DOM queries, not screenshots alone.
- **Sync health**: `ssh … docker logs sakamichiarchive-syncer-1 --tail 20`
  (per-site rounds every 30 min); one-off backfills log to their
  `sakamichiarchive-syncer-run-*` container — `docker logs -f` it.
- **Viewer health**: `curl -fsS http://172.17.0.1:8484/api/health` from the
  server; `GET /api/version` for the index build stamp.

## 7. Open items at time of writing

- the `origin` GitHub mirror may lag behind `omv` if a deploy was made with
  `--no-push`-style manual pushes; keep both in sync.
- Graduated members' blog posts are absent from the archive (erased
  upstream); they stay listed in the directory pending a re-source.
