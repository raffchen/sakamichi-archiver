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
#/                                 Talk list (first site)
#/site/sakurazaka46                Talk list for another site
#/thread/<member-slug>             chat thread (opens at the newest message)
#/thread/<member-slug>/<msg-id>    jump to one message (deep link / search hit)
#/gallery/<member-slug>            that member's media
#/search                           two-section search (messages + blog posts)
#/blog-search                      blog-only search (opened from the Blogs header)
#/blog                             Blog directory (generation sections, first site)
#/blog/<site-key>                  Blog directory for another site (e.g. #/blog/sakurazaka46)
#/blog/<member-key>                one member's blog post list
#/blog/<member-key>/<post-id>      one blog post (deep-linkable)
```

Opening a blog deep link adopts that member's site theme (nogi purple /
sakura pink) even if the rest of the UI was on the other site. Inside a blog
post, tapping any image opens a lightweight overlay (`←` `→` step, `Esc`
closes, `1 / N` counter).

Inside a thread, click any photo/video to get the lightbox (`←` `→` step, `Esc`
closes). Timestamps are stored UTC and shown in your browser's timezone.

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
src/lib/store.svelte.ts     shared $state: view/slug/site, lightbox, "seen" markers
src/lib/format.ts           UTC archive stamps → local display
scripts/build-index.mjs     media/ → public/index.json + public/thumbs/
scripts/shot.mjs            optional: screenshot every screen in headless Chrome
```

`public/index.json` and `public/thumbs/` are generated and gitignored.

## Screens

Styled after the official Message apps (bottom nav icons traced from the real
thing; the whole UI renders at a 125% app zoom, `--app-zoom` in `app.css`).

- **Talk list** — per-site tabs, unread pills from localStorage, member
  artwork from `single/`
- **Thread** — day separators, `New` divider, inline video with poster and a
  play overlay (tapping opens the lightbox), "no audio" badge for `is_silent`,
  voice bubbles with a scrub bar
- **Gallery** — filter tabs (All / Photos / Videos / Voice). Photos & videos
  are a 4-per-row square grid grouped in ascending month sections, with
duration badges on videos; the Voice tab is a flat list with unread dots and
a bottom player bar (leaving the tab stops playback)
- **Search** — two search bars, two scopes: the Talk page's bar searches
  **messages**; the Blog tab's search bar (under the site pills) searches
  **blog posts** (`#/blog-search`, back returns to Blogs). Both hit the same
  server search (`/api/search?type=message|blog`): `完全一致 / exact
  matches` via FTS5 (trigram tokenizer — real substring matching for
  Japanese; 1–2 char words go through an `instr()` path), `<mark>`-highlighted
  snippets, Blog/Message type badges, debounced fetch (~250 ms), ranked by
  bm25. **Reading-aware** (stage 3): hiragana queries hit kanji text and vice
  versa — ひかり finds 光, さくら finds 桜, half-width katakana is normalized
  too; reading columns come from kuromoji tokenization at index time, and
  reading-only matches are re-marked onto the kanji surface word in the
  snippet. The Talk-side search falls back to the instant client-side scan
  (messages only) when the search DB is missing or the endpoint fails; the
  blog-side search is server-only. A `おすすめ / related` (semantic) section
  is reserved for stage 5 and stays hidden while empty
- **Info sheet** — per-member counts and date ranges
- **Blog** — mirrors the official-site diaries (`tools/grab-blog.py`, see the
  root README). Directory groups every known member by 期生; members whose
  backfill hasn't landed yet are greyed out. The ⇅ menu (official app
  parity) switches the directory sort, asc/desc for all of them:
  generation order, flat by name, or the cross-member posts feed
  (`/api/blog?site=&limit=&order=`). Site switcher pills; the directory URL
  carries the site (`#/blog/sakurazaka46`) so each site's blogs are
  linkable. Member view is a thumbnail post list (pink title, two-line
  lead, stamp). Post view renders the archived HTML with a simple in-post
  image overlay.

News / Official remain decorative placeholders — that content isn't archived.

## Blog data

`blogs/` is a sibling of the message archives (`media/blogs/<member>/blog/`),
indexed into `index.json` as `blogs.members[]`:

```json
{ "key": "川﨑_桜", "site": "nogizaka46", "uuid": "55400",
  "name": "川﨑 桜", "gen": "5期生", "gen_num": 5, "graduated": false,
  "count": 95, "first": "...", "last": "...", "thumb": "/media/blogs/..." }
```

- the **full roster** comes from `logs/blog-members-<site>.json` (grabbed once
  from `GET /v2/blog-members`), joined with the static generation map in
  `public/blog-generations.json` — so not-yet-archived members still show up
  (greyed)
- post **bodies stay lazy**: the index carries directory metadata only; the
  list endpoint strips HTML to a 140-char lead and the detail endpoint returns
  the full post

## HTTP API (production container)

The docker viewer serves a few JSON routes alongside the static bundle
(`viewer/server.mjs`; the dev server doesn't need them — vite serves the same
index from disk):

| Route | Purpose |
|---|---|
| `GET /api/health` | liveness (used by docker healthcheck + uptime monitor) |
| `GET /api/version` | index build stamp — clients poll it and reload when the index changes |
| `GET /api/index` | the built `index.json` (includes `blogs.members[]`) |
| `GET /api/blog/<key>` | one member's posts, newest first, `content` stripped to a `lead` |
| `GET /api/blog/<key>/<id>` | one full post (HTML content, images prefixed with `/media/blogs/...`) |
| `POST /api/secrets/session` | syncer uploads rotated session cookies here (guarded by `UPLOAD_TOKEN`) |
| `GET /api/secrets/status` | token/cookie freshness for monitoring |

Member keys are matched leniently: 川﨑 (U+FA11) and 崎 (U+5D0E) are treated as
the same character, so keyboards that normalize the name still resolve.
