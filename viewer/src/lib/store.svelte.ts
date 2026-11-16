import type { Archive, Member, Msg } from './types'
import { requireLogin } from './auth.svelte'

/* Shared app state (Svelte 5 runes in a .svelte.ts module). */

export type View = 'home' | 'thread' | 'gallery' | 'search' | 'blog'

/* the Blogs ⇅ menu: every mode ascends/descends — generation, name, or the
   cross-member newest-posts feed */
export type BlogSort = 'gen-asc' | 'gen-desc' | 'name-asc' | 'name-desc' | 'latest' | 'oldest'

export const ui = $state({
  view: 'home' as View,
  slug: null as string | null,
  focusId: null as number | null,
  site: 'nogizaka46',
  query: '',
  /* search scope: the Talk page's bar searches messages only, the Blog tab's
     searches blog posts only (?type=... on /api/search) */
  searchScope: 'message' as 'message' | 'blog',
  /* blog tab: directory -> member post list -> post detail */
  blogMember: null as string | null, // directory key under media/blogs/
  blogPost: null as number | null,
  /* directory sort (the official ⇅ menu) */
  blogSort: 'gen-asc' as BlogSort,
})

export const lightbox = $state({
  open: false,
  items: [] as Msg[],
  i: 0,
  memberSlug: null as string | null,
  /* message lightboxes are deep-linkable (App maps them onto #/media/...);
     blog-image ones keep the post's own address instead */
  kind: 'message' as 'message' | 'blog',
})

export const info = $state({ open: false })

export function openMember(slug: string, focusId: number | null = null) {
  ui.view = 'thread'
  ui.slug = slug
  ui.focusId = focusId
}
export function openGallery(slug: string) {
  ui.view = 'gallery'
  ui.slug = slug
}
export function goHome() {
  ui.view = 'home'
  ui.slug = null
  ui.focusId = null
}
export function openBlog(member: string | null = null, post: number | null = null) {
  ui.view = 'blog'
  ui.searchScope = 'message'
  ui.blogMember = member
  ui.blogPost = post
}
export function back(archiveMembers: { slug: string }[] | null) {
  if (ui.view === 'gallery' && ui.slug) ui.view = 'thread'
  else if (ui.view === 'blog' && ui.blogPost != null) openBlog(ui.blogMember)
  else if (ui.view === 'blog' && ui.blogMember) openBlog()
  else if (ui.view === 'search' && ui.searchScope === 'blog') {
    ui.searchScope = 'message'
    openBlog()
  } else goHome()
}

/* ---- stage 4: full texts on demand ------------------------------------
   The served index is slim (old message texts dropped). Thread/Gallery fetch
   the full member from /api/member/<slug> once and cache it here; setArchive
   drops entries for members whose data changed, so a swap never serves
   stale texts from this cache (see docs/inplace-reindex.md). */
const fullMembers = new Map<string, Member>()
const fullInflight = new Map<string, Promise<void>>()
let fullTick = $state(0)

export function getMember(archive: Archive, slug: string | null): Member | null {
  if (!slug) return null
  void fullTick // track cache fills so callers re-derive
  return fullMembers.get(slug) ?? archive.members.find((m) => m.slug === slug) ?? null
}

export function ensureFullTexts(member: Member) {
  if (!member.textsTruncated || fullMembers.has(member.slug) || fullInflight.has(member.slug)) return
  fullInflight.set(
    member.slug,
    fetch(`/api/member/${encodeURIComponent(member.slug)}`)
      .then((r) => {
        if (r.status === 401) {
          requireLogin() // the talk side is gated — open the login screen
          throw new Error('auth required')
        }
        return r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))
      })
      .then((m: Member) => {
        fullMembers.set(m.slug, m)
        fullTick++
      })
      .catch(() => {
        /* offline / old server: thread renders with slim texts (media still
           shows; old text bubbles empty) — same graceful stance as ever */
      })
      .finally(() => fullInflight.delete(member.slug)),
  )
}

/* ---- archive: reactive, swappable in place (docs/inplace-reindex.md) ----
   main.ts polls /api/version and swaps a freshly fetched index into this
   state instead of reloading the page — playback, volume, scroll and the
   open thread all survive. Set before mount, so consumers see a non-null
   archive from the first render on. */
let archive = $state<Archive | null>(null)

export function getArchive(): Archive | null {
  return archive
}

/* a cached member is stale when its message list moved: count changed, or any
   message's id / updated_at / missing-flag differs. Text is compared with
   text nulled out on BOTH sides — the served index truncates old texts, and
   filling them back in is this cache's whole job. Member-level cosmetics
   (avatar / single artwork changes) are accepted-stale until a real reload. */
function memberChanged(cached: Member, fresh: Member): boolean {
  const body = (m: Msg) => ({ ...m, text: null })
  return (
    cached.message_count !== fresh.message_count ||
    JSON.stringify(cached.messages.map(body)) !== JSON.stringify(fresh.messages.map(body))
  )
}

export function setArchive(next: Archive) {
  for (const [slug, cached] of fullMembers) {
    const fresh = next.members.find((m) => m.slug === slug)
    if (!fresh || memberChanged(cached, fresh)) fullMembers.delete(slug)
  }
  archive = next
  fullTick++
}

/* ---- one media at a time ----------------------------------------------
   A voice bubble and a lightbox video are independent elements; whoever plays
   claims the bus, which pauses whatever was playing before. */
let activeEl: HTMLMediaElement | null = null

export function claimMedia(el: HTMLMediaElement) {
  if (activeEl && activeEl !== el) activeEl.pause()
  activeEl = el
}
export function releaseMedia(el: HTMLMediaElement) {
  if (activeEl === el) activeEl = null
}
/* pause whatever the bus holds — closing the lightbox, etc. */
export function pauseActiveMedia() {
  if (activeEl) activeEl.pause()
}

export function showLightbox(items: Msg[], index: number, slug: string) {
  lightbox.items = items
  lightbox.i = index
  lightbox.memberSlug = slug
  lightbox.kind = 'message'
  lightbox.open = true
  /* the URL follows via App.svelte's hash effect: an open lightbox is its
     own #/media/<slug>/<id> route, whatever screen it was opened from */
}
export function closeLightbox() {
  lightbox.open = false
}
export function stepLightbox(d: number) {
  /* clamp instead of wrap — the ends of the media list are hard stops */
  lightbox.i = Math.min(Math.max(lightbox.i + d, 0), lightbox.items.length - 1)
}

/* blog post images reuse the same viewer as message media — synthetic
   picture items, no deep-link (the post itself owns the address) */
export function showBlogLightbox(srcs: string[], index: number, at: string, caption: string | null) {
  lightbox.items = srcs.map((src, n) => ({
    id: -1 - n,
    type: 'picture',
    at,
    updated: at,
    text: caption,
    silent: false,
    fav: false,
    mime: null,
    file: src,
    thumb: null,
    poster: null,
    ratio: null,
    dur: null,
    missing: false,
  }))
  lightbox.i = index
  lightbox.memberSlug = null
  lightbox.kind = 'blog'
  lightbox.open = true
}

/* "last read" markers -> the unread pill on the home grid + the "New" divider. */
const KEY = 'sakamichi-viewer:seen:'

function loadSeen(): Record<string, string> {
  try {
    const out: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(KEY)) out[k.slice(KEY.length)] = localStorage.getItem(k)!
    }
    return out
  } catch {
    return {}
  }
}

export const seen = $state<Record<string, string>>(loadSeen())

export function unreadCount(slug: string, messages: Msg[]): number {
  const at = seen[slug]
  if (at === undefined) return messages.length
  return messages.filter((m) => m.at > at).length
}

export function markSeen(slug: string, at: string | null) {
  if (!at) return
  if (seen[slug] && seen[slug] >= at) return
  seen[slug] = at
  try {
    localStorage.setItem(KEY + slug, at)
  } catch {
    /* private mode — unread tracking just won't persist */
  }
}

export const seenAt = (slug: string) => seen[slug]
