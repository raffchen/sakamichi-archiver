<script lang="ts">
  /* Blog tab — directory -> member post list -> post detail (app parity).
     The directory shows EVERY member the app knows, grouped by generation;
     members whose backfill hasn't landed yet are greyed. The ⇅ menu switches
     the directory sort: generation (either direction), flat by name, or the
     official "newest posts" cross-member feed. */
  import type { Archive, BlogMemberInfo } from '../lib/types'
  import {
    BLOG_PER_PAGE,
    genSettingKey,
    gradHiddenFor,
    migrateHideGraduated,
    setGradHiddenFor,
    toggleGenHidden,
    toggleTheme,
    ui,
    type BlogSort,
  } from '../lib/store.svelte'
  import { fmtBlogStamp } from '../lib/format'
  import { icon } from '../lib/icons'
  import Scrollbar from './Scrollbar.svelte'
  import BlogMember from './BlogMember.svelte'
  import BlogPager from './BlogPager.svelte'
  import BlogPost from './BlogPost.svelte'

  let { archive }: { archive: Archive } = $props()

  /* one-time migration of the old all-sites "hide graduated" boolean into the
     per-site list (needs the archive's site keys, so it waits for them) */
  let migratedGrad = false
  $effect(() => {
    const sites = Object.keys(archive.sites)
    if (migratedGrad || !sites.length) return
    migratedGrad = true
    migrateHideGraduated(sites)
  })

  const siteKeys = $derived(Object.keys(archive.sites))
  /* generation visibility (the ⚙ menu): every gen starts shown; unchecking one
     removes its members from the directory (all sorts) and its posts from the
     newest-posts feed. genByKey maps a directory/feed key -> gen_num so the
     feed — which carries no gen of its own — can filter too. */
  const genHidden = $derived(new Set(ui.blogHiddenGens))
  const genByKey = $derived(
    new Map((archive.blogs?.members ?? []).map((b) => [b.key, b.gen_num])),
  )
  /* the gen rows for the current site's settings menu, oldest first, plus
     その他 when any member has no generation (ポカ). A row with nothing to
     show under the current settings (all its members graduated and the
     graduated filter is on) is disabled — there'd be an empty section. */
  const siteGenRows = $derived.by(() => {
    const hasVisible = new Map<number | null, boolean>()
    for (const b of archive.blogs?.members ?? []) {
      if (b.site !== ui.site) continue
      const gen = b.gen_num == null ? null : b.gen_num
      if (gradHiddenFor(ui.site) && b.graduated) continue
      hasVisible.set(gen, true)
    }
    const nums = new Set<number>()
    let other = false
    for (const b of archive.blogs?.members ?? [])
      if (b.site === ui.site) {
        if (b.gen_num == null) other = true
        else nums.add(b.gen_num)
      }
    const rows = [...nums]
      .sort((a, b) => a - b)
      .map((n) => ({ gen: n as number | null, label: `${n}期生`, enabled: hasVisible.has(n) }))
    if (other) rows.push({ gen: null, label: 'その他', enabled: hasVisible.has(null) })
    return rows
  })
  const siteMembers = $derived(
    (archive.blogs?.members ?? [])
      .filter((b) => b.site === ui.site)
      .filter((b) => !(gradHiddenFor(ui.site) && b.graduated))
      .filter((b) => !genHidden.has(genSettingKey(ui.site, b.gen_num))),
  )
  /* every member key that's graduated — the newest-posts feed has no flag of
     its own, only the directory key, so it filters against this set */
  const graduatedKeys = $derived(
    new Set((archive.blogs?.members ?? []).filter((b) => b.graduated).map((b) => b.key)),
  )
  /* member keys hidden for THIS site (graduated toggle + gen checkboxes),
     sent to /api/blog as ?exclude= — the feed is capped at 60 posts, and with
     oldest-first the 60 oldest all come from the oldest generations, so
     filtering only on the client would empty the list. Reading this derived
     set in the fetch effect also re-fetches when the settings change. */
  const hiddenFeedKeys = $derived.by(() => {
    const keys = new Set<string>()
    for (const b of archive.blogs?.members ?? []) {
      if (b.site !== ui.site || !b.key) continue
      if (
        (gradHiddenFor(ui.site) && b.graduated) ||
        genHidden.has(genSettingKey(ui.site, b.gen_num))
      )
        keys.add(b.key)
    }
    return keys
  })

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
    thumb: string | null // square /thumbs/blog crop — falls back to `thumbnail`
    lead: string | null
  }
  let latest = $state<LatestPost[] | null>(null)
  let latestErr = $state('')
  let latestTotal = $state(0) // visible posts across ALL pages (drives the pager)
  /* the directory column's width — picks the pager's numbered-window size,
     same clientWidth binding the member list uses */
  let colW = $state(0)
  let dirScreen = $state<HTMLElement | null>(null)

  /* "Showing x-y of N blogs", pager math shared with the member list */
  const feedPages = $derived(Math.max(1, Math.ceil(latestTotal / BLOG_PER_PAGE)))
  const feedStart = $derived((ui.blogFeedPage - 1) * BLOG_PER_PAGE + 1)
  const feedEnd = $derived(Math.min(ui.blogFeedPage * BLOG_PER_PAGE, latestTotal))

  $effect(() => {
    if (!ui.blogMember && (ui.blogSort === 'latest' || ui.blogSort === 'oldest')) {
      const site = ui.site
      const sort = ui.blogSort
      const page = ui.blogFeedPage
      const exclude = [...hiddenFeedKeys]
      latest = null
      latestErr = ''
      dirScreen?.scrollTo(0, 0) // a page/sort/site change lands at the top
      fetch(
        `/api/blog?site=${encodeURIComponent(site)}&limit=${BLOG_PER_PAGE}` +
          `&offset=${(page - 1) * BLOG_PER_PAGE}` +
          (sort === 'oldest' ? '&order=asc' : '') +
          (exclude.length ? `&exclude=${encodeURIComponent(exclude.join(','))}` : ''),
      )
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: { posts: LatestPost[]; total: number }) => {
          if (site !== ui.site || ui.blogMember || sort !== ui.blogSort || page !== ui.blogFeedPage)
            return // raced: context switched mid-flight
          if (!d.posts.length && page > 1) {
            /* the visible set shrank past this page (settings toggle) — fall
               back to page 1 instead of a dead empty page */
            ui.blogFeedPage = 1
            return
          }
          latest = d.posts
          latestTotal = d.total
        })
        .catch((e) => {
          if (site === ui.site && !ui.blogMember && sort === ui.blogSort && page === ui.blogFeedPage)
            latestErr = String(e)
        })
    }
  })

  /* the feed is ALSO filtered client-side: belt-and-braces against a stale
     response landing after a settings toggle (the server excludes hidden
     members too — see hiddenFeedKeys), and it reshapes what's already here
     while the re-fetch is in flight */
  const latestShown = $derived(
    latest
      ? latest.filter((p) => {
          if (gradHiddenFor(ui.site) && graduatedKeys.has(p.key)) return false
          return !genHidden.has(genSettingKey(ui.site, genByKey.get(p.key) ?? null))
        })
      : latest,
  )

  let menuOpen = $state(false)
  let settingsOpen = $state(false)
  function pickSort(id: SortId) {
    if (id !== ui.blogSort) {
      ui.blogSort = id
      ui.blogFeedPage = 1 // the page numbers name a different list now
    }
    menuOpen = false
  }
  function toggleGrad() {
    setGradHiddenFor(ui.site, !gradHiddenFor(ui.site))
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
    <!-- dark-mode toggle, rightmost like on the Talk header -->
    <button
      class="ic"
      aria-label={ui.theme === 'dark' ? 'ライトモード / light mode' : 'ダークモード / dark mode'}
      onclick={toggleTheme}
    >
      {@html icon(ui.theme === 'dark' ? 'sun' : 'moon')}
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
          aria-checked={gradHiddenFor(ui.site)}
          class:on={gradHiddenFor(ui.site)}
          class:off={!gradHiddenFor(ui.site)}
          onclick={toggleGrad}
        >
          <span>Hide graduated members</span>
          {@html icon('check')}
        </button>
        {#each siteGenRows as r (r.label)}
          {@const key = genSettingKey(ui.site, r.gen)}
          {@const shown = !genHidden.has(key)}
          <button
            class="setting-row"
            role="menuitemcheckbox"
            aria-checked={shown}
            class:on={shown}
            class:off={!shown}
            disabled={!r.enabled}
            title={r.enabled ? '' : 'no members from this generation'}
            onclick={() => toggleGenHidden(key)}
          >
            <span>Show {r.label}</span>
            {@html icon('check')}
          </button>
        {/each}
      </div>
    {/if}
  </header>

  <div class="sites">
    {#each siteKeys as k (k)}
      <button
        class:on={k === ui.site}
        onclick={() => ((ui.site = k), (ui.blogFeedPage = 1))}
      >
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

  <!-- feed count strip: same DOM position as the member list's (below the
     searchbar, outside the scrolling .screen) so it behaves as chrome in
     both views instead of scrolling away with the feed. Gated on `latest`
     like BlogMember gates on `entries` — stale totals don't outlive the
     loading state of the page they describe. -->
  {#if (ui.blogSort === 'latest' || ui.blogSort === 'oldest') && latest && latestTotal > 0}
    <div class="blog-count">
      Showing {feedStart}-{feedEnd} of {latestTotal} blogs
    </div>
  {/if}

  <div class="screen" bind:this={dirScreen}>
    <div class="col blog-directory" bind:clientWidth={colW}>
    <Scrollbar />
    {#snippet card(b: BlogMemberInfo)}
      <!-- an <a href> for archived members so middle-/ctrl-click and the
           context menu's open-in-new-tab work natively; unarchived ones stay
           disabled <button>s (no href = inert anchor, no focus, no menu) -->
      <svelte:element
        this={b.count ? 'a' : 'button'}
        class="blog-card"
        class:empty={!b.count}
        class:grad={b.graduated}
        href={b.count ? `#/blog/${encodeURIComponent(b.key)}/p/1` : undefined}
        disabled={b.count ? undefined : true}
        title={b.count ? '' : 'not archived yet'}
      >
        {#if b.thumb}
          <img src={b.thumb} loading="lazy" alt={b.name} />
        {:else}
          <div class="ph"></div>
        {/if}
        <span class="nm">{b.name}{b.graduated ? ' (卒)' : ''}</span>
        {#if b.roman}<span class="sub">{b.roman}</span>{/if}
        <span class="dt">{b.count ? fmtBlogStamp(b.last!) : '—'}</span>
      </svelte:element>
    {/snippet}

    {#if !(archive.blogs?.members ?? []).some((b) => b.site === ui.site)}
      <p class="muted-note">
        このサイトはアーカイブされていません<br />
        nothing archived for this site yet
      </p>
    {:else if !siteMembers.length}
      <p class="muted-note">
        表示する期生がありません<br />
        every generation is hidden
      </p>
    {:else if ui.blogSort === 'latest' || ui.blogSort === 'oldest'}
      {#if latestErr}
        <div class="muted-note">読み込み失敗 / {latestErr}</div>
      {:else if !latestShown}
        <div class="muted-note">読み込み中…</div>
      {:else}
        <div class="blog-latest">
          {#each latestShown as p (p.key + '/' + p.id)}
            <a class="blog-post-row" href={`#/blog/${encodeURIComponent(p.key)}/${p.id}`}>
              {#if p.thumbnail}
                <img src={p.thumb ?? p.thumbnail} loading="lazy" alt="" />
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
            </a>
          {/each}
        </div>
        <BlogPager bind:page={ui.blogFeedPage} pages={feedPages} {colW} label="feed pagination" />
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
