<script lang="ts">
  /* one member's blog post list — thumbnail cards like the app: square thumb
     left, pink title, two-line lead, stamp bottom-right */
  import type { Archive, BlogEntry } from '../lib/types'
  import { back, openBlog, ui } from '../lib/store.svelte'
  import { fmtBlogStamp } from '../lib/format'

  let { archive }: { archive: Archive } = $props()

  const key = $derived(ui.blogMember!)
  const info = $derived(archive.blogs?.members.find((b) => b.key === key) ?? null)

  let entries = $state<BlogEntry[] | null>(null)
  let error = $state('')

  $effect(() => {
    const k = key
    entries = null
    error = ''
    fetch(`/api/blog/${encodeURIComponent(k)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { entries: BlogEntry[] }) => (entries = d.entries))
      .catch((e) => (error = String(e)))
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

<div class="screen blog-member">
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
  {/if}
</div>
