<script lang="ts">
  import { onMount } from 'svelte'
  import type { Archive, Member } from './lib/types'
  import { info, lightbox, ui, type View } from './lib/store.svelte'
  import Gallery from './components/Gallery.svelte'
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

  /* hash <-> state: Back, reload and deep links all work */
  function hashFor(v: View, slug: string | null, focus: number | null) {
    if (v === 'home') return ui.site === siteKeys[0] ? '#/' : `#/site/${encodeURIComponent(ui.site)}`
    const s = slug ? encodeURIComponent(slug) : ''
    return `#/${v}${s ? '/' + s : ''}${focus ? '/' + focus : ''}`
  }

  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/')
    const route = (parts[0] || 'home') as View | 'site'
    const slug = parts[1] ? decodeURIComponent(parts[1]) : null
    const focus = parts[2] ? Number(parts[2]) : null
    const hit = slug ? archive.members.find((m) => m.slug === slug) : null
    if (hit?.site) ui.site = hit.site
    if (route === 'thread' && hit) {
      ui.view = 'thread'
      ui.slug = slug
      ui.focusId = focus
    } else if (route === 'site' && archive.sites[slug ?? '']) {
      ui.site = slug!
      ui.view = 'home'
      ui.slug = null
      ui.focusId = null
    } else if (route === 'gallery' && hit) {
      ui.view = 'gallery'
      ui.slug = slug
      ui.focusId = null
    } else if (route === 'search') {
      ui.view = 'search'
      ui.slug = null
      ui.focusId = null
    } else {
      ui.view = 'home'
      ui.slug = null
      ui.focusId = null
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
    const want = hashFor(ui.view, ui.slug, ui.focusId)
    if (location.hash !== want) history.pushState(null, '', want)
  })
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
