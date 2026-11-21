<script lang="ts">
  import { onMount } from 'svelte'
  import {
    closeLightbox,
    getArchive,
    getMember,
    info,
    lightbox,
    searchBarContext,
    showLightbox,
    ui,
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

  function parseHash() {
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
      } else {
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

  $effect(() => {
    if (!routed) return
    const want = ui.view === 'blog' ? blogHash() : ui.view === 'search' ? searchHash() : hashFor(ui.view, ui.slug, ui.focusId)
    if (location.hash === want) return
    /* on the media route, every change (next/prev, ✕/Back-close) edits the
       same history entry — Back exits the viewer in one step; opening the
       viewer from a thread/grid address is a new entry, so Back returns to
       exactly where you were; a consumed focus segment cleans up in place.
       Blog post URLs also end in digits — those push normally (each screen
       is its own history entry, like the app) */
    if (
      /^#\/media\//.test(location.hash) ||
      (!lightbox.open && !location.hash.startsWith('#/blog/') && /\/\d+$/.test(location.hash))
    )
      history.replaceState(null, '', want)
    else history.pushState(null, '', want)
  })

  function blogHash() {
    /* directory URLs carry the site explicitly (like #/talk/<site> on the
       Talk tab) so a Sakurazaka blogs link can be shared; member/post URLs
       imply the site.  Member list URLs ALWAYS carry /p/<n> — clicking a
       member lands on /p/1, and any page is linkable. Bare #/blog/<key>
       still parses (page 1) so older links keep working; post IDs are bare
       numbers and outrank the page suffix. */
    if (!ui.blogMember) return `#/blog/${encodeURIComponent(ui.site)}`
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
  <InfoSheet {archive} onclose={() => (info.open = false)} />
{/if}
{#if auth.open || (auth.checked && auth.required && !auth.authed && talkView)}
  <!-- login gate: the Blog tab stays public; any talk view asks for the
       password (a 401 from a gated fetch opens it explicitly too) -->
  <Login />
{/if}
