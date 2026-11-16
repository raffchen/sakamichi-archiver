<script lang="ts">
  import { onMount } from 'svelte'
  import type { Archive, Member, Msg } from '../lib/types'
  import { openMember, openBlog, ui } from '../lib/store.svelte'
  import { requireLogin } from '../lib/auth.svelte'
  import { fmtDateTime } from '../lib/format'

  let { archive }: { archive: Archive } = $props()

  /* scope: the Talk page's bar searches messages (?type=message), the Blog
     tab's searches blog posts (?type=blog) */
  const blogOnly = $derived(ui.searchScope === 'blog')

  let input = $state<HTMLInputElement | undefined>()
  const q = $derived(ui.query.trim())
  const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  /* ---- server search (stage 2): exact section from the SQLite FTS index.
     Debounced, abortable; any failure (no DB, endpoint missing, network)
     drops back to the instant client-side scan over index.json messages. */
  type Hit = {
    type: 'blog' | 'message'
    key?: string // blog: directory key under media/blogs/
    slug?: string // message: member slug
    id: string | number
    title?: string | null
    member: string
    at: string | null
    mtype?: string | null
    site?: string | null
    avatar?: string | null
    snippet: string
    score: number
  }
  type SearchReply = { available: boolean; exact: Hit[]; related: Hit[]; took_ms: number }

  let results = $state<SearchReply | null>(null)
  let searching = $state(false)

  const memberBySlug = $derived.by(() => new Map(archive.members.map((m) => [m.slug, m])))
  const blogByKey = $derived.by(() => new Map((archive.blogs?.members ?? []).map((m) => [m.key, m])))

  /* client-side fallback scan (messages only — blog bodies aren't in index.json).
     Only valid while the index still carries full texts (vite dev); once the
     server slims it, old texts aren't on the client and search is server-only. */
  type LocalHit = { m: Member; msg: Msg }
  const localHits = $derived.by(() => {
    if (!q || blogOnly || results?.available || archive.textsTruncated) return [] as LocalHit[]
    const needle = q.toLowerCase()
    const out: LocalHit[] = []
    for (const mem of archive.members) {
      for (const msg of mem.messages) {
        if (msg.text && msg.text.toLowerCase().includes(needle)) out.push({ m: mem, msg })
        if (out.length >= 300) return out
      }
    }
    return out
  })

  const localParts = (text: string) =>
    text.split(new RegExp(`(${escRe(q)})`, 'ig')).map((s) => ({ s, hit: q ? s.toLowerCase() === q.toLowerCase() : false }))

  let seq = 0
  $effect(() => {
    const query = q
    const scoped = blogOnly // re-run when the scope flips too
    seq++
    const mySeq = seq
    if (!query) {
      results = null
      searching = false
      return
    }
    searching = true
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}${scoped ? '&type=blog' : '&type=message'}`, { signal: ctrl.signal })
        .then((r) => {
          if (r.status === 401) requireLogin() // message search is gated
          return r.json()
        })
        .then((reply: SearchReply) => {
          if (mySeq === seq) {
            results = reply
            searching = false
          }
        })
        .catch(() => {
          if (mySeq === seq) {
            results = { available: false, exact: [], related: [], took_ms: 0 }
            searching = false
          }
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  })

  const openHit = (h: Hit) => {
    if (h.type === 'blog' && h.key) {
      if (h.site) ui.site = h.site
      openBlog(h.key, Number(h.id))
    } else if (h.slug) {
      const mem = memberBySlug.get(h.slug)
      if (mem?.site) ui.site = mem.site
      openMember(h.slug, Number(h.id))
    }
  }

  const goBack = () => {
    if (blogOnly) {
      ui.searchScope = 'message'
      openBlog()
    } else ui.view = 'home'
  }

  onMount(() => input?.focus())
</script>

<header class="head">
  <button class="ic back" aria-label="back" onclick={goBack}>
    <i class="fa-solid fa-chevron-left"></i>
  </button>
  <span class="title-left">{blogOnly ? 'Blog search' : 'Search'}</span>
  <span class="sp"></span>
</header>

<div class="searchbar">
  <input
    type="search"
    bind:this={input}
    bind:value={ui.query}
    placeholder={blogOnly ? 'ブログを検索 / search blog posts' : 'キーワード / keyword'}
    aria-label="search"
  />
</div>

<div class="screen">
  {#if !q}
    <p class="muted-note">
      {#if blogOnly}
        ブログ記事を検索 / searching blog posts
      {:else}
        {archive.totals.messages} 件のメッセージから検索 / searching {archive.totals.messages} messages
      {/if}
    </p>
  {:else if results?.available}
    {#if !results.exact.length && !results.related.length}
      <p class="muted-note">該当なし / no matches for “{q}”</p>
    {:else}
      <p class="muted-note">
        {results.exact.length} 件 · {results.took_ms}ms
        {#if searching}<span class="spin">⋯</span>{/if}
      </p>

      {#if results.exact.length}
        <p class="section-label">完全一致 / exact matches</p>
        {#each results.exact as h (`${h.type}-${h.key ?? h.slug}-${h.id}`)}
          {@render hitCard(h)}
        {/each}
      {:else if results.related.length}
        <p class="muted-note">完全一致なし / showing related</p>
      {/if}

      {#if results.related.length}
        {@const relBlog = results.related.filter((h) => h.type === 'blog')}
        {@const relMsg = results.related.filter((h) => h.type === 'message')}
        <p class="section-label">おすすめ / related</p>
        {#if relBlog.length}
          <p class="sub-label">ブログ / blog posts</p>
          {#each relBlog as h (`${h.type}-${h.key ?? h.slug}-${h.id}`)}
            {@render hitCard(h, true)}
          {/each}
        {/if}
        {#if relMsg.length}
          <p class="sub-label">メッセージ / messages</p>
          {#each relMsg as h (`${h.type}-${h.slug}-${h.id}`)}
            {@render hitCard(h, true)}
          {/each}
        {/if}
      {/if}
    {/if}
  {:else if searching && (blogOnly || archive.textsTruncated)}
    <p class="muted-note">検索中…</p>
  {:else if blogOnly}
    <p class="muted-note">ブログ検索にはアーカイブサーバーが必要 / blog search needs the archive server</p>
  {:else if archive.textsTruncated}
    <p class="muted-note">検索にはアーカイブサーバーが必要 / search needs the archive server</p>
  {:else if localHits.length}
    <p class="muted-note">{localHits.length}{localHits.length >= 300 ? '+' : ''} 件中</p>
    {#each localHits as h (`${h.m.slug}-${h.msg.id}`)}
      <button
        class="hit"
        onclick={() => {
          ui.site = h.m.site ?? ui.site
          openMember(h.m.slug, h.msg.id)
        }}
      >
        <img class="ava" src={h.m.avatar ?? h.m.home ?? ''} alt="" loading="lazy" />
        <span>
          <span class="m">{h.m.roman ?? h.m.name} · {fmtDateTime(h.msg.at)} · {h.msg.type}</span>
          <span class="t">
            {#each localParts(h.msg.text ?? '') as p}
              {#if p.hit}<mark>{p.s}</mark>{:else}{p.s}{/if}
            {/each}
          </span>
        </span>
      </button>
    {/each}
  {:else}
    <p class="muted-note">該当なし / no matches for “{q}”</p>
  {/if}
</div>

{#snippet hitCard(h: Hit, related = false)}
  <button class="hit" onclick={() => openHit(h)}>
    <img
      class="ava"
      src={
        h.type === 'blog'
          ? (blogByKey.get(h.key ?? '')?.thumb ?? '')
          : (memberBySlug.get(h.slug ?? '')?.avatar ?? h.avatar ?? '')
      }
      alt=""
      loading="lazy"
    />
    <span>
      <span class="m">
        <span class="badge" class:blog={h.type === 'blog'}>{h.type === 'blog' ? 'Blog' : 'Message'}</span>
        {(h.type === 'blog' ? blogByKey.get(h.key ?? '')?.name : memberBySlug.get(h.slug ?? '')?.name) ?? h.member}
        · {h.type === 'blog' ? (h.at ?? '').slice(0, 10) : h.at ? fmtDateTime(h.at) : ''}{#if h.type === 'message'} · {h.mtype}{/if}
      </span>
      {#if h.type === 'blog' && h.title}
        <span class="t">{h.title}</span>
      {/if}
      <span class="t"><!-- safe: server-controlled snippet over stripped plain text -->
        {@html h.snippet}
      </span>
      {#if related}
        <span class="sim">{Math.round(Math.max(0, Math.min(1, h.score)) * 100)}%</span>
      {/if}
    </span>
  </button>
{/snippet}

<style>
  .section-label {
    margin: 10px 14px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    opacity: 0.55;
  }
  .sub-label {
    margin: 8px 14px 2px;
    font-size: 10px;
    font-weight: 600;
    opacity: 0.45;
  }
  .badge {
    display: inline-block;
    padding: 0 5px;
    margin-right: 4px;
    border-radius: 4px;
    background: var(--bubble);
    color: var(--accent);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    vertical-align: 1px;
  }
  .sim {
    display: inline-block;
    margin-top: 2px;
    padding: 0 5px;
    border-radius: 4px;
    background: var(--accent);
    color: #fff;
    font-size: 9px;
    font-weight: 700;
  }
  .spin {
    opacity: 0.5;
  }
  .t :global(mark) {
    background: color-mix(in srgb, var(--accent) 25%, transparent);
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }
</style>
