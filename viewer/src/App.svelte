<script lang="ts">
  import { onMount } from 'svelte'
  import type { Archive, Member } from './lib/types'
  import { closeLightbox, info, lightbox, showLightbox, ui, type View } from './lib/store.svelte'
  import Gallery from './components/Gallery.svelte'
  import Blog from './components/Blog.svelte'
  import Home from './components/Home.svelte'
  import InfoSheet from './components/InfoSheet.svelte'
  import Lightbox from './components/Lightbox.svelte'
  import SearchScreen from './components/SearchScreen.svelte'
  import TabBar from './components/TabBar.svelte'
  import Thread from './components/Thread.svelte'
  import { disp } from './lib/display'

  let { archive }: { archive: Archive } = $props()

  const siteKeys = $derived(Object.keys(archive.sites))
  const members = $derived(archive.members.filter((m) => (m.site ?? 'nogizaka46') === ui.site))
  const current = $derived(archive.members.find((m) => m.slug === ui.slug) ?? null)

  let routed = $state(false)

  /* the active site drives the whole theme (purple / pale pink) */
  $effect(() => {
    document.documentElement.dataset.site = ui.site
    const s = archive.sites[ui.site]
    const who = current ? disp(current) : (s?.roman ?? s?.name ?? ui.site)
    document.title = `${who} — 坂道 Message アーカイブ`
  })

  /* hash <-> state: Back, reload and deep links all work. The URL names the
     topmost screen: an open lightbox is its own #/media/<slug>/<id> route
     whether it was opened from a thread or the gallery; without it the
     thread/gallery addresses carry the scroll focus */
  function hashFor(v: View, slug: string | null, focus: number | null) {
    if (lightbox.open) {
      const cur = lightbox.items[lightbox.i]
      if (cur) return `#/media/${encodeURIComponent(lightbox.memberSlug ?? '')}/${cur.id}`
    }
    if (v === 'home') return ui.site === siteKeys[0] ? '#/' : `#/site/${encodeURIComponent(ui.site)}`
    const s = slug ? encodeURIComponent(slug) : ''
    return `#/${v}${s ? '/' + s : ''}${focus ? '/' + focus : ''}`
  }

  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/')
    const route = (parts[0] || 'home') as View | 'site' | 'media' | 'blog-search'
    const slug = parts[1] ? decodeURIComponent(parts[1]) : null
    const focus = parts[2] ? Number(parts[2]) : null
    const hit = slug ? archive.members.find((m) => m.slug === slug) : null
    if (hit?.site) ui.site = hit.site
    /* Back/Forward or an edited URL: leaving the media route closes the
       lightbox — its state is part of the address, not independent of it */
    if (lightbox.open && route !== 'media') closeLightbox()
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
    } else if (route === 'site' && archive.sites[slug ?? '']) {
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
      /* #/blog/<site> names a site directory (site keys are ASCII, member
         keys are 日本語 — they can't collide); a member segment implies the
         site by itself */
      if (slug && archive.sites[slug]) {
        ui.site = slug
        ui.blogMember = null
        ui.blogPost = null
      } else {
        ui.blogMember = slug
        ui.blogPost = parts[2] ? Number(parts[2]) : null
        /* a deep link names the member — adopt their site so the theme matches */
        if (slug) {
          const bm = archive.blogs?.members.find((b) => b.key === slug)
          if (bm?.site) ui.site = bm.site
        }
      }
    } else if (route === 'search' || route === 'blog-search') {
      ui.view = 'search'
      /* #/blog-search — the Blog tab's scoped search (back returns to Blogs) */
      ui.searchScope = window.location.hash.startsWith('#/blog-search') ? 'blog' : 'message'
      ui.slug = null
      ui.focusId = null
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
    routed = true
    // popstate = browser Back/Forward; hashchange = an edited/pasted #url
    window.addEventListener('popstate', parseHash)
    window.addEventListener('hashchange', parseHash)
    return () => {
      window.removeEventListener('popstate', parseHash)
      window.removeEventListener('hashchange', parseHash)
    }
  })

  $effect(() => {
    if (!routed) return
    const want =
      ui.view === 'blog'
        ? blogHash()
        : hashFor(ui.view === 'search' && ui.searchScope === 'blog' ? 'blog-search' : ui.view, ui.slug, ui.focusId)
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
    /* directory URLs carry the site (like #/site/<site> on Talk) so a
       Sakurazaka blogs link can be shared; member/post URLs imply the site */
    if (!ui.blogMember)
      return ui.site === siteKeys[0] ? '#/blog' : `#/blog/${encodeURIComponent(ui.site)}`
    const m = encodeURIComponent(ui.blogMember)
    return `#/blog/${m}${ui.blogPost != null ? '/' + ui.blogPost : ''}`
  }
</script>

<div class="phone {ui.site === 'sakurazaka46' ? 'sakura-line' : 'nogizaka-line'}">
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
      <div class="muted-note">メンバーが見つかりません / member not found</div>
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
