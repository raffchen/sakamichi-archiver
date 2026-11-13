# Message (Sony Music) → Media Sync — Complete Guide

Pure-host downloader (`tools/grab-media.py`) that archives all messages, media
and text from the Message (Sony Music) fan apps. **No emulator needed** —
access tokens are renewed with a plain API call using the login **session
cookie**, harvested once after a login in desktop Chrome.

```
desktop Chrome (--remote-debugging-port=9222, logged in once)
        │
        └── tools/harvest-session.py ──► logs/<site>-session-cookie.txt  (once)
                                           (browser-wide cookie jar read)
        ▼
  tools/keep-alive.py / grab-media.py ──► POST /v2/update_token (no browser!)
        │   Cookie: session=<id>  →  fresh 1 h access token + rotated cookie
        ▼
  media/<member>/{picture,video,voice}/ + transcripts
```

How the session works (discovered empirically, see §3): the web app never
receives a refresh token — its login sets a long-lived httpOnly
`session=<uuid>` cookie on `.message.<site>.com` instead. `update_token`
accepts that cookie (body `refresh_token: null` is fine) and **rotates** it:
every response carries `Set-Cookie: session=<new>` scoped to
`Path=/v2/update_token`, which the tools persist automatically.
## 1. One-time setup

### 1.1 Prerequisites

- **Desktop Chrome**; **Python 3.10+** with `pip install websocket-client cryptography`.

### 1.2 Start Chrome with remote debugging (dedicated profile)

```bash
nohup "/c/Program Files/Google/Chrome/Application/chrome.exe" \
    --remote-debugging-port=9222 \
    --user-data-dir="$PWD/chrome-profile" \
    --no-first-run --no-default-browser-check \
    "https://message.nogizaka46.com/" &
```

Note: Chrome binds DevTools to IPv6 loopback too — `tools/cdp.py` probes both.
Don't run an `adb forward tcp:9222` at the same time (it would shadow this port).

### 1.3 Log in (once per site, in that Chrome window)

Log in at `https://message.nogizaka46.com` and
`https://message.sakurazaka46.com` (OAuth via LINE). The sessions persist in
`chrome-profile/` across restarts. The site no longer forces phone access —
desktop works fine.

### 1.4 Harvest the session cookies (once per login)

The web login issues no refresh token — it sets a long-lived httpOnly
`session` cookie on `.message.<site>.com` (partitioned, invisible to
per-page CDP queries). `tools/harvest-session.py` reads the browser-wide
cookie jar via the DevTools **Storage** domain:

```bash
python tools/harvest-session.py
```

Files: `logs/nogizaka-session-cookie.txt`, `logs/sakura-session-cookie.txt`.
After this, Chrome can be closed — daily syncs need no browser at all.
The cookie is rotated on every renewal (handled automatically by the tools);
if a cookie ever expires server-side, re-login and re-run the harvest.

## 2. Daily workflow

```bash
# optional but recommended between syncs: keep the session warm
python tools/keep-alive.py            # refresh both access tokens once

# sync media + text  (incremental; skips already-downloaded files)
python tools/grab-media.py --member-id 47
python tools/grab-media.py --member-id 53
python tools/grab-media.py --member-id 54
python tools/grab-media.py --member-id 61
python tools/grab-media.py --site sakurazaka46 --member-id 82 --full-history
```

Token resolution order in `grab-media.py`:

1. stored access token (`logs/api-token.txt` / `logs/sakura-token.txt`)
2. **refresh via API** — `POST /v2/update_token` with the stored session
   cookie (no browser needed; the rotated cookie is persisted automatically)
3. fallback: watch desktop Chrome over CDP (`--remote-debugging-port=9222`)

If both fail, re-login in the Chrome window and re-run
`python tools/harvest-session.py`.

Subscribed member IDs:

| Site | Member | ID |
|---|---|---|
| nogizaka46 | 池田 瑛紗 | 47 |
| nogizaka46 | 川﨑 桜 | 53 |
| nogizaka46 | 菅原 咲月 | 54 |
| nogizaka46 | 大越 ひなの | 61 |
| sakurazaka46 | 山川 宇衣 | 82 |

New subscription? Look up the ID:

```bash
# member list with ids (uses the site's own API, token auto-refreshed)
python - <<'EOF'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("gm", "tools/grab-media.py")
gm = importlib.util.module_from_spec(spec); spec.loader.exec_module(gm)
site = gm.SITES["sakurazaka46"]
tok = gm.get_token(site) or gm.refresh_token_via_api(site) or gm.refresh_token_via_cdp(site)
for g in gm.api_get("/groups?organization_id=1", tok, site):
    print(g["id"], g["name"])
EOF
```

### 2.1 What the sync produces

Per member under `media/<member>/`:

| File | Contents |
|---|---|
| `picture/`, `video/`, `voice/` | media files, named `<message-id>_<published-at>.<ext>` |
| `single/` | the "current single" uniform artwork shown on the home/Talk page — changes with every single release; date-stamped filenames accumulate per release |
| `profile/` | the member's chosen profile picture (+ `phone_image` variant) from `/groups/{id}/members` |
| `_manifest.json` | media-only message metadata |
| `_messages.json` | **all** messages (text + media), chronological, full API metadata |
| `_transcript.md` | readable transcript: text messages interleaved with media, captions quoted under each image (`%%%` in messages is replaced with the display name `raff`) |

Reverse-engineered API details (auth, endpoints, message schema, signed media
URLs, pagination semantics) are documented separately in **`docs/api.md`**.

Message `type` values: `text`, `picture`, `video`, `voice` (audio messages are
typed `voice` — not `audio` — on this platform).

### 2.2 Sync flags

| Flag | Meaning |
|---|---|
| `--site <name>` | `nogizaka46` (default) or `sakurazaka46` — different domains, app IDs, tokens |
| `--member-id <n>` / `--member <substr>` | select member(s) |
| `--full-history` | walk the entire timeline via the `updated_from` cursor (needed when history > 200 msgs, e.g. the 123-day sakurazaka archive) |
| `--from <ISO date>` | start date for the full-history walk (default `2024-01-01T00:00:00Z`) |

Re-running is always safe — existing files are skipped; new messages are added
and `_transcript.md`/`_messages.json` are regenerated.

## 3. How it works

- **Tokens**: access tokens are ~1 h JWTs (`{"exp", "sub"}`, HS256-ish). The
  web app renews them via `POST /v2/update_token` with a long-lived refresh
  token in the body — we store that body (`logs/<site>-refresh-token.txt`,
  harvested once after login) and replay it from Python, so refreshes need no
  browser. Token files hold the raw access token without the `Bearer ` prefix.
- **API**: same shape on both sites (`api.message.<site>.com/v2`) — full
  reference in **`docs/api.md`**. Endpoints used:
  - `GET /groups?organization_id=1` — member list
  - `GET /groups/{id}/timeline?count=200&order=desc` — newest 200
  - `GET /groups/{id}/timeline?count=200&order=asc&updated_from=<ts>` — cursor
    walk for `--full-history` (inclusive boundary; pages dedupe by message id)
  - `GET /groups/{id}/past_messages` — fixed "previous-day preview" returned
    when a subscription activates; identical on every call, does **not**
    paginate (kept as a safety net for messages older than `--from`)
- **Media URLs**: CloudFront-signed, ~10 min TTL — the script downloads each
  page immediately after fetching it; on 403 (expired signature) it re-syncs
  with a fresh token and retries.

## 4. Files reference

| Path | Purpose |
|---|---|
| `tools/harvest-session.py` | browser-level cookie read: saves the session cookie after any login (run once per login) |
| `tools/keep-alive.py` | renew access tokens via `/v2/update_token` + session cookie (no browser; `--loop 45m` for daemon mode; persists cookie rotation) |
| `tools/grab-media.py` | the sync/downloader (see above) |
| `tools/cdp.py` | Chrome DevTools Protocol helper (desktop Chrome, auto-probes IPv4/IPv6 loopback) |
| `docs/api.md` | reverse-engineered API reference (auth, endpoints, message schema, pagination) |
| `docs/deployment.md` | design doc: packaging the syncer + viewer as a Docker web service |
| `logs/` | tokens (`api-token.txt`, `sakura-token.txt`), session cookies (`<site>-session-cookie.txt`) |
| `viewer/` | local Svelte+Vite web viewer for `media/` (see `viewer/README.md`) |

The early emulator + mitmproxy setup that discovered the session-cookie
mechanism was removed after the desktop path proved out — see git history.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| 400 "api_major_version" from API | missing `X-Talk-App-ID` / `X-Talk-App-Platform` headers — grab-media.py sends them |
| HTTP 400 on `update_token` | session cookie expired/revoked — re-login in the Chrome window, then `python tools/harvest-session.py` |

## 7. Local viewer

Browse what was synced without the app — `viewer/` is a Svelte 5 + Vite UI that
looks like the real Message apps (Talk list → thread → photo/video/voice), plus
gallery, search and archive stats. It reads `media/` directly; nothing is copied
or uploaded.

```sh
cd viewer && npm install && npm run dev   # http://localhost:5173
```

#### Docker

The same stack runs as two containers — a viewer (serves the archive, builds
the index at startup and re-indexes as the syncer lands files) and a syncer
(`grab-media.py` on a loop, tokens/cookies on their own volume):

```sh
cp .env.example .env        # optional: port, sites, interval
docker compose up -d viewer # viewer only, or `up -d` for viewer + syncer
# → http://localhost:8080
```

The design and the full change list are in **`docs/deployment.md`**.

- `npm run index` (runs automatically before `dev`) turns `media/` into
  `public/index.json` and generates video/photo posters with `ffmpeg`
- media is streamed from `../media` with **Range support** — required for
  seeking; `python -m http.server` will not work
- new member folders: add one line to `viewer/archive.config.json`
  (site + romanized name) — the archive folders themselves don't record the site
- `%%%` in messages is the app's placeholder for *your* display name, replaced
  by `display_name` from that config
