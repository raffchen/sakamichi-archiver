import type { Archive, Member, Msg } from './types'
import { requireLogin } from './auth.svelte'

/* Shared app state (Svelte 5 runes in a .svelte.ts module). */

export type View = 'home' | 'thread' | 'gallery' | 'search' | 'blog'

/* the Blogs ⇅ menu: every mode ascends/descends — generation, name, or the
   cross-member newest-posts feed */
export type BlogSort = 'gen-asc' | 'gen-desc' | 'name-asc' | 'name-desc' | 'latest' | 'oldest'
/* the same ids as a runtime list — App.svelte's hash router validates the
   #/blog/<site>/<sort> segment against this */
export const BLOG_SORT_IDS: readonly BlogSort[] = [
  'gen-asc',
  'gen-desc',
  'name-asc',
  'name-desc',
  'latest',
  'oldest',
]
/* a member's list is flat — only the two feed directions apply */
export type MemberSort = 'latest' | 'oldest'

/* legacy all-sites form of the graduated filter (boolean per device); kept
   only to migrate the old value into the per-site list below */
const HIDE_GRAD_KEY = 'sakamichi-viewer:blog-hide-graduated'
/* blog directory: sites whose graduated members are hidden, persisted as a
   list of site keys — absent = shown, so every site starts unfiltered */
const HIDE_GRAD_SITES_KEY = 'sakamichi-viewer:blog-hide-graduated-sites'

function loadGradSites(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(HIDE_GRAD_SITES_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/* blog directory: generations hidden via the ⚙ menu, persisted as a list of
   "site:gen" entries ("site:other" for gen-less members). Absent = shown,
   so every generation starts checked. */
const HIDDEN_GENS_KEY = 'sakamichi-viewer:blog-hidden-gens'

function loadHiddenGens(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(HIDDEN_GENS_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/* dark mode: a binary device preference, persisted like volume and the blog
   settings. The index.html inline script reads the same key before first
   paint so a reload in dark doesn't flash light. */
export type Theme = 'light' | 'dark'
const THEME_KEY = 'sakamichi-viewer:theme'

function loadTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/* posts per member-list page. Read by the pager and the back-from-post page
   restore; a candidate for a user setting, so it lives here rather than in
   the BlogMember component. */
export const BLOG_PER_PAGE = 25

export const ui = $state({
  view: 'home' as View,
  slug: null as string | null,
  focusId: null as number | null,
  site: 'nogizaka46',
  query: '',
  /* search scope: the Talk page's bar searches messages, the Blog directory's
     searches all posts, and a member's bar/icon searches just their own posts
     or messages (?type=message|blog plus ?member=<key> on /api/search) */
  searchScope: 'message' as 'message' | 'message-member' | 'blog' | 'blog-member',
  /* blog tab: directory -> member post list -> post detail */
  blogMember: null as string | null, // directory key under media/blogs/
  blogPost: null as number | null,
  blogPage: 1 as number, // member-list page (1-based); baked into the URL as #/blog/<key>/p/<n>
  /* 0-based newest-first rank of the post on screen, from the detail fetch.
     A navigation hint (never in the hash): back() turns it into the list
     page holding that post, so back works after refresh/deep links and
     under any page size. Null until the detail fetch lands. */
  blogPostRank: null as number | null,
  /* where the on-screen post was opened FROM — the in-app back button
     returns there (feed, the member's list, or the search that surfaced
     the post). Set by parseHash when a post deep link lands from another
     view; kept across prev/next within the post view. Null = unknown
     (programmatic open / direct load) — back() then falls back to the
     member's list, the pre-feed behavior. */
  blogPostFrom: null as
    | null
    | { kind: 'feed' }
    | { kind: 'member' }
    | { kind: 'search'; scope: 'blog' | 'blog-member' },
  /* directory sort (the official ⇅ menu) */
  blogSort: 'gen-asc' as BlogSort,
  blogFeedPage: 1 as number, // cross-member feed page (1-based); #/blog/<site>/<sort>/p/<n>
  /* member list order (the ⇅ menu on the member's list). 'latest' is the
     default and stays bare in the URL; 'oldest' shows as
     #/blog/<key>/oldest/p/<n>. parseHash sets it explicitly from the URL on
     every member navigation, and it rides along through prev/next via the
     post links so back() computes the page in the same ordering. */
  blogMemberSort: 'latest' as MemberSort,
  /* directory setting: sites hiding graduated members' cards (the ⚙ menu,
     per site). A device preference, so it persists like volume does. */
  blogGradHiddenSites: loadGradSites(),
  /* directory setting: hidden generations (the ⚙ menu, per site) — see
     loadHiddenGens above. A device preference too. */
  blogHiddenGens: loadHiddenGens(),
  /* light/dark surfaces (index.html applies it pre-paint; App keeps it in
     sync). The per-site header colors are theme-independent for now. */
  theme: loadTheme(),
})

export function gradHiddenFor(site: string): boolean {
  return ui.blogGradHiddenSites.includes(site)
}

export function setGradHiddenFor(site: string, v: boolean) {
  const i = ui.blogGradHiddenSites.indexOf(site)
  if (v && i < 0) ui.blogGradHiddenSites.push(site)
  else if (!v && i >= 0) ui.blogGradHiddenSites.splice(i, 1)
  try {
    localStorage.setItem(HIDE_GRAD_SITES_KEY, JSON.stringify(ui.blogGradHiddenSites))
  } catch {
    /* private mode — the toggle just won't survive reloads */
  }
}

/* one-time migration: the old all-sites boolean becomes a per-site entry for
   every site the archive knows. Runs once the archive is loaded (the Blog
   tab calls it with its site keys); the new key's presence marks it done. */
export function migrateHideGraduated(sites: string[]) {
  let legacy: string | null = null
  try {
    legacy = localStorage.getItem(HIDE_GRAD_KEY)
  } catch {
    return
  }
  if (legacy == null || localStorage.getItem(HIDE_GRAD_SITES_KEY) != null) return
  try {
    localStorage.removeItem(HIDE_GRAD_KEY)
  } catch {}
  if (legacy === '1') {
    ui.blogGradHiddenSites = [...sites]
    try {
      localStorage.setItem(HIDE_GRAD_SITES_KEY, JSON.stringify(ui.blogGradHiddenSites))
    } catch {
      /* private mode — in-memory value still applies for this session */
    }
  }
}

/* the persisted key for one generation of one site; "other" covers members
   with no generation (the その他 section) */
export function genSettingKey(site: string, gen: number | null): string {
  return `${site}:${gen ?? 'other'}`
}

export function toggleGenHidden(key: string) {
  const i = ui.blogHiddenGens.indexOf(key)
  if (i >= 0) ui.blogHiddenGens.splice(i, 1)
  else ui.blogHiddenGens.push(key)
  try {
    localStorage.setItem(HIDDEN_GENS_KEY, JSON.stringify(ui.blogHiddenGens))
  } catch {
    /* private mode — the toggles just won't survive reloads */
  }
}

export function setTheme(t: Theme) {
  ui.theme = t
  try {
    if (t === 'dark') localStorage.setItem(THEME_KEY, 'dark')
    else localStorage.removeItem(THEME_KEY) // light is the default — no key
  } catch {
    /* private mode — the toggle just won't survive reloads */
  }
}

export function toggleTheme() {
  setTheme(ui.theme === 'dark' ? 'light' : 'dark')
}

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
/* search one member's messages, opened from the thread header's magnifier */
/* Identifies the search context a visible search bar belongs to. The App
   clears the shared query whenever this changes, so a query typed for one
   scope (talk / a member's blog / the full blog list) never lingers in
   another. Screens with no search bar (thread, gallery, blog post) return
   null — the context is left untouched, so opening a hit and returning keeps
   the search. A list and its own search screen are deliberately distinct
   contexts, so going back from a member's blog search clears that bar. */
export function searchBarContext(): string | null {
  if (ui.view === 'search') {
    const member =
      ui.searchScope === 'blog-member' ? ui.blogMember : ui.searchScope === 'message-member' ? ui.slug : ''
    return `search:${ui.searchScope}${member ? ':' + member : ''}`
  }
  if (ui.view === 'home') return 'talk'
  if (ui.view === 'blog') {
    if (ui.blogPost != null) return null // post detail has no bar
    return ui.blogMember ? `blog-member:${ui.blogMember}` : 'blog'
  }
  return null // thread / gallery — no bar
}

export function openMemberSearch(slug: string) {
  ui.view = 'search'
  ui.slug = slug
  ui.searchScope = 'message-member'
}
export function openBlog(member: string | null = null, post: number | null = null) {
  ui.view = 'blog'
  ui.searchScope = 'message'
  if (member !== ui.blogMember) ui.blogPage = 1
  ui.blogMember = member
  ui.blogPost = post
}
/* the Blog tab button: the tab's home — the member directory at the default
   sort, feed page 1. Unlike openBlog() (which preserves the current sort and
   page for back()/prev-next flows), re-entering the tab from its button
   always starts fresh. Same state a bare #/blog/<site> deep link produces. */
export function openBlogTab() {
  ui.blogSort = 'gen-asc'
  ui.blogFeedPage = 1
  openBlog()
}
export function back(archiveMembers: { slug: string }[] | null) {
  if (ui.view === 'gallery' && ui.slug) ui.view = 'thread'
  else if (ui.view === 'blog' && ui.blogPost != null) {
    /* back returns to where the post was opened from (blogPostFrom, set by
       parseHash). Member list (or unknown origin): the list page comes from
       the post's rank, not from ui.blogPage — that way back lands on the
       right page even after a refresh or a shared post link (whose hash
       carries no page), and it tracks the page size setting. Falls back to
       the current blogPage while the detail fetch is still in flight.
       prev/next chaining updates the rank per post, so back follows the
       post you're ON. openBlog keeps it (same member). Feed origin: the
       sort and feed page are still in the store, so just drop the post. */
    const from = ui.blogPostFrom
    if (from?.kind === 'feed') {
      openBlog(null) // blogMember=null → the newest/oldest feed, same page
    } else if (from?.kind === 'search') {
      ui.blogPost = null
      ui.view = 'search'
      ui.searchScope = from.scope // ui.query is untouched — results re-fetch
    } else {
      if (ui.blogPostRank != null) ui.blogPage = Math.floor(ui.blogPostRank / BLOG_PER_PAGE) + 1
      openBlog(ui.blogMember)
    }
  }
  else if (ui.view === 'blog' && ui.blogMember) openBlog()
  else if (ui.view === 'search' && ui.searchScope === 'message-member') ui.view = 'thread'
  else if (ui.view === 'search' && ui.searchScope === 'blog-member') openBlog(ui.blogMember)
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
