# Sakamichi Archiver — Message/blog archive + local web viewer

A private archive and viewer for the **Message (Sony Music) fan apps** and the
members' **official blogs**: a pair of Python tools downloads everything
(messages, photos, videos, voice notes, full blog diaries) into plain files on
disk, and a **Svelte 5 web viewer** renders it like the real apps — Talk list →
chat thread → photo/video/voice bubbles, plus a Blog tab, media gallery,
full-text search and archive stats. Everything runs locally or on your own
server; nothing is uploaded anywhere.

```
              ┌─ tools/grab-media.py ──►  media/<site>/messages/    messages,
 desktop      │   (session cookie → API)      <member>/…            media, voice
 Chrome ──────┤                                                     (subscription)
 (login once) │
              └─ tools/grab-blog.py ───►  media/<site>/blogs/       official-site
                  (public JSON API)         <member>/…               diaries (free)
                  (public JSON API)                               diaries (free)
                                          │
                              ┌───────────┴────────────┐
                              │  viewer  (Svelte + Vite)│  ← you are here
                              │  npm run dev  or        │
                              │  docker compose up -d   │
                              └────────────────────────┘
```

- **`tools/`** — the archivers (Python; see §4)
- **`viewer/`** — the web viewer (Svelte 5 + Vite; detailed docs in
  **`viewer/README.md`**)
- **`docs/api.md`** — the reverse-engineered Message API reference

## 1. The viewer

The viewer renders `media/` directly — no database, nothing copied or uploaded.
Per-site theming (nogizaka purple / sakurazaka pink) matches the official apps.

**Screens** (styled after the real Message apps, bottom nav traced from them):

- **Talk list** — per-site switcher, unread pills, "Online/Offline" grouping
  (relative to the newest message in the archive), member artwork from
  `single/`, romanized name under the Japanese one; the footer shows when
  the syncer last checked the Message API (live from `/api/sync/status`),
  not the index timestamp
- **Thread** — day separators, `New` divider, inline video with poster + play
  overlay, "no audio" badge for silent voice notes, voice bubbles with a scrub
  bar, per-message `···` copy-link menu, jump-to-newest chip
- **Lightbox** — every photo/video/voice has a shareable deep link
  (`#/media/<member>/<id>`); steps are a two-layer slide/crossfade with the
  neighbours pre-decoded; `←`/`→` (edge-pinned chevrons on desktop, circles on
  hover) or swipe/drag on touch — the track follows the finger 1:1 and
  spring-settles X-style, flicks commit, videos drag too (except their seek
  bar); `Esc` closes. Playback **volume persists across reloads** (device
  preference) while the **per-clip position is session-scoped** — reloads
  start the clip fresh
- **Blog tab** — directory of every blog member grouped by 期生 → member post
  list (thumbnail, pink title, lead, stamp) → post detail rendering the
  archived HTML — tapping an image opens the same shared lightbox viewer as
  message media. A search bar under the site
  pills opens blog-post-only search; a `⇅` menu switches the directory sort
  (generation old→new / new→old, name A→Z / Z→A, newest/oldest posts across
  all members); site switcher pills and per-site shareable URLs
  (`#/blog/sakurazaka46`)
- **Gallery** — per-member photos/videos as a month-grouped grid + voice list
  with a bottom player bar
- **Search** — two scoped search bars: the Talk page's searches **messages**,
  the Blog tab's (under the site pills) searches **blog posts**. Both are
  server-backed (`/api/search`) with two sections — `完全一致 / exact matches`
  (FTS5 substring search, reading-aware: ひかり finds 光, さくら finds 桜) and
  `おすすめ / related` (semantic: local ONNX embeddings rank posts/messages by
  meaning, so English queries surface Japanese content, with % similarity
  chips)
- **Info sheet** — per-member counts and date ranges

Hash routing throughout, so Back / reload / pasting a link all work. The full
route table, config (`archive.config.json`), index/thumbnail generation and
dev-server details live in **`viewer/README.md`**.

### 1.1 Run it

```sh
cd viewer
npm install        # once
npm run dev        # → http://localhost:5173 (host:true, so phones on the LAN work)
```

`npm run dev` builds `public/index.json` from `media/` first (and regenerates
thumbnails when the archive changes — the dev server watches `../media`).

**Production / Docker** — the same stack as two containers: a **viewer**
(serves the archive with HTTP Range support, builds the index at startup and
re-indexes as new files land — an unchanged archive skips the rebuild, and a
changed one swaps the new index in without a page reload — plus a few JSON
API routes) and an optional
**syncer** (`grab-media.py` on a loop):

```sh
cp .env.example .env     # optional: port, sites, sync cadence, login gate…
docker compose up -d     # viewer + syncer; `up -d viewer` for viewer only
# → http://localhost:8080
```

The syncer does more than loop `grab-media.py`: between full rounds it can
run cheap **probe rounds** (`SYNC_PROBE_INTERVAL`, e.g. `3m`) that fetch only
the newest message per member (~1 KB) and sync just the members whose newest
message is new or edited — so new messages land within minutes instead of
waiting for the full round. It also carries an optional **Uptime Kuma
heartbeat** (`PUSH_URL`), and failures (e.g. an expired session cookie) fire
**notifications** via `NOTIFY_URL` (ntfy/SMTP/webhook) and recover
notifications when a fresh cookie lands. Setting `VIEWER_PASSWORD` turns on a
**login gate**: the Talk/message side requires the password while the Blog
tab stays publicly browsable (see the viewer README's *Login gate* section).
On a server behind a reverse proxy, set `VIEWER_BIND_IP=172.17.0.1` so the
unauthenticated port is only reachable through the proxy.

Alongside `public/index.json` the indexer maintains a derived **SQLite**
search index (`viewer/scripts/db.mjs` — posts + messages with FTS5, kuromoji
reading columns and local ONNX embeddings via sqlite-vec, all rebuildable
from the files alone). The UI's search runs against it via `/api/search`:
exact matches are FTS5 with reading-aware matching, and the おすすめ / related
section ranks posts and messages by embedding similarity (fully local — no
API, content never leaves the box). The index lives in the `viewer-db`
volume (stays warm across deploys) and the embedding model in `viewer-model`
(downloads ~120 MB once).

### 1.2 Deploy to a server

`./deploy.sh` pushes the repo to the server over git (the server's appdata
directory is the `omv` git remote, configured with
`receive.denyCurrentBranch=updateInstead` so a push updates its working tree),
rebuilds the images, recreates the containers and health-checks the viewer.

One-time server setup: `raff` in the `docker` group, the appdata directory
registered as a git `safe.directory`, and `git remote add omv ...` locally.
After that, code changes deploy with `git commit && ./deploy.sh` — only
changed files cross the wire. The media volume is pinned to a host directory
(`MEDIA_HOST_DIR` in the server's `.env`) so the archive is browsable outside
Docker too.

## 2. Getting content into the archive

Two archivers feed `media/`. Re-running either is always safe — existing
files are skipped, new content is added, metadata files are regenerated.

### 2.1 Messages (needs a subscription)

The Message app's API is backed by a long-lived **session cookie** (set on
login; the app itself never receives a refresh token). Harvest it once from a
desktop Chrome login, after which every renewal is a plain API call — no
browser needed:

```bash
# 1. start Chrome with remote debugging and log in (both sites, once)
# Git Bash — $PWD is already a Windows-style path:
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
    --remote-debugging-port=9222 --user-data-dir="$PWD/chrome-profile" \
    --no-first-run "https://message.nogizaka46.com/" &

# WSL — chrome.exe needs a Windows path for --user-data-dir; a /mnt/c/...
# value silently falls back to the default profile and just opens a tab
# in the already-running Chrome:
"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe" \
    --remote-debugging-port=9222 --user-data-dir="$(wslpath -w "$PWD")/chrome-profile" \
    --no-first-run "https://message.nogizaka46.com/" &

# 2. harvest the browser-wide cookie jar via the DevTools Storage domain
python tools/harvest-session.py
#    → logs/<site>-session-cookie.txt   (Chrome can be closed afterwards)

# 3. sync (incremental; tokens renew via POST /v2/update_token + cookie)
python tools/keep-alive.py             # optional between syncs: keep sessions warm
python tools/grab-media.py --member-id 47
python tools/grab-media.py --site sakurazaka46 --member-id 82 --full-history
```

Token resolution order in `grab-media.py`: stored token → API refresh with the
stored cookie (rotating it automatically) → watching desktop Chrome over CDP.
If both fail: re-login and re-run `harvest-session.py`.

| Flag | Meaning |
|---|---|
| `--site <name>` | `nogizaka46` (default) or `sakurazaka46` — different domains, app IDs, tokens |
| `--member-id <n>` / `--member <substr>` | select member(s) |
| `--full-history` | walk the entire timeline via the `updated_from` cursor (needed when history > 200 msgs) |
| `--from <ISO date>` | start date for the full-history walk (default `2024-01-01T00:00:00Z`) |

What lands per member under `media/<site>/messages/<member>/` (site is
`nogizaka46` or `sakurazaka46` — group-first layout):

| File | Contents |
|---|---|
| `picture/`, `video/`, `voice/` | media files, named `<message-id>_<published-at>.<ext>` |
| `single/` | the "current single" uniform artwork shown on the home/Talk page — date-stamped filenames accumulate per release |
| `profile/` | the member's chosen profile picture (+ `phone_image` variant) |
| `_manifest.json` | media-only message metadata |
| `_messages.json` | **all** messages (text + media), chronological, full API metadata |
| `_transcript.md` | readable transcript; `%%%` in messages is replaced with the display name from `archive.config.json` |

Message `type` values: `text`, `picture`, `video`, `voice` (audio messages are
typed `voice` — not `audio` — on this platform).

### 2.2 Blogs (public, no subscription needed)

The Blog tab mirrors the members' **official-site diaries**, exposed by a
plain JSON API — no session, no token:

```bash
python tools/grab-blog.py                 # the members in archive.config.json
python tools/grab-blog.py --all           # EVERY blog member, both sites
python tools/grab-blog.py --member 山川_宇衣
python tools/grab-blog.py --full          # refetch everything, ignore skip
```

Per member this fetches diary pages (50 entries per page, newest first, stops
at already-archived ids) and downloads thumbnails + inline images:

```
media/<site>/blogs/<member>/blog/_blogs.json   entries, oldest first (title,
                                        html content, timestamps, thumbnails)
media/<site>/blogs/<member>/blog/files/*  downloaded images (HTML rewritten
                                        to local `files/...` paths)
```

`blogs/` is a sibling of the message archives, so members without a message
subscription still get blog directories. Incremental and resumable — re-running
only picks up new posts.

Member roster + generations: `--all` uses `GET /v2/blog-members` (cached under
`logs/blog-members-<site>.json`) joined with `viewer/public/blog-generations.json`
— a static map (name, reading, romanization, generation) built from the
official nogizaka member JSONP and the 櫻坂46 wiki. Relay accounts
(e.g. 四期生リレー) are skipped.

### 2.3 Backfilling graduated members (sakamichi.co)

The official sites **delete a member's blog when they graduate**, so
`grab-blog.py` can't touch them anymore. sakamichi.co keeps a public mirror
of most graduated members' diaries, and `tools/backfill-sakamichi-co.py`
folds that mirror into the standard layout — same `_blogs.json` schema,
same `files/` conventions, so the result is indistinguishable from a
`grab-blog.py` archive:

```bash
# members.json: one [site, slug, uid, name, archived, posts] record per member
python3 tools/backfill-sakamichi-co.py members.json              # → media/unlisted/
python3 tools/backfill-sakamichi-co.py members.json --into media # → media/ directly
```

The mirror is fetched via `api.sakamichi.co` (list endpoint for metadata,
per-post detail endpoint for bodies and images); timestamps are UTC on the
wire and stored as JST. Posts the mirror never archived (its list endpoint
reports more posts than it has bodies for) are kept as metadata-only entries
(title/date/link, empty body).

**Keeping members out of the UI:** by default the script writes under
`media/unlisted/<site>/blogs/<name>/` — a parallel tree that build-index
never scans (it only looks at `<site>/blogs` one level deep), so archived
content stays on disk while the directory, search DB and thumbnails ignore
it. To make a member visible later:

```bash
mv media/unlisted/<site>/blogs/<name> media/<site>/blogs/
# then add them to viewer/public/blog-generations.json so the card gets its
# generation/graduated labels (they deliberately have no entry while hidden)
```

Incremental and resumable per member (atomic `_blogs.json` writes, existing
files skipped, single-instance lock) — safe to kill and re-run.

## 3. How the Message API works

- **Tokens**: access tokens are ~1 h JWTs. The web app renews them via
  `POST /v2/update_token` with a long-lived refresh token — the session
  cookie is accepted too and **rotates** on every renewal, which the tools
  persist automatically.
- **API**: same shape on both sites (`api.message.<site>.com/v2`) — full
  reference in **`docs/api.md`**. Endpoints used:
  - `GET /groups?organization_id=1` — member list
  - `GET /groups/{id}/timeline?count=200&order=desc` — newest 200
  - `GET /groups/{id}/timeline?...&updated_from=<ts>` — cursor walk for
    `--full-history` (inclusive boundary; pages dedupe by message id)
  - `GET /v2/blog-sources` / `GET /v2/blog-members` — blog URL templates and
    roster (Bearer token needed once to discover)
- **Media URLs**: CloudFront-signed, ~10 min TTL — pages are downloaded
  immediately after being fetched; on 403 the tool re-syncs with a fresh token
  and retries.

## 4. Files reference

| Path | Purpose |
|---|---|
| `tools/grab-media.py` | the message sync/downloader (§2.1) |
| `tools/grab-blog.py` | the blog archiver (§2.2) |
| `tools/harvest-session.py` | browser-level cookie read after a login (once per login) |
| `tools/keep-alive.py` | token renewal via `/v2/update_token` (`--loop 45m` for daemon mode) |
| `tools/migrate-media-layout.py` | one-shot migration to the group-first `media/<site>/…` layout (dry-run by default) |
| `tools/backfill-sakamichi-co.py` | graduated-member blog backfill from sakamichi.co into the standard or unlisted tree (§2.3) |
| `tools/entrypoint.sh` | the syncer container's loop: full/probe rounds, blog phase, heartbeat |
| `tools/session-upload.py` | push a fresh cookie into a running viewer's `/data/logs` volume |
| `tools/cdp.py` | Chrome DevTools Protocol helper (auto-probes IPv4/IPv6 loopback) |
| `viewer/` | the web viewer — **`viewer/README.md`** has the deep-dive |
| `viewer/scripts/db.mjs` | derived SQLite search index (§1.1) |
| `viewer/scripts/tokenize.mjs` | kuromoji wrapper — hiragana readings for the reading columns |
| `viewer/scripts/embed.mjs` | local ONNX embedder (multilingual-e5-small q8) for the semantic section |
| `docs/api.md` | reverse-engineered API reference (auth, endpoints, schemas, pagination) |
| `logs/` | tokens, session cookies, blog roster cache |
| `deploy.sh` | push + rebuild + health-check (§1.2) |
| `build/` | Dockerfiles (`viewer.Dockerfile`, `syncer.Dockerfile`) |

The early emulator + mitmproxy setup that discovered the session-cookie
mechanism was removed after the desktop path proved out — see git history.

## 5. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| 400 "api_major_version" from API | missing `X-Talk-App-ID` / `X-Talk-App-Platform` headers — grab-media.py sends them |
| HTTP 400 on `update_token` | session cookie expired/revoked — re-login in the Chrome window, then `python tools/harvest-session.py` |
| Video seeking broken | the media server must support HTTP Range — use the shipped server/vite setup, not `python -m http.server` |
| Blog member greyed out in the directory | their backfill hasn't run yet — `python tools/grab-blog.py --member <name>` |
| Search index stale in Docker | the viewer re-indexes on media changes; if `fs.watch` is unavailable on the volume it falls back to a 6h rebuild — restart the viewer to force one |
