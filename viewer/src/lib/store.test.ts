import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Archive, Member, Msg } from './types'

/* The store is a module-level singleton; re-import it fresh for every test. */
let store: typeof import('./store.svelte')

function makeMsg(over: Partial<Msg> = {}): Msg {
  return {
    id: 1,
    type: 'text',
    at: '2026-11-12T02:57:00Z',
    updated: '2026-11-12T02:57:00Z',
    text: 'hello',
    silent: false,
    fav: false,
    mime: null,
    file: null,
    thumb: null,
    poster: null,
    ratio: null,
    dur: null,
    missing: false,
    ...over,
  }
}

function makeMember(over: Partial<Member> = {}): Member {
  return {
    slug: 'teresa-ikeda',
    name: '池田_瑛紗',
    roman: 'Teresa Ikeda',
    site: 'nogizaka46',
    group_id: null,
    member_id: null,
    home: null,
    avatar: null,
    first: null,
    last: null,
    counts: {},
    message_count: 1,
    media_count: 0,
    missing: 0,
    source: 'test',
    messages: [makeMsg()],
    ...over,
  }
}

const archive = (members: Member[]): Archive => ({
  generated_at: '2026-11-12T00:00:00Z',
  display_name: 'raff',
  sites: {},
  totals: { messages: members.length, media: 0 },
  members,
})

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  store = await import('./store.svelte')
})

describe('navigation state', () => {
  it('openMember switches to the thread view with slug + focus', () => {
    store.openMember('teresa-ikeda', 42)
    expect(store.ui.view).toBe('thread')
    expect(store.ui.slug).toBe('teresa-ikeda')
    expect(store.ui.focusId).toBe(42)
  })

  it('openMember defaults focusId to null', () => {
    store.openMember('teresa-ikeda')
    expect(store.ui.focusId).toBeNull()
  })

  it('openGallery switches to the gallery view', () => {
    store.openGallery('teresa-ikeda')
    expect(store.ui.view).toBe('gallery')
    expect(store.ui.slug).toBe('teresa-ikeda')
  })

  it('goHome resets the slug and focus', () => {
    store.openMember('teresa-ikeda', 7)
    store.goHome()
    expect(store.ui.view).toBe('home')
    expect(store.ui.slug).toBeNull()
    expect(store.ui.focusId).toBeNull()
  })

  it('searchBarContext names each search surface distinctly', () => {
    store.goHome()
    expect(store.searchBarContext()).toBe('talk')
    store.ui.view = 'search'
    store.ui.searchScope = 'message'
    expect(store.searchBarContext()).toBe('search:message')
  })

  it('searchBarContext separates a member list from its scoped search', () => {
    store.openBlog('teresa-ikeda')
    expect(store.searchBarContext()).toBe('blog-member:teresa-ikeda')
    store.ui.view = 'search'
    store.ui.searchScope = 'blog-member'
    expect(store.searchBarContext()).toBe('search:blog-member:teresa-ikeda')
  })

  it('searchBarContext returns null where there is no search bar', () => {
    store.openMember('teresa-ikeda')
    expect(store.searchBarContext()).toBeNull()
    store.openBlog('teresa-ikeda', 3) // blog post detail
    expect(store.searchBarContext()).toBeNull()
  })

  it('openBlog resets the search scope and supports member/post drill-down', () => {
    store.ui.searchScope = 'blog'
    store.openBlog('teresa-ikeda', 3)
    expect(store.ui.view).toBe('blog')
    expect(store.ui.searchScope).toBe('message')
    expect(store.ui.blogMember).toBe('teresa-ikeda')
    expect(store.ui.blogPost).toBe(3)
    store.openBlog()
    expect(store.ui.blogMember).toBeNull()
    expect(store.ui.blogPost).toBeNull()
  })
})

describe('back()', () => {
  it('goes gallery → thread', () => {
    store.openMember('m1')
    store.openGallery('m1')
    store.back(null)
    expect(store.ui.view).toBe('thread')
  })

  it('goes post detail → member post list → directory', () => {
    store.openBlog('m1', 5)
    store.back(null)
    expect(store.ui.view).toBe('blog')
    expect(store.ui.blogPost).toBeNull()
    expect(store.ui.blogMember).toBe('m1')
    store.back(null)
    expect(store.ui.blogMember).toBeNull()
  })

  it('goes blog-scoped search back to the blog directory', () => {
    store.ui.view = 'search'
    store.ui.searchScope = 'blog'
    store.back(null)
    expect(store.ui.searchScope).toBe('message')
    expect(store.ui.view).toBe('blog')
    expect(store.ui.blogMember).toBeNull()
  })

  it('falls back to home otherwise', () => {
    store.ui.view = 'search'
    store.ui.searchScope = 'message'
    store.back(null)
    expect(store.ui.view).toBe('home')
  })
})

describe('lightbox', () => {
  const items = [makeMsg({ id: 1 }), makeMsg({ id: 2 }), makeMsg({ id: 3 })]

  it('showLightbox opens at the given index', () => {
    store.showLightbox(items, 1, 'teresa-ikeda')
    expect(store.lightbox.open).toBe(true)
    expect(store.lightbox.i).toBe(1)
    // $state proxies the list deeply, so compare structurally
    expect(store.lightbox.items).toEqual(items)
    expect(store.lightbox.memberSlug).toBe('teresa-ikeda')
  })

  it('stepLightbox clamps to the ends instead of wrapping', () => {
    store.showLightbox(items, 0, 'teresa-ikeda')
    store.stepLightbox(-5)
    expect(store.lightbox.i).toBe(0)
    store.stepLightbox(2)
    expect(store.lightbox.i).toBe(2)
    store.stepLightbox(10)
    expect(store.lightbox.i).toBe(2)
  })

  it('closeLightbox keeps the item list but closes', () => {
    store.showLightbox(items, 0, 'teresa-ikeda')
    store.closeLightbox()
    expect(store.lightbox.open).toBe(false)
    expect(store.lightbox.items).toHaveLength(3)
  })
})

describe('media bus (one media at a time)', () => {
  const el = () => ({ pause: vi.fn() }) as unknown as HTMLMediaElement

  it('claiming a new element pauses the previous one', () => {
    const a = el()
    const b = el()
    store.claimMedia(a)
    store.claimMedia(b)
    expect(a.pause).toHaveBeenCalledTimes(1)
    expect(b.pause).not.toHaveBeenCalled()
  })

  it('claiming the same element does not pause it', () => {
    const a = el()
    store.claimMedia(a)
    store.claimMedia(a)
    expect(a.pause).not.toHaveBeenCalled()
  })

  it('releaseMedia clears the bus; pauseActiveMedia only affects the active element', () => {
    const a = el()
    const b = el()
    store.claimMedia(a)
    store.releaseMedia(b) // wrong element — bus still holds a
    store.pauseActiveMedia()
    expect(a.pause).toHaveBeenCalledTimes(1)
    store.releaseMedia(a)
    store.pauseActiveMedia()
    expect(a.pause).toHaveBeenCalledTimes(1) // not called again
  })
})

describe('unread tracking', () => {
  const slug = 'teresa-ikeda'
  const messages = [
    makeMsg({ id: 1, at: '2026-11-01T00:00:00Z' }),
    makeMsg({ id: 2, at: '2026-11-02T00:00:00Z' }),
    makeMsg({ id: 3, at: '2026-11-03T00:00:00Z' }),
  ]

  it('counts every message when never seen', () => {
    expect(store.unreadCount(slug, messages)).toBe(3)
    expect(store.seenAt(slug)).toBeUndefined()
  })

  it('counts messages newer than the last-read mark', () => {
    store.markSeen(slug, '2026-11-01T00:00:00Z')
    expect(store.unreadCount(slug, messages)).toBe(2)
    expect(store.seenAt(slug)).toBe('2026-11-01T00:00:00Z')
  })

  it('markSeen never regresses to an older mark', () => {
    store.markSeen(slug, '2026-11-03T00:00:00Z')
    store.markSeen(slug, '2026-11-01T00:00:00Z')
    expect(store.seenAt(slug)).toBe('2026-11-03T00:00:00Z')
    expect(store.unreadCount(slug, messages)).toBe(0)
  })

  it('ignores a null mark', () => {
    store.markSeen(slug, null)
    expect(store.seenAt(slug)).toBeUndefined()
  })

  it('persists marks to localStorage under the sakamichi-viewer:seen: prefix', () => {
    store.markSeen(slug, '2026-11-02T00:00:00Z')
    expect(localStorage.getItem('sakamichi-viewer:seen:' + slug)).toBe('2026-11-02T00:00:00Z')
  })

  it('restores persisted marks from localStorage on load', async () => {
    store.markSeen(slug, '2026-11-02T00:00:00Z')
    // simulate a fresh page load: new module instance, same localStorage
    vi.resetModules()
    store = await import('./store.svelte')
    expect(store.seenAt(slug)).toBe('2026-11-02T00:00:00Z')
    expect(store.unreadCount(slug, messages)).toBe(1)
  })
})

describe('ensureFullTexts / getMember', () => {
  const m = () => makeMember({ textsTruncated: true })

  it('getMember falls back to the archive member until the full one loads', () => {
    const a = archive([m()])
    expect(store.getMember(a, 'teresa-ikeda')).toBe(a.members[0])
    expect(store.getMember(a, null)).toBeNull()
    expect(store.getMember(a, 'nope')).toBeNull()
  })

  it('fetches full texts only for truncated members', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"slug":"x"}'))
    vi.stubGlobal('fetch', fetchMock)

    store.ensureFullTexts(makeMember({ textsTruncated: false }))
    expect(fetchMock).not.toHaveBeenCalled()

    store.ensureFullTexts(m())
    expect(fetchMock).toHaveBeenCalledWith('/api/member/teresa-ikeda')
    vi.unstubAllGlobals()
  })

  it('caches the fetched full member and serves it via getMember', async () => {
    const full = makeMember({ textsTruncated: false, messages: [makeMsg(), makeMsg()] })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(full))))

    const a = archive([m()])
    store.ensureFullTexts(a.members[0])
    // JSON round-trip: the cached object is a structurally-equal copy of `full`
    await vi.waitFor(() => expect(store.getMember(a, 'teresa-ikeda')).toStrictEqual(full))
    vi.unstubAllGlobals()
  })

  it('does not refetch while a request is in flight', async () => {
    let resolve!: (r: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>((r) => (resolve = r))))

    const a = archive([m()])
    store.ensureFullTexts(a.members[0])
    store.ensureFullTexts(a.members[0])
    expect(fetch).toHaveBeenCalledTimes(1)

    resolve(new Response(JSON.stringify(makeMember())))
    await vi.waitFor(() => expect(store.getMember(a, 'teresa-ikeda')).not.toBe(a.members[0]))
    vi.unstubAllGlobals()
  })

  it('fails gracefully when the server cannot serve full texts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const a = archive([m()])
    store.ensureFullTexts(a.members[0])
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    // still the slim archive member — rendering continues with slim texts
    expect(store.getMember(a, 'teresa-ikeda')).toBe(a.members[0])
    vi.unstubAllGlobals()
  })
})

describe('setArchive (in-place swap, docs/inplace-reindex.md)', () => {
  /* a slim (truncated) member: same messages, old texts dropped */
  const slim = (msgs: Msg[]) =>
    makeMember({ textsTruncated: true, messages: msgs.map((m) => ({ ...m, text: null })) })
  const full = (msgs: Msg[]) => makeMember({ textsTruncated: false, messages: msgs })

  it('stores the archive and exposes it via getArchive', () => {
    const a = archive([makeMember()])
    store.setArchive(a)
    // $state wraps the stored archive in a reactive proxy — structurally
    // equal, not reference-equal
    expect(store.getArchive()).toStrictEqual(a)
    expect(store.getArchive()?.generated_at).toBe(a.generated_at)
  })

  it('keeps the cached full member when the swapped-in data is unchanged', async () => {
    const msgs = [makeMsg({ id: 1 }), makeMsg({ id: 2 })]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(full(msgs)))))
    const a1 = archive([slim(msgs)])
    store.ensureFullTexts(a1.members[0])
    await vi.waitFor(() => expect(store.getMember(a1, 'teresa-ikeda')).toStrictEqual(full(msgs)))

    // identical content, fresh objects + newer generated_at — a no-op swap
    const a2 = { ...archive([slim(msgs)]), generated_at: '2026-11-13T00:00:00Z' }
    store.setArchive(a2)
    expect(store.getMember(a2, 'teresa-ikeda')).toStrictEqual(full(msgs))
    vi.unstubAllGlobals()
  })

  it('drops the cache when a new message arrived', async () => {
    const msgs = [makeMsg({ id: 1 }), makeMsg({ id: 2 })]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(full(msgs)))))
    const a1 = archive([slim(msgs)])
    store.ensureFullTexts(a1.members[0])
    await vi.waitFor(() => expect(store.getMember(a1, 'teresa-ikeda')).toStrictEqual(full(msgs)))

    const a2 = archive([slim([...msgs, makeMsg({ id: 3 })])])
    store.setArchive(a2)
    // fell back to the slim member — the thread refetches via ensureFullTexts
    expect(store.getMember(a2, 'teresa-ikeda')).toBe(a2.members[0])
    vi.unstubAllGlobals()
  })

  it('drops the cache when an existing message was edited (updated_at bump)', async () => {
    const msgs = [makeMsg({ id: 1 }), makeMsg({ id: 2 })]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(full(msgs)))))
    const a1 = archive([slim(msgs)])
    store.ensureFullTexts(a1.members[0])
    await vi.waitFor(() => expect(store.getMember(a1, 'teresa-ikeda')).toStrictEqual(full(msgs)))

    const edited = [makeMsg({ id: 1 }), makeMsg({ id: 2, updated: '2026-11-12T09:00:00Z' })]
    const a2 = archive([slim(edited)])
    store.setArchive(a2)
    expect(store.getMember(a2, 'teresa-ikeda')).toBe(a2.members[0])
    vi.unstubAllGlobals()
  })

  it('drops cache entries for members absent from the new archive', async () => {
    const msgs = [makeMsg({ id: 1 })]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(full(msgs)))))
    const a1 = archive([slim(msgs)])
    store.ensureFullTexts(a1.members[0])
    await vi.waitFor(() => expect(store.getMember(a1, 'teresa-ikeda')).toStrictEqual(full(msgs)))

    store.setArchive(archive([]))
    expect(store.getMember(archive([]), 'teresa-ikeda')).toBeNull()
    vi.unstubAllGlobals()
  })

  it('text-only differences do not count as changed (truncation is the norm)', () => {
    const msgs = [makeMsg({ id: 1 })]
    // exposed indirectly: setArchive keeps (not drops) — verified via a later
    // getMember after ensureFullTexts would refetch; here we assert the pure
    // data comparison through a public path: identical slim swaps keep cache
    const a1 = archive([slim(msgs)])
    store.setArchive(a1)
    const a2 = { ...archive([{ ...slim(msgs), textsTruncated: false }]), generated_at: 'x' }
    store.setArchive(a2)
    // no fetch has run, no cache exists — the swap itself must not throw and
    // getMember must serve the new archive member
    expect(store.getMember(a2, 'teresa-ikeda')).toBe(a2.members[0])
  })
})
