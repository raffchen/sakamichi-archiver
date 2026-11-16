<script lang="ts">
  /* one blog post — the app's article view: pink title, gray stamp, then the
     post HTML with locally archived images. Tapping an image opens the shared
     global lightbox (same viewer as message media). */
  import type { Archive, BlogEntry } from '../lib/types'
  import { back, showBlogLightbox, ui } from '../lib/store.svelte'
  import { fmtFull } from '../lib/format'
  import { normalizeBlogContent } from '../lib/blog-html'

  let { archive }: { archive: Archive } = $props()

  const key = $derived(ui.blogMember!)
  const postId = $derived(ui.blogPost!)

  let entry = $state<BlogEntry | null>(null)
  let error = $state('')
  let body = $state<HTMLElement | null>(null)

  $effect(() => {
    entry = null
    error = ''
    fetch(`/api/blog/${encodeURIComponent(key)}/${postId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { entry: BlogEntry }) => (entry = d.entry))
      .catch((e) => (error = String(e)))
  })

  /* wire up image taps once the HTML lands — the shared lightbox shows the
     post's images as one swipeable set, captioned by the post title */
  $effect(() => {
    if (!entry || !body) return
    const imgs = [...body.querySelectorAll('img')]
      .map((el) => (el as HTMLImageElement).getAttribute('src'))
      .filter((s): s is string => !!s)
    if (!imgs.length) return
    const handlers = imgs.map((src, i) => {
      const el = [...body!.querySelectorAll('img')].find((x) => x.getAttribute('src') === src)
      const fn = () => showBlogLightbox(imgs, i, entry!.at, entry!.title || null)
      el?.addEventListener('click', fn)
      return { el, fn }
    })
    return () => handlers.forEach(({ el, fn }) => el?.removeEventListener('click', fn))
  })
</script>

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
    <div bind:this={body}>{@html normalizeBlogContent(entry.content ?? '')}</div>
    <div class="bp-end">— end —</div>
  {/if}
</div>
