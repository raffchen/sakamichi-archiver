# viewer — local web viewer for the archive

A small Svelte 5 + Vite app that renders `../media/` like the real
Nogizaka46 / 櫻坂46 Message apps: Talk list → chat thread → photo/video/voice
bubbles, plus the Blog tab (official-site diaries), a media gallery,
cross-member search and an archive info sheet.

Everything is local. No server-side DB, nothing uploaded. The only network
calls are to the viewer's own `/api/*` routes (below) — the message/blog data
always comes off disk.

## Run

```sh
cd viewer
npm install     # once
npm run dev     # → http://localhost:5173  (also on your LAN, e.g. phone)
```

`npm run dev` rebuilds the index first (`predev` → `npm run index`). **The dev
server also watches `../media`** — after `python tools/grab-media.py` lands
new files, the index rebuilds automatically (debounced) and any open viewer
tabs live-reload. Nothing to do by hand.

| script | what it does |
|---|---|
| `npm run index` | scan `../media/`, write `public/index.json`, generate video/photo posters into `public/thumbs/` (needs `ffmpeg`) |
| `npm run dev` | dev server on :5173, `host: true` so a phone on the same Wi-Fi can open it |
| `npm run build` + `npm run preview` | production build, served on :4173 |
| `npm run check` | `svelte-check` (types + a11y) |
| `npm run test` | `vitest run` (unit tests for format/display/store/actions/auth/mediaPersist, happy-dom) |

Index flags: `npm run index -- --no-thumbs` (skip ffmpeg), `--force-thumbs`
(re-encode every poster), `--quiet`.

## Why the media is served, not copied

`vite.config.ts` mounts `../media` at `/media/**` with `sirv` (dev **and**
preview). Two things this buys that a naive file server does not:

- **HTTP Range requests** — `<video>`/`<audio>` seeking is impossible without
  them. ⚠️ `python -m http.server` does *not* support Range; don't swap it in.
- **Japanese folder names** — the archive paths are percent-encoded on the wire
  and decoded by `sirv`. `.jfif` is forced to `image/jpeg`.

The ~180 MB archive is never copied into `public/`.

## Routing

Hash routes, so Back / reload / pasting a link all work:

```
#/                                 → rewritten to #/talk/nogizaka46
#/talk/<site-key>                  Talk list for a site (e.g. #/talk/nogizaka46)
#/site/<site-key>                  legacy alias of #/talk/<site-key>
#/thread/<member-slug>             chat thread (opens at the newest message)
#/thread/<member-slug>/<msg-id>    jump to one message (deep link / search hit)
#/media/<member-slug>/<msg-id>     the open lightbox is itself a route — every
                                   photo/video/voice is deep-linkable
#/gallery/<member-slug>            that member's media
#/search                           two-section search (messages + blog posts)
#/blog-search                      blog-only search (opened from the Blogs header)
#/blog-member-search/<member-key>  one member's blog posts only (back returns to their list)
#/blog                             → rewritten to #/blog/<current-site>
#/blog/<site-key>                  Blog directory for a site (e.g. #/blog/sakurazaka46)
#/blog/<member-key>                one member's blog post list
#/blog/<member-key>/<post-id>      one blog post (deep-linkable)
```

Opening a blog deep link adopts that member's site theme (nogi purple /
sakura pink) even if the rest of the UI was on the other site. Inside a blog
post, tapping any image opens the same shared lightbox as message media
(`←` `→` step, `Esc`/backdrop close, `1 / N` counter, download).

Inside a thread, click any photo/video to get the lightbox (`←` `→` step,
`Esc` closes; swipe/drag on touch — the track follows the finger and
spring-settles, X-style; edge-pinned chevrons on desktop). The open lightbox
is itself the `#/media/…` route, so Back closes it. Timestamps are stored
UTC and shown in your browser's timezone.

## Configuration — `archive.config.json`

The archive folders are named `山川_宇衣` and carry no site attribution, so the
viewer keeps that in one place: which site a member belongs to, the romanized
name used in the UI, and the display name that replaces the app's `%%%`
placeholder (that's how the member addresses *you* in a message).

```json
{
  "display_name": "raff",
  "sites": { "nogizaka46": { "name": "乃木坂46", "roman": "Nogizaka46" } },
  "members": { "山川_宇衣": { "site": "sakurazaka46", "roman": "Ui Yamakawa" } }
}
```

Add a new member folder → add one line here → `npm run index`. (A folder that
isn't listed is still indexed under the first site, with a warning.)

A per-folder `media/<slug>/_member.json` (`{site, name, group_id, member_id}`)
overrides this file if present.

## Layout

```
src/App.svelte              hash router + which screen is mounted
src/lib/store.svelte.ts     shared $state: view/slug/site, lightbox, "seen" markers,
                            full-text member cache (stage 4 on-demand threads)
src/lib/auth.svelte.ts      login-gate state — asks /api/auth once at startup;
                            dev (no API routes) ⇒ gate off
src/lib/mediaPersist.ts     playback volume → localStorage (persists), per-clip
                            position → in-memory Map (session-scoped)
src/lib/format.ts           UTC archive stamps → local display
src/components/Login.svelte the login screen (production gate only)
scripts/build-index.mjs     media/ → public/index.json + public/thumbs/ + the SQLite
                            search index (FTS5 + readings + embeddings)
scripts/db.mjs              schema + incremental sync for the search index
scripts/tokenize.mjs        kuromoji readings (hiragana) for kana↔kanji search
scripts/embed.mjs           local ONNX embedder (semantic related section)
scripts/shot.mjs            optional: screenshot every screen in headless Chrome
scripts/media-bus.mjs       dev-only: verify only-one-media-playing in headless Chrome
scripts/wide-lb.mjs         dev-only: verify lightbox nav/backdrop at desktop size

src/lib/*.test.ts           vitest unit tests (happy-dom); `npm run test`
```

`public/index.json`, `public/thumbs/` and `public/index.sqlite` are generated
and gitignored. Search-related env vars (container): `DB_PATH` (index
location), `MODEL_DIR` (embedding-model cache volume), `EMBED_MODEL`
(override the model), `SEMANTIC_MIN_COS`/`SEMANTIC_GAP` (related-section
cutoffs), `SEMANTIC_LOG=1` (log per-query score distributions for tuning).

## Screens

Styled after the official Message apps (bottom nav icons traced from the real
thing; the whole UI renders at a 125% app zoom, `--app-zoom` in `app.css`).

- **Talk list** — per-site tabs, unread pills from localStorage, member
  artwork from `single/`; the footer shows when the syncer last checked the
  Message API (live from `/api/sync/status`, refreshed every minute — falls
  back to the index timestamp in dev, which has no API routes)
- **Thread** — day separators, `New` divider, inline video with poster and a
  play overlay (tapping opens the lightbox), "no audio" badge for `is_silent`,
  voice bubbles with a scrub bar; playback **volume persists across reloads**
  (a device preference in localStorage) while the **per-clip position is
  session-scoped** (in-memory — closing the clip or reloading starts it
  fresh, and per-message memory keeps `seen` marking honest)
- **Gallery** — filter tabs (All / Photos / Videos / Voice). Photos & videos
  are a 4-per-row square grid grouped in ascending month sections, with
duration badges on videos; the Voice tab is a flat list with unread dots and
a bottom player bar (leaving the tab stops playback)
- **Search** — three search bars, three scopes: the Talk page's bar searches
  **messages**; the Blog tab's search bar (under the site pills) searches
  **blog posts** (`#/blog-search`, back returns to Blogs); the bar above a
  member's post list searches just **that member's posts**
  (`#/blog-member-search/<member-key>`, back returns to their list). The scope
  applies to both sections — each bar searches its own corpus exactly and
  semantically. They hit the same server search
  (`/api/search?type=message|blog`, plus `&member=<key>` for a member's bar)
  and get
  two sections: `完全一致 / exact matches` via FTS5 (trigram tokenizer — real
  substring matching for Japanese; 1–2 char words go through an `instr()`
  path), `<mark>`-highlighted snippets, Blog/Message type badges, debounced
  fetch (~250 ms), ranked by bm25. **Reading-aware** (stage 3): hiragana
  queries hit kanji text and vice versa — ひかり finds 光, さくら finds 桜.
  **Semantic** (stages 5/6): a `おすすめ / related` section ranks content by
  embedding similarity (local ONNX e5-small via sqlite-vec, whole corpus —
  messages too) — English queries surface Japanese content; hits carry a %
  similarity chip, exact hits are never duplicated, and the section hides
  when empty. In the unscoped API search both corpora appear as two labelled
  subgroups (ブログ / blog posts, メッセージ / messages) since their scores
  don't share a scale. The Talk-side search falls back to the instant
  client-side scan (messages only) when the served index still carries full
  texts (dev) — slimmed clients are server-only
- **Info sheet** — per-member counts and date ranges
- **Blog** — mirrors the official-site diaries (`tools/grab-blog.py`, see the
  root README). Directory groups every known member by 期生; members whose
  backfill hasn't landed yet are greyed out. The ⇅ menu (official app
  parity) switches the directory sort, asc/desc for all of them:
  generation order, flat by name, or the cross-member posts feed
  (`/api/blog?site=&limit=&order=`). Site switcher pills; the directory URL
  carries the site (`#/blog/sakurazaka46`) so each site's blogs are
  linkable. Member view is a thumbnail post list (pink title, two-line
  lead, stamp) with a `search <member>'s blog posts` bar that opens the
  member-scoped search. Post view renders the archived HTML; tapping an image opens
  the same shared lightbox as message media (counter, download, Esc/backdrop
  close) with the post title as the caption.

News / Official remain decorative placeholders — that content isn't archived.

## Blog data

`blogs/` lives inside each site's tree (`media/<site>/blogs/<member>/blog/`),
indexed into `index.json` as `blogs.members[]`:

```json
{ "key": "川﨑_桜", "site": "nogizaka46", "uuid": "55400",
  "name": "川﨑 桜", "gen": "5期生", "gen_num": 5, "graduated": false,
  "count": 95, "first": "...", "last": "...",
  "thumb": "/media/nogizaka46/blogs/..." }
```

- the **full roster** comes from `logs/blog-members-<site>.json` (grabbed once
  from `GET /v2/blog-members`), joined with the static generation map in
  `public/blog-generations.json` — so not-yet-archived members still show up
  (greyed)
- post **bodies stay lazy**: the index carries directory metadata only; the
  list endpoint strips HTML to a 140-char lead and the detail endpoint returns
  the full post

## Login gate (production container)

Set `VIEWER_PASSWORD` in the environment and the **Talk/message side requires
a login while the Blog tab stays publicly browsable** — no basic-auth popup,
the SPA renders its own login screen (`src/components/Login.svelte`, state in
`src/lib/auth.svelte.ts`). The flow:

- the client asks `GET /api/auth` once at startup (`required` + `authed`);
  on the vite dev server that route doesn't exist, so the gate is off in dev
- `POST /api/login` checks the password and sets a **30-day signed session
  cookie** (`sakamichi_auth`); the signing key is derived from the password,
  so changing `VIEWER_PASSWORD` invalidates every session at once — and
  sessions survive container restarts (nothing is stored server-side)
- failed logins get a naive **per-IP escalating lockout** (in-memory,
  resets on restart); `POST /api/logout` clears the cookie
- the boundary is path-based (`needsAuth` in `server.mjs`): member/thread API
  routes and `media/<site>/messages/**` URLs are gated; blog routes, blog
  media and the health/version endpoints stay public

Unset (the default) everything is public — right for a purely local archive.

## HTTP API (production container)

The docker viewer serves a few JSON routes alongside the static bundle
(`viewer/server.mjs`; the dev server doesn't need them — vite serves the same
index from disk):

| Route | Purpose |
|---|---|
| `GET /api/health` | liveness (used by docker healthcheck + uptime monitor) |
| `GET /api/auth` | login-gate check: `{required, authed}` (404 in dev → gate off) |
| `POST /api/login` | `{password}` → 30-day signed session cookie (per-IP throttle on failures) |
| `POST /api/logout` | clear the session cookie |
| `GET /api/sync/status` | public — when the syncer last talked to the Message API per site (Talk footer) |
| `GET /api/version` | index build stamp — clients poll it and reload when the index changes |
| `GET /api/index` | the built `index.json`, **slimmed**: message texts for all but the 5 most recent messages per member are dropped (`textsTruncated` flags mark it) — keeps the payload flat as the archive grows |
| `GET /api/member/<slug>` | one member, full texts — thread/gallery fetch this when the slim index says `textsTruncated` |
| `GET /api/search` | two-section search (`?q=&limit=&type=message\|blog`, optional `member=<blog member key>` to filter posts to one author) — FTS5 exact + semantic `related` (stage 5/6); `SEMANTIC_LOG=1` logs score distributions |
| `GET /api/blog` | newest-posts feed — served from the search DB when present (O(1); thumbs + lead included), file-scan fallback otherwise |
| `GET /api/blog/<key>` | one member's posts, newest first, `content` stripped to a `lead`; paginated — `?limit=` (default 25, max 200) + `?offset=`, response includes `total` |
| `GET /api/blog/<key>/<id>` | one full post (HTML content, images prefixed with `/media/<site>/blogs/...`) + `prev`/`next` neighbor stubs (id + title) — the post footer chains from these since the list route is paginated |
| `POST /api/secrets/session` | syncer uploads rotated session cookies here (guarded by `UPLOAD_TOKEN`) |
| `GET /api/secrets/status` | token/cookie freshness for monitoring |

Member keys are matched leniently: 川﨑 (U+FA11) and 崎 (U+5D0E) are treated as
the same character, so keyboards that normalize the name still resolve.
