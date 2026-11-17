<script lang="ts">
  /* one blog post — the app's article view: pink title, gray stamp, then the
     post HTML with locally archived images. Tapping an image opens the shared
     global lightbox (same viewer as message media). */
  import type { Archive, BlogEntry } from '../lib/types'
  import { back, openBlog, showBlogLightbox, ui } from '../lib/store.svelte'
  import { fmtFull } from '../lib/format'
  import { normalizeBlogContent } from '../lib/blog-html'

  let { archive }: { archive: Archive } = $props()

  const key = $derived(ui.blogMember!)
  const postId = $derived(ui.blogPost!)

  let entry = $state<BlogEntry | null>(null)
  let error = $state('')
  let body = $state<HTMLElement | null>(null)
  let screen = $state<HTMLElement | null>(null)

  /* the post footer's prev/next come from the detail response itself —
     the member list is paginated (25/page), so a post view can't chain
     from it across page boundaries (ids are strings on the wire,
     ui.blogPost is a number — openBlog accepts both) */
  let nav = $state<{ prev: { id: string; title: string | null } | null; next: { id: string; title: string | null } | null } | null>(null)

  $effect(() => {
    entry = null
    nav = null
    error = ''
    screen?.scrollTo(0, 0) // a chained post opens at the top, like a fresh tap
    fetch(`/api/blog/${encodeURIComponent(key)}/${postId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { entry: BlogEntry; prev: { id: string; title: string | null } | null; next: { id: string; title: string | null } | null }) => {
        entry = d.entry
        nav = d
      })
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

<div class="screen" bind:this={screen}>
  <div class="col blog-post">
  {#if error}
    <div class="muted-note">読み込み失敗 / {error}</div>
  {:else if !entry}
    <div class="muted-note">読み込み中…</div>
  {:else}
    <h2 class="bp-title">{entry.title || '(無題)'}</h2>
    <div class="bp-date">{fmtFull(entry.at)}</div>
    <div bind:this={body}>{@html normalizeBlogContent(entry.content ?? '')}</div>
    <div class="bp-end">— end —</div>
    {#if nav && (nav.prev || nav.next)}
      <nav class="bp-nav" aria-label="post navigation">
        {#if nav.prev}
          <button class="bp-nav-btn" onclick={() => openBlog(key, Number(nav!.prev!.id))}>
            <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
            <span class="txt">
              <span class="lbl">前の投稿</span>
              <span class="ttl">{nav.prev.title || '(無題)'}</span>
            </span>
          </button>
        {:else}
          <span></span>
        {/if}
        {#if nav.next}
          <button class="bp-nav-btn right" onclick={() => openBlog(key, Number(nav!.next!.id))}>
            <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
            <span class="txt">
              <span class="lbl">次の投稿</span>
              <span class="ttl">{nav.next.title || '(無題)'}</span>
            </span>
          </button>
        {:else}
          <span></span>
        {/if}
      </nav>
    {/if}
  {/if}
  </div>
</div>
