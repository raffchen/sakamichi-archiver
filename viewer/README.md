# viewer — local web viewer for the archive

A small Svelte 5 + Vite app that renders `../media/` like the real
Nogizaka46 / 櫻坂46 Message apps: Talk list → chat thread → photo/video/voice
bubbles, plus a media gallery, cross-member search and an archive info sheet.

Everything is local. No server-side DB, no API calls, nothing uploaded.

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
#/search                           full-text search over every message
```

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
- **Search** — full-text across every member, highlighted
- **Info sheet** — per-member counts and date ranges

The Blog / News / Official tabs are deliberately disabled — that content was
never part of these archives.
