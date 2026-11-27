<script lang="ts">
  import { onMount } from 'svelte'
  import {
    BLOG_SORT_IDS,
    closeLightbox,
    getArchive,
    getMember,
    info,
    lightbox,
    searchBarContext,
    showLightbox,
    ui,
    type BlogSort,
    type View,
  } from './lib/store.svelte'
  import Gallery from './components/Gallery.svelte'
  import Blog from './components/Blog.svelte'
  import Home from './components/Home.svelte'
  import InfoSheet from './components/InfoSheet.svelte'
  import Lightbox from './components/Lightbox.svelte'
  import SearchScreen from './components/SearchScreen.svelte'
  import TabBar from './components/TabBar.svelte'
  import Thread from './components/Thread.svelte'
  import Login from './components/Login.svelte'
  import { auth, checkAuth } from './lib/auth.svelte'
  import { disp } from './lib/display'

  /* the archive lives in the store so an in-place swap (no page reload) can
     replace it under the running app — set before mount, hence the assert */
  const archive = $derived(getArchive()!)

  const siteKeys = $derived(Object.keys(archive.sites))
  const members = $derived(archive.members.filter((m) => (m.site ?? 'nogizaka46') === ui.site))
  /* stage 4: the thread/gallery member upgrades to the full-text fetch once it lands */
  const current = $derived(getMember(archive, ui.slug))

  let routed = $state(false)

  /* the login gate covers every talk view; blog views (both blog searches,
     directory-wide and per-member) are public. A message lightbox is gated. */
  const publicBlogSearch = $derived(
    ui.view === 'search' && (ui.searchScope === 'blog' || ui.searchScope === 'blog-member'),
  )
  const talkView = $derived(!(ui.view === 'blog' || publicBlogSearch))

  /* Clear the shared search query when the visible search context changes, so
     a search in one scope doesn't linger in another (blog tab → talk tab, a
     member's blog search → the blog list, …). Screens without a bar report
     null and are ignored, so an open-and-return through a result keeps the
     search. Runs before paint, so the destination bar never flashes stale. */
  let lastBarCtx: string | null = null
  $effect(() => {
    const ctx = searchBarContext()
    if (ctx === null || ctx === lastBarCtx) return
    lastBarCtx = ctx
    ui.query = ''
  })

  /* the active site drives the whole theme (purple / pale pink); the theme
     attribute mirrors the store (index.html set it pre-paint) */
  $effect(() => {
    document.documentElement.dataset.site = ui.site
    document.documentElement.dataset.theme = ui.theme
    /* the browser chrome bar follows the header — saka's solid pink, nogi's
       purple; identical in both themes since the headers don't change */
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
      'content',
      ui.site === 'sakurazaka46' ? '#de8fa9' : ui.site === 'hinatazaka46' ? '#5bb2e5' : '#a03fbf',
    )
    /* title follows the topmost screen: thread/gallery member, blog member
       (or the Blogs directory), "Messages" on the talk side — ui.slug
       intentionally lingers when a blog is open, so the blog view must be
       checked first */
    let who: string
    if (ui.view === 'blog' || publicBlogSearch) {
      const b = archive.blogs?.members.find((m) => m.key === ui.blogMember)
      who = ui.blogMember ? (b?.name ?? ui.blogMember.replace(/_/g, ' ')) : 'Blogs'
    } else if (current) {
      who = disp(current)
    } else {
      who = 'Messages'
    }
    document.title = `${who} — 坂道 Message アーカイブ`
  })

  /* hash <-> state: Back, reload and deep links all work. The URL names the
     topmost screen: an open lightbox is its own #/media/<slug>/<id> route
     whether it was opened from a thread or the gallery; without it the
     thread/gallery addresses carry the scroll focus */
  function hashFor(v: View, slug: string | null, focus: number | null) {
    /* only the message lightbox owns the address; blog post images keep the
       post's own #/blog/<key>/<post> URL */
    if (lightbox.open && lightbox.kind === 'message') {
      const cur = lightbox.items[lightbox.i]
      if (cur) return `#/media/${encodeURIComponent(lightbox.memberSlug ?? '')}/${cur.id}`
    }
    /* every screen names its site explicitly — no implicit default group */
    if (v === 'home') return `#/talk/${encodeURIComponent(ui.site)}`
    const s = slug ? encodeURIComponent(slug) : ''
    return `#/${v}${s ? '/' + s : ''}${focus ? '/' + focus : ''}`
  }

  /* whether the CURRENT history entry is a #/media route the app itself
     pushed by opening the lightbox (vs one the browser loaded directly —
     a paste/refresh). Closing pops the former (history.back) and rewrites
     the latter (replaceState): replaceState alone can never remove the
     pushed entry, which is what used to stack one history entry per
     open/close cycle. parseHash runs on every Back/Forward/hash edit, so
     it re-derives this from scratch — only the push branch (below) can
     set it true. */
  let mediaWasPushed = false

  function parseHash() {
    mediaWasPushed = false
    /* origin snapshot for blogPostFrom (the in-app back button's return
       target): read BEFORE anything below mutates the store — the blog
       branch overwrites view/scope/member on its way in */
    const wasView = ui.view
    const wasBlogMember = ui.blogMember
    const wasBlogSort = ui.blogSort
    const wasSearchScope = ui.searchScope
    const parts = location.hash.replace(/^#\/?/, '').split('/')
    /* 'site' is the pre-2026-02 name of the talk-directory route — kept as a
       legacy alias so old shared links still resolve */
    const route = (parts[0] || 'talk') as
      | View
      | 'talk'
      | 'site'
      | 'media'
      | 'blog-search'
      | 'blog-member-search'
      | 'member-search'
    const slug = parts[1] ? decodeURIComponent(parts[1]) : null
    const focus = parts[2] ? Number(parts[2]) : null
    const hit = slug ? archive.members.find((m) => m.slug === slug) : null
    if (hit?.site) ui.site = hit.site
    /* Back/Forward or an edited URL: leaving the media route closes the
       lightbox — its state is part of the address, not independent of it.
       Blog-image lightboxes don't write the URL, so ANY hash change means the
       user navigated — close them too */
    if (lightbox.open && (lightbox.kind !== 'message' || route !== 'media')) closeLightbox()
    if (route === 'thread' && hit) {
      ui.view = 'thread'
      ui.slug = slug
      ui.focusId = focus
    } else if (route === 'media' && hit) {
      /* pasted/refreshed link: the thread mounts behind the viewer, scrolled
         to the message; a text id (or a stale one) degrades to that scroll */
      ui.view = 'thread'
      ui.slug = slug
      ui.focusId = focus
      const msg = focus != null ? hit.messages.find((m) => m.id === focus) : null
      if (msg?.file && slug) {
        const media = hit.messages.filter((m) => m.file)
        showLightbox(media, media.findIndex((x) => x.id === focus), slug)
      } else {
        closeLightbox()
      }
    } else if ((route === 'talk' || route === 'site') && archive.sites[slug ?? '']) {
      ui.site = slug!
      ui.view = 'home'
      ui.slug = null
      ui.focusId = null
    } else if (route === 'gallery' && hit) {
      ui.view = 'gallery'
      ui.slug = slug
      ui.focusId = null   // the lightbox is addressed by #/media now
    } else if (route === 'blog') {
      ui.view = 'blog'
      /* parity with openBlog(): a hash navigation into the blog tab (these
         routes are real <a href> links now) must drop a stale search scope
         the same way the programmatic open did */
      ui.searchScope = 'message'
      /* #/blog/<site> names a site directory, #/blog alone falls back to the
         current site (the hash effect rewrites it to the explicit form);
         site keys are ASCII, member keys are 日本語 — they can't collide.
         #/blog/<key> = member list page 1;
         #/blog/<key>/p/<n> = member list on page n;
         #/blog/<key>/<postId> = single post */
      if (slug && archive.sites[slug]) {
        ui.site = slug
        ui.blogMember = null
        ui.blogPost = null
        ui.blogPage = 1
        const segs = parts.slice(2)
        /* #/blog/<site>/<sort> carries the ⇅ menu choice (default gen-asc is
           bare — see blogHash). The sort is set EXPLICITLY either way: bare
           means the default, so a bare #/blog/<site> arriving via hashchange
           (edited URL / same-document link) resets a non-default sort — and
           the state change is what makes the hash effect normalize the URL.
           An unrecognized segment (junk/old link) lands on the default too. */
        ui.blogSort =
          segs[0] && (BLOG_SORT_IDS as readonly string[]).includes(segs[0])
            ? (segs[0] as BlogSort)
            : 'gen-asc'
        /* feed page as p/<n> — like the member list's #/blog/<key>/p/<n>.
           Position depends on whether the sort segment is present:
           #/blog/<site>/p/<n> (gen-asc) or #/blog/<site>/<sort>/p/<n>. Set
           explicitly (page 1 when absent) so Back restores the page. */
        const pi = segs[0] === 'p' ? 0 : segs[1] === 'p' ? 1 : -1
        ui.blogFeedPage = pi >= 0 ? Math.max(1, Number(segs[pi + 1]) || 1) : 1
      } else {
        /* where is this post link landing FROM? Read before mutating state:
           a feed view (no member, feed sort) vs the search that surfaced the
           hit vs anything else (= member's list / directory / fresh load).
           Prev/next chaining within the post view (wasOnPost) keeps the
           origin — back from the 3rd post in a row still returns to the
           feed/search you started from. */
        const wasOnPost = wasView === 'blog' && ui.blogPost != null
        const cameFromSearch =
          wasView === 'search' && (wasSearchScope === 'blog' || wasSearchScope === 'blog-member')
        const cameFromFeed =
          wasView === 'blog' &&
          !wasBlogMember &&
          (wasBlogSort === 'latest' || wasBlogSort === 'oldest')
        ui.blogMember = slug
        if (parts[2] === 'p') {
          ui.blogPost = null
          ui.blogPage = Math.max(1, Number(parts[3]) || 1)
        } else {
          /* no p/<n> segment = page 1 — set it explicitly so Back from
             #/blog/<key>/p/2 to #/blog/<key> restores the first page */
          ui.blogPost = parts[2] ? Number(parts[2]) : null
          ui.blogPage = 1
        }
        /* a post is on screen: record where this navigation came from so the
           in-app back button returns there (blogPostFrom in the store). The
           scope comes from the SNAPSHOT — the blog branch has already reset
           ui.searchScope to 'message' by this point. */
        if (ui.blogPost != null && !wasOnPost)
          ui.blogPostFrom = cameFromSearch
            ? { kind: 'search', scope: wasSearchScope as 'blog' | 'blog-member' }
            : cameFromFeed
              ? { kind: 'feed' }
              : { kind: 'member' }
        /* a deep link names the member — adopt their site so the theme matches */
        if (slug) {
          const bm = archive.blogs?.members.find((b) => b.key === slug)
          if (bm?.site) ui.site = bm.site
        }
      }
    } else if (
      route === 'search' ||
      route === 'blog-search' ||
      route === 'blog-member-search' ||
      route === 'member-search'
    ) {
      ui.view = 'search'
      ui.focusId = null
      ui.blogPost = null
      /* #/blog-search directory-wide; #/blog-member-search/<key> one member's
         posts (back → their list); #/member-search/<slug> one member's
         messages from the thread header (back → the thread). The key/slug
         also adopts its site theme on reload/deep link. */
      if (route === 'member-search' && slug) {
        ui.searchScope = 'message-member'
        ui.slug = slug
        ui.blogMember = null
      } else if (route === 'blog-member-search' && slug) {
        ui.searchScope = 'blog-member'
        ui.blogMember = slug
        ui.slug = null
        const bm = archive.blogs?.members.find((b) => b.key === slug)
        if (bm?.site) ui.site = bm.site
      } else {
        ui.searchScope = route === 'blog-search' ? 'blog' : 'message'
        ui.slug = null
        ui.blogMember = null
      }
    } else {
      ui.view = 'home'
      ui.slug = null
      ui.focusId = null
      ui.blogMember = null
      ui.blogPost = null
    }
  }

  onMount(() => {
    parseHash()
    checkAuth() // ask once whether the login gate (VIEWER_PASSWORD) is on
    routed = true
    // popstate = browser Back/Forward; hashchange = an edited/pasted #url
    window.addEventListener('popstate', parseHash)
    window.addEventListener('hashchange', parseHash)
    return () => {
      window.removeEventListener('popstate', parseHash)
      window.removeEventListener('hashchange', parseHash)
    }
  })

  function searchHash() {
    if (ui.searchScope === 'blog-member') return `#/blog-member-search/${encodeURIComponent(ui.blogMember ?? '')}`
    if (ui.searchScope === 'message-member') return `#/member-search/${encodeURIComponent(ui.slug ?? '')}`
    if (ui.searchScope === 'blog') return '#/blog-search'
    return '#/search'
  }

  /* the sort segment regex — built from the store's id list so the router
     and the hash stay in sync (blogHash emits, parseHash validates) */
  const sortStrip = new RegExp(`^(#/blog/[^/]+)/(${BLOG_SORT_IDS.join('|')})$`)

  $effect(() => {
    if (!routed) return
    const want = ui.view === 'blog' ? blogHash() : ui.view === 'search' ? searchHash() : hashFor(ui.view, ui.slug, ui.focusId)
    if (location.hash === want) return
    /* toggling the ⇅ sort only swaps the view of the same screen — never a
       history entry. A sort-only diff (same URL with the sort segment added,
       changed, or removed) replaces in place; anything else (member, page,
       post…) falls through and pushes as usual. */
    if (location.hash.replace(sortStrip, '$1') === want.replace(sortStrip, '$1')) {
      history.replaceState(null, '', want)
      return
    }
    /* on the media route: stepping (next/prev) edits the same history
       entry; closing POPS the entry the app pushed on open (Back returns
       to exactly where you were — one press, nothing left behind), and a
       directly-loaded media URL (paste/refresh, nothing behind it to pop)
       is rewritten into its screen address. Elsewhere a consumed focus
       segment cleans up in place. Blog post URLs also end in digits —
       those push normally (each screen is its own history entry, like the
       app) */
    if (/^#\/media\//.test(location.hash)) {
      if (!lightbox.open && mediaWasPushed) {
        mediaWasPushed = false
        history.back() // pop the open-push; popstate → parseHash restores the screen
        return
      }
      history.replaceState(null, '', want)
      return
    }
    if (!lightbox.open && !location.hash.startsWith('#/blog/') && /\/\d+$/.test(location.hash))
      history.replaceState(null, '', want)
    else {
      history.pushState(null, '', want)
      if (/^#\/media\//.test(want)) mediaWasPushed = true // opening the viewer — remember so close can pop
    }
  })

  function blogHash() {
    /* directory URLs carry the site explicitly (like #/talk/<site> on the
       Talk tab) so a Sakurazaka blogs link can be shared; member/post URLs
       imply the site.  Member list URLs ALWAYS carry /p/<n> — clicking a
       member lands on /p/1, and any page is linkable. Bare #/blog/<key>
       still parses (page 1) so older links keep working; post IDs are bare
       numbers and outrank the page suffix. The directory also carries the
       sort when it isn't the default (e.g. #/blog/<site>/latest) so feed
       views are shareable and survive a reload, and the feed's page beyond
       the first as /p/<n> — page 1 stays bare, like the member list. */
    if (!ui.blogMember) {
      const sort = ui.blogSort === 'gen-asc' ? '' : `/${ui.blogSort}`
      const page = ui.blogFeedPage > 1 ? `/p/${ui.blogFeedPage}` : ''
      return `#/blog/${encodeURIComponent(ui.site)}${sort}${page}`
    }
    const m = encodeURIComponent(ui.blogMember)
    if (ui.blogPost != null) return `#/blog/${m}/${ui.blogPost}`
    return `#/blog/${m}/p/${ui.blogPage}`
  }
</script>

<div
  class="phone {ui.site === 'sakurazaka46'
    ? 'sakura-line'
    : ui.site === 'hinatazaka46'
    ? 'hinata-line'
    : 'nogizaka-line'}"
>
  {#if ui.view === 'home'}
    <Home {archive} {members} {siteKeys} />
  {:else if ui.view === 'search'}
    <SearchScreen {archive} />
  {:else if ui.view === 'thread' && current}
    {#key current.slug}
      <Thread {archive} member={current} />
    {/key}
  {:else if ui.view === 'gallery' && current}
    {#key current.slug}
      <Gallery member={current} />
    {/key}
  {:else if ui.view === 'blog'}
    <Blog {archive} />
  {:else}
    <div class="screen">
      <div class="col">
        <div class="muted-note">メンバーが見つかりません / member not found</div>
      </div>
    </div>
  {/if}

  <TabBar {archive} />
</div>

{#if lightbox.open}
  <Lightbox />
{/if}
{#if info.open}
  <!-- the sheet mirrors the side it was opened from: blog views get the
     blog-archive stats, every talk view the message one -->
  <InfoSheet {archive} blog={!talkView} talkView onclose={() => (info.open = false)} />
{/if}
{#if auth.open || (auth.checked && auth.required && !auth.authed && talkView)}
  <!-- login gate: the Blog tab stays public; any talk view asks for the
       password (a 401 from a gated fetch opens it explicitly too) -->
  <Login />
{/if}
