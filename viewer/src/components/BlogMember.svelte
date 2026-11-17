<script lang="ts">
  /* one member's blog post list — thumbnail cards like the app: square thumb
     left, pink title, two-line lead, stamp bottom-right. Paginated: 25 posts
     per page, first/prev/numbered/next/last pager at the bottom (server
     slices via ?limit/?offset). The numbered window is 7 pages, dropping to
     5 when the column sits at its 430px floor — 7 needs ~444px of row, the
     floor only leaves ~402px after padding. */
  import type { Archive, BlogEntry } from '../lib/types'
  import { back, openBlog, ui } from '../lib/store.svelte'
  import { fmtBlogStamp } from '../lib/format'

  let { archive }: { archive: Archive } = $props()

  const PER_PAGE = 25

  const key = $derived(ui.blogMember!)
  const info = $derived(archive.blogs?.members.find((b) => b.key === key) ?? null)

  let entries = $state<BlogEntry[] | null>(null)
  let total = $state(0)
  let error = $state('')
  let page = $state(1) // 1-based
  let colW = $state(0) // .col width — picks the numbered-window size

  const pages = $derived(Math.max(1, Math.ceil(total / PER_PAGE)))
  const win = $derived(colW > 0 && colW < 480 ? 5 : 7)

  /* the clickable page numbers: win numbers centered on the current page,
     '…' where the window is detached from an end (edges are the ⏮/⏭ job) */
  const nums = $derived.by<(number | '…')[]>(() => {
    if (pages <= win) return Array.from({ length: pages }, (_, i) => i + 1)
    const half = (win - 1) / 2
    let lo = Math.max(1, page - half)
    const hi = Math.min(pages, lo + win - 1)
    lo = Math.max(1, hi - win + 1) // pin the window to the last page
    const out: (number | '…')[] = []
    if (lo > 1) out.push('…')
    for (let n = lo; n <= hi; n++) out.push(n)
    if (hi < pages) out.push('…')
    return out
  })

  /* refetch on member change AND page change; a member switch resets to page 1
     (return after bumping `page` so the effect re-runs with clean state) */
  let lastKey = ''
  let screen = $state<HTMLElement | null>(null)
  $effect(() => {
    const k = key
    const pg = page
    screen?.scrollTo(0, 0) // a page change lands at the top, like a fresh tap
    if (k !== lastKey) {
      lastKey = k
      if (pg !== 1) {
        page = 1
        return
      }
    }
    entries = null
    error = ''
    fetch(`/api/blog/${encodeURIComponent(k)}?limit=${PER_PAGE}&offset=${(pg - 1) * PER_PAGE}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { entries: BlogEntry[]; total: number }) => {
        if (k !== ui.blogMember) return // raced: member switched mid-flight
        entries = d.entries
        total = d.total
        if (pg > Math.max(1, Math.ceil(d.total / PER_PAGE))) page = 1 // member shrank under us
      })
      .catch((e) => {
        if (k === ui.blogMember) error = String(e)
      })
  })

  const open = (id: number) => openBlog(key, id)
</script>

<header class="head">
  <button class="ic back" aria-label="back" onclick={() => back(null)}>
    <i class="fa-solid fa-chevron-left"></i>
  </button>
  <h1>{info?.name ?? key.replace(/_/g, ' ')}</h1>
  <span class="sp"></span>
</header>

<div class="screen" bind:this={screen}>
  <div class="col blog-member" bind:clientWidth={colW}>
  {#if error}
    <div class="muted-note">読み込み失敗 / {error}</div>
  {:else if !entries}
    <div class="muted-note">読み込み中…</div>
  {:else}
    {#each entries as e (e.id)}
      <button class="blog-post-row" onclick={() => open(e.id)}>
        {#if e.thumbnail}
          <img
            src={info?.site
              ? `/media/${info.site}/blogs/${encodeURIComponent(key)}/blog/${e.thumbnail}`
              : `/media/blogs/${encodeURIComponent(key)}/blog/${e.thumbnail}`}
            loading="lazy"
            alt=""
          />
        {:else}
          <div class="ph"></div>
        {/if}
        <span class="tx">
          <span class="ttl">{e.title || '(無題)'}</span>
          <span class="lead">{e.lead ?? ''}</span>
          <span class="dt">{fmtBlogStamp(e.at)}</span>
        </span>
      </button>
    {/each}
    {#if pages > 1}
      <nav class="blog-pager" aria-label="pagination">
        <button class="pg-btn" disabled={page <= 1} onclick={() => (page = 1)} aria-label="first page">
          <i class="fa-solid fa-angles-left"></i>
        </button>
        <button class="pg-btn" disabled={page <= 1} onclick={() => page--} aria-label="previous page">
          <i class="fa-solid fa-chevron-left"></i>
        </button>
        {#each nums as n (n)}
          {#if n === '…'}
            <span class="pg-dots">…</span>
          {:else}
            <button
              class="pg-num"
              class:cur={n === page}
              aria-current={n === page ? 'page' : undefined}
              onclick={() => {
                if (n !== page) page = n
              }}
            >
              {n}
            </button>
          {/if}
        {/each}
        <button class="pg-btn" disabled={page >= pages} onclick={() => page++} aria-label="next page">
          <i class="fa-solid fa-chevron-right"></i>
        </button>
        <button class="pg-btn" disabled={page >= pages} onclick={() => (page = pages)} aria-label="last page">
          <i class="fa-solid fa-angles-right"></i>
        </button>
      </nav>
    {/if}
  {/if}
  </div>
</div>
