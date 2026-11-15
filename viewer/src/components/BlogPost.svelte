<script lang="ts">
  /* one blog post — the app's article view: pink title, gray stamp, then the
     post HTML with locally archived images. Tapping an image opens a simple
     in-post overlay (self-contained; the global lightbox is message-bound). */
  import type { Archive, BlogEntry } from '../lib/types'
  import { back, ui } from '../lib/store.svelte'
  import { fmtFull } from '../lib/format'

  let { archive }: { archive: Archive } = $props()

  const key = $derived(ui.blogMember!)
  const postId = $derived(ui.blogPost!)

  let entry = $state<BlogEntry | null>(null)
  let error = $state('')
  let body = $state<HTMLElement | null>(null)

  /* in-post image overlay: tap any image -> fullscreen, swipe/stepped by the
     same key handler shape the gallery uses */
  let overlay = $state<{ srcs: string[]; i: number } | null>(null)

  $effect(() => {
    entry = null
    error = ''
    fetch(`/api/blog/${encodeURIComponent(key)}/${postId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { entry: BlogEntry }) => (entry = d.entry))
      .catch((e) => (error = String(e)))
  })

  /* wire up image taps once the HTML lands */
  $effect(() => {
    if (!entry || !body) return
    const imgs = [...body.querySelectorAll('img')]
      .map((el) => (el as HTMLImageElement).getAttribute('src'))
      .filter((s): s is string => !!s)
    if (!imgs.length) return
    const handlers = imgs.map((src, i) => {
      const el = [...body!.querySelectorAll('img')].find((x) => x.getAttribute('src') === src)
      const fn = () => (overlay = { srcs: imgs, i })
      el?.addEventListener('click', fn)
      return { el, fn }
    })
    return () => handlers.forEach(({ el, fn }) => el?.removeEventListener('click', fn))
  })

  const stepOverlay = (d: number) => {
    if (!overlay) return
    const i = overlay.i + d
    if (i < 0 || i >= overlay.srcs.length) return
    overlay = { ...overlay, i }
  }

  function onKey(e: KeyboardEvent) {
    if (!overlay) return
    if (e.key === 'ArrowRight') stepOverlay(1)
    else if (e.key === 'ArrowLeft') stepOverlay(-1)
    else if (e.key === 'Escape') overlay = null
  }
</script>

<svelte:window onkeydown={onKey} />

<header class="head">
  <button class="ic back" aria-label="back" onclick={() => back(null)}>
    <i class="fa-solid fa-chevron-left"></i>
  </button>
  <h1>{entry?.creator ?? ''}</h1>
  <span class="sp"></span>
</header>

<div class="screen blog-post">
  {#if error}
    <div class="muted-note">読み込み失敗 / {error}</div>
  {:else if !entry}
    <div class="muted-note">読み込み中…</div>
  {:else}
    <h2 class="bp-title">{entry.title || '(無題)'}</h2>
    <div class="bp-date">{fmtFull(entry.at)}</div>
    <div bind:this={body}>{@html entry.content}</div>
    <div class="bp-end">— end —</div>
  {/if}
</div>

{#if overlay}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_no_interactive_element_to_noninteractive_role -->
  <div class="bp-overlay" onclick={() => (overlay = null)}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <img src={overlay.srcs[overlay.i]} alt="" onclick={(e) => e.stopPropagation()} />
    {#if overlay.srcs.length > 1}
      <button class="bp-nav prev" aria-label="previous" onclick={(e) => { e.stopPropagation(); stepOverlay(-1) }}>‹</button>
      <button class="bp-nav next" aria-label="next" onclick={(e) => { e.stopPropagation(); stepOverlay(1) }}>›</button>
      <span class="bp-count">{overlay.i + 1} / {overlay.srcs.length}</span>
    {/if}
    <button class="bp-close" aria-label="close" onclick={() => (overlay = null)}>✕</button>
  </div>
{/if}
