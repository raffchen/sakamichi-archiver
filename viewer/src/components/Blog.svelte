<script lang="ts">
  /* Blog tab — directory -> member post list -> post detail (app parity).
     The directory shows EVERY member the app knows, grouped by generation;
     members whose backfill hasn't landed yet are greyed. The ⇅ menu switches
     the directory sort: generation (either direction), flat by name, or the
     official "newest posts" cross-member feed. */
  import type { Archive, BlogMemberInfo } from '../lib/types'
  import { openBlog, setHideGraduated, ui, type BlogSort } from '../lib/store.svelte'
  import { fmtBlogStamp } from '../lib/format'
  import { icon } from '../lib/icons'
  import BlogMember from './BlogMember.svelte'
  import BlogPost from './BlogPost.svelte'

  let { archive }: { archive: Archive } = $props()

  const siteKeys = $derived(Object.keys(archive.sites))
  const siteMembers = $derived(
    (archive.blogs?.members ?? [])
      .filter((b) => b.site === ui.site)
      .filter((b) => !(ui.blogHideGraduated && b.graduated)),
  )
  /* every member key that's graduated — the newest-posts feed has no flag of
     its own, only the directory key, so it filters against this set */
  const graduatedKeys = $derived(
    new Set((archive.blogs?.members ?? []).filter((b) => b.graduated).map((b) => b.key)),
  )

  type SortId = BlogSort
  const sortOptions: { id: SortId; label: string }[] = [
    { id: 'gen-asc', label: 'Generation (old → new)' },
    { id: 'gen-desc', label: 'Generation (new → old)' },
    { id: 'name-asc', label: 'Name (A → Z)' },
    { id: 'name-desc', label: 'Name (Z → A)' },
    { id: 'latest', label: 'Newest first' },
    { id: 'oldest', label: 'Oldest first' },
  ]

  type Section = { label: string; members: BlogMemberInfo[] }
  const sections = $derived.by(() => {
    const byNum = new Map<number, BlogMemberInfo[]>()
    const other: BlogMemberInfo[] = []
    for (const b of siteMembers) {
      if (b.gen_num == null) {
        other.push(b)
        continue
      }
      const arr = byNum.get(b.gen_num) ?? []
      arr.push(b)
      byNum.set(b.gen_num, arr)
    }
    const out: Section[] = [...byNum.entries()]
      .sort((a, b) => (ui.blogSort === 'gen-desc' ? b[0] - a[0] : a[0] - b[0]))
      .map(([n, members]) => ({ label: `${n}期生`, members }))
    if (other.length) out.push({ label: 'その他', members: other })
    return out
  })

  /* Name (A→Z / Z→A): one flat grid, no generation grouping. Sorts by the
     kana reading — kanji strings give Intl.Collator('ja') fits */
  const ja = new Intl.Collator('ja')
  const byName = $derived(
    [...siteMembers].sort(
      (a, b) => ja.compare(a.kana ?? a.name, b.kana ?? b.name) * (ui.blogSort === 'name-desc' ? -1 : 1),
    ),
  )

  /* 新着順: the official "everyone's posts, newest first" feed */
  type LatestPost = {
    key: string
    member: string
    id: string
    title: string | null
    at: string
    thumbnail: string | null
    lead: string | null
  }
  let latest = $state<LatestPost[] | null>(null)
  let latestErr = $state('')

  $effect(() => {
    if (!ui.blogMember && (ui.blogSort === 'latest' || ui.blogSort === 'oldest')) {
      const site = ui.site
      latest = null
      latestErr = ''
      fetch(
        `/api/blog?site=${encodeURIComponent(site)}&limit=60` +
          (ui.blogSort === 'oldest' ? '&order=asc' : ''),
      )
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: { posts: LatestPost[] }) => {
          if (site === ui.site && !ui.blogMember) latest = d.posts
        })
        .catch((e) => (latestErr = String(e)))
    }
  })

  /* the feed is filtered reactively (not at fetch time) so toggling the
     setting doesn't refetch — it just reshapes what's already here */
  const latestShown = $derived(
    latest && ui.blogHideGraduated && graduatedKeys.size
      ? latest.filter((p) => !graduatedKeys.has(p.key))
      : latest,
  )

  let menuOpen = $state(false)
  let settingsOpen = $state(false)
  function pickSort(id: SortId) {
    ui.blogSort = id
    menuOpen = false
  }
  function toggleGrad() {
    setHideGraduated(!ui.blogHideGraduated)
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && ((menuOpen = false), (settingsOpen = false))} />

{#if ui.blogPost != null && ui.blogMember}
  <BlogPost {archive} />
{:else if ui.blogMember}
  <BlogMember {archive} />
{:else}
  <header class="head">
    <span class="title-left blog-title">Blogs</span>
    <button class="ic" aria-label="sort" onclick={() => ((menuOpen = !menuOpen), (settingsOpen = false))}>
      {@html icon('sort')}
    </button>
    <button
      class="ic"
      aria-label="settings"
      onclick={() => ((settingsOpen = !settingsOpen), (menuOpen = false))}
    >
      {@html icon('gear')}
    </button>
    {#if menuOpen}
      <button class="menu-backdrop" aria-label="close menu" onclick={() => (menuOpen = false)}></button>
      <div class="blog-sort-menu" role="menu">
        {#each sortOptions as o (o.id)}
          <button role="menuitem" class:on={ui.blogSort === o.id} onclick={() => pickSort(o.id)}>
            <span>{o.label}</span>
            {#if ui.blogSort === o.id}{@html icon('check')}{/if}
          </button>
        {/each}
      </div>
    {/if}
    {#if settingsOpen}
      <button
        class="menu-backdrop"
        aria-label="close settings"
        onclick={() => (settingsOpen = false)}
      ></button>
      <div class="blog-sort-menu" role="menu">
        <button
          class="setting-row"
          role="menuitemcheckbox"
          aria-checked={ui.blogHideGraduated}
          class:on={ui.blogHideGraduated}
          class:off={!ui.blogHideGraduated}
          onclick={toggleGrad}
        >
          <span>Hide graduated members</span>
          {@html icon('check')}
        </button>
      </div>
    {/if}
  </header>

  <div class="sites">
    {#each siteKeys as k (k)}
      <button class:on={k === ui.site} onclick={() => (ui.site = k)}>
        {archive.sites[k]?.name ?? k}
      </button>
    {/each}
  </div>

  <div class="searchbar">
    <input
      type="search"
      placeholder="Search blog posts"
      aria-label="search blog posts"
      value={ui.query}
      onfocus={() => {
        ui.searchScope = 'blog'
        ui.view = 'search'
      }}
      onkeydown={(e) => e.key === 'Enter' && ((ui.searchScope = 'blog'), (ui.view = 'search'))}
      oninput={(e) => (ui.query = e.currentTarget.value)}
    />
  </div>

  <div class="screen">
    <div class="col blog-directory">
    {#snippet card(b: BlogMemberInfo)}
      <button
        class="blog-card"
        class:empty={!b.count}
        class:grad={b.graduated}
        disabled={!b.count}
        title={b.count ? '' : 'not archived yet'}
        onclick={() => openBlog(b.key)}
      >
        {#if b.thumb}
          <img src={b.thumb} loading="lazy" alt={b.name} />
        {:else}
          <div class="ph"></div>
        {/if}
        <span class="nm">{b.name}{b.graduated ? ' (卒)' : ''}</span>
        {#if b.roman}<span class="sub">{b.roman}</span>{/if}
        <span class="dt">{b.count ? fmtBlogStamp(b.last!) : '—'}</span>
      </button>
    {/snippet}

    {#if ui.blogSort === 'latest' || ui.blogSort === 'oldest'}
      {#if latestErr}
        <div class="muted-note">読み込み失敗 / {latestErr}</div>
      {:else if !latestShown}
        <div class="muted-note">読み込み中…</div>
      {:else}
        <div class="blog-latest">
          {#each latestShown as p (p.key + '/' + p.id)}
            <button class="blog-post-row" onclick={() => openBlog(p.key, Number(p.id))}>
              {#if p.thumbnail}
                <img src={p.thumbnail} loading="lazy" alt="" />
              {:else}
                <div class="ph"></div>
              {/if}
              <span class="tx">
                <span class="ttl">{p.title || '(無題)'}</span>
                <span class="lead">{p.lead ?? ''}</span>
                <span class="by">
                  <span class="nm">{p.member}</span>
                  <span class="dt">{fmtBlogStamp(p.at)}</span>
                </span>
              </span>
            </button>
          {/each}
        </div>
      {/if}
    {:else if ui.blogSort === 'name-asc' || ui.blogSort === 'name-desc'}
      <div class="blog-grid name-grid">
        {#each byName as b (b.uuid)}
          {@render card(b)}
        {/each}
      </div>
    {:else}
      {#each sections as sec (sec.label)}
        <h2 class="blog-gen">{sec.label}</h2>
        <div class="blog-grid">
          {#each sec.members as b (b.uuid)}
            {@render card(b)}
          {/each}
        </div>
      {/each}
    {/if}
    </div>
  </div>
{/if}
