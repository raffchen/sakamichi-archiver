<script lang="ts">
  /* shared blog pager — ⏮ ‹ numbered window › ⏭, used by both the member
     post list and the cross-member feed. `page` is bindable: the parent owns
     the state (ui.blogPage / ui.blogFeedPage) so URL rewrites and Back/
     Forward restore it, exactly as before the extraction. The numbered
     window tracks the column the way the card grids pick their column
     count: 3 numbers at the 430px floor, 5 up to tablet-wide, 7 beyond —
     all three steps are odd so (win - 1) / 2 keeps the window centered;
     below ~560px the row also compacts (.blog-pager.compact in app.css). */
  let {
    page = $bindable(),
    pages,
    colW,
    label = 'pagination',
  }: {
    page: number
    pages: number
    colW: number
    label?: string
  } = $props()

  const win = $derived(colW < 460 ? 3 : colW < 660 ? 5 : 7)
  const compact = $derived(colW > 0 && colW < 560)
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
</script>

{#if pages > 1}
  <nav class="blog-pager" class:compact aria-label={label}>
    <button class="pg-btn" disabled={page <= 1} onclick={() => (page = 1)} aria-label="first page">
      <i class="fa-solid fa-angles-left"></i>
    </button>
    <button class="pg-btn" disabled={page <= 1} onclick={() => page--} aria-label="previous page">
      <i class="fa-solid fa-chevron-left"></i>
    </button>
    <!-- index-keyed: nums can hold TWO '…' markers (window strictly
         interior), and duplicate string keys break the keyed diff —
         with 9 pages, page 5 was the only page that hit it -->
    {#each nums as n, i (i)}
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
