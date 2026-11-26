<script lang="ts">
  /* one member's blog post list — thumbnail cards like the app: square thumb
     left, pink title, two-line lead, stamp bottom-right. Paginated: 25 posts
     per page, first/prev/numbered/next/last pager at the bottom (server
     slices via ?limit/?offset). The numbered window adapts to the column
     the way the card grids pick their column count: 3 numbers at the
     430px floor, 5 up to tablet-wide, 7 beyond — and below ~560px the row
     also compacts (smaller circles, tighter gaps) so it fits without
     spilling under the scrollbar's grab band. The page is baked into the
     URL as #/blog/<key>/p/<n> so links to a specific page are shareable. */
  import type { Archive, BlogEntry } from '../lib/types'
  import { BLOG_PER_PAGE, back, toggleTheme, ui } from '../lib/store.svelte'
  import Scrollbar from './Scrollbar.svelte'
  import BlogPager from './BlogPager.svelte'
  import { fmtBlogStamp } from '../lib/format'
  import { icon } from '../lib/icons'

  let { archive }: { archive: Archive } = $props()

  const PER_PAGE = BLOG_PER_PAGE // shared so back-from-post computes the same page size

  const key = $derived(ui.blogMember!)
  const info = $derived(archive.blogs?.members.find((b) => b.key === key) ?? null)
  const memberName = $derived(info?.name ?? key.replace(/_/g, ' '))

  let entries = $state<BlogEntry[] | null>(null)
  let total = $state(0)
  let error = $state('')
  let colW = $state(0) // .col width — picks the numbered-window size

  const pages = $derived(Math.max(1, Math.ceil(total / PER_PAGE)))
  /* "Showing 1-25 of N blogs" strip under the search bar */
  const countStart = $derived((ui.blogPage - 1) * PER_PAGE + 1)
  const countEnd = $derived(Math.min(ui.blogPage * PER_PAGE, total))

  let screen = $state<HTMLElement | null>(null)
  $effect(() => {
    const k = key
    const pg = ui.blogPage
    screen?.scrollTo(0, 0) // a page change lands at the top, like a fresh tap
    entries = null
    error = ''
    fetch(`/api/blog/${encodeURIComponent(k)}?limit=${PER_PAGE}&offset=${(pg - 1) * PER_PAGE}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { entries: BlogEntry[]; total: number }) => {
        if (k !== ui.blogMember) return // raced: member switched mid-flight
        entries = d.entries
        total = d.total
      })
      .catch((e) => {
        if (k === ui.blogMember) error = String(e)
      })
  })

  /* post rows are real <a href> anchors — middle-/ctrl-click opens the post
     in a new tab; a plain click is just the hash navigation */
</script>

<header class="head">
  <button class="ic back" aria-label="back" onclick={() => back(null)}>
    <i class="fa-solid fa-chevron-left"></i>
  </button>
  <h1>{memberName}</h1>
  <!-- dark-mode toggle in the trailing slot — keeps the title centered, and
       the theme is reachable on every blog screen -->
  <button
    class="ic"
    aria-label={ui.theme === 'dark' ? 'ライトモード / light mode' : 'ダークモード / dark mode'}
    onclick={toggleTheme}
  >
    {@html icon(ui.theme === 'dark' ? 'sun' : 'moon')}
  </button>
</header>

<div class="searchbar">
  <input
    type="search"
    placeholder={`Search ${memberName}'s blog posts`}
    aria-label={`Search ${memberName}'s blog posts`}
    value={ui.query}
    onfocus={() => {
      ui.blogMember = key
      ui.searchScope = 'blog-member'
      ui.view = 'search'
    }}
    onkeydown={(e) =>
      e.key === 'Enter' && ((ui.blogMember = key), (ui.searchScope = 'blog-member'), (ui.view = 'search'))}
    oninput={(e) => (ui.query = e.currentTarget.value)}
  />
</div>

{#if entries && total > 0}
  <div class="blog-count">
    Showing {countStart}-{countEnd} of {total} blogs
  </div>
{/if}

<div class="screen" bind:this={screen}>
  <div class="col blog-member" bind:clientWidth={colW}>
    <Scrollbar />
  {#if error}
    <div class="muted-note">読み込み失敗 / {error}</div>
  {:else if !entries}
    <div class="muted-note">読み込み中…</div>
  {:else}
    {#each entries as e (e.id)}
      <a class="blog-post-row" href={`#/blog/${encodeURIComponent(key)}/${e.id}`}>
        {#if e.thumbnail}
          <!-- thumb = server-generated square crop; the full file is the
               fallback (e.g. --no-thumbs builds) and stays the lightbox src -->
          <img
            src={e.thumb ??
              (info?.site
                ? `/media/${info.site}/blogs/${encodeURIComponent(key)}/blog/${e.thumbnail}`
                : `/media/blogs/${encodeURIComponent(key)}/blog/${e.thumbnail}`)}
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
      </a>
    {/each}
    <BlogPager bind:page={ui.blogPage} {pages} {colW} />
  {/if}
  </div>
</div>