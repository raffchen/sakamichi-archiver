import type { Msg } from './types'

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
  /* search scope: the Talk page's bar searches everything, the Blog tab's
     searches blog posts only (server filters with ?type=blog) */
  searchBlog: false,
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
  ui.searchBlog = false
  ui.blogMember = member
  ui.blogPost = post
}
export function back(archiveMembers: { slug: string }[] | null) {
  if (ui.view === 'gallery' && ui.slug) ui.view = 'thread'
  else if (ui.view === 'blog' && ui.blogPost != null) openBlog(ui.blogMember)
  else if (ui.view === 'blog' && ui.blogMember) openBlog()
  else if (ui.view === 'search' && ui.searchBlog) {
    ui.searchBlog = false
    openBlog()
  } else goHome()
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
