<script lang="ts">
  import { onMount } from 'svelte'
  import type { Archive, Member } from '../lib/types'
  import { openMember, toggleTheme, ui, unreadCount } from '../lib/store.svelte'
  import { icon } from '../lib/icons'
  import { daysAgo, fmtFull } from '../lib/format'
  import { disp } from '../lib/display'

  let {
    archive,
    members,
    siteKeys,
  }: {
    archive: Archive
    members: Member[]
    siteKeys: string[]
  } = $props()

  /* "last checked" is when the syncer last talked to the API (probe or full
     round) — served live from the session-status records via /api/sync/status,
     so it doesn't move on index rebuilds the way generated_at does. Falls
     back to the index timestamp in dev (no API routes on the vite server). */
  let lastChecked = $state<string | null>(null)
  onMount(() => {
    let alive = true
    const load = () =>
      fetch('/api/sync/status')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (alive && j?.last_checked) lastChecked = j.last_checked
        })
        .catch(() => {}) // dev mode has no API routes — keep the fallback
    load()
    const t = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  })

  // UI chrome is English on both sites; member names stay 日本語 + roman
  const jp = $derived(ui.site === 'sakurazaka46')
  const site = $derived(archive.sites[ui.site] ?? { name: ui.site, roman: ui.site })

  /* "Online" is relative to the newest message in the archive, not to the
     wall clock — the archive is a fixed snapshot. */
  const newest = $derived(members.reduce((a, m) => ((m.last ?? '') > a ? m.last! : a), ''))
  const online = $derived(members.filter((m) => m.last && daysAgo(m.last, newest) <= 14))
  const offline = $derived(members.filter((m) => !online.includes(m)))

  // both grids show the Japanese name with the romanized name under it
  const label = (m: Member) => m.name
  const sub = (m: Member) => disp(m)

  // per-group counts for the footer, one segment per site tab
  const siteTotals = (k: string) => {
    const ms = archive.members.filter((m) => m.site === k)
    return {
      messages: ms.reduce((a, m) => a + m.message_count, 0),
      media: ms.reduce((a, m) => a + m.media_count, 0),
    }
  }
</script>

<header class="head">
  <span class="sp"></span>
  <h1>Talk</h1>
  <!-- dark-mode toggle: shows the icon you'd switch to (moon in light, sun
       in dark); the 34px slot keeps the centered title balanced -->
  <button
    class="ic"
    aria-label={ui.theme === 'dark' ? 'ライトモード / light mode' : 'ダークモード / dark mode'}
    onclick={toggleTheme}
  >
    {@html icon(ui.theme === 'dark' ? 'sun' : 'moon')}
  </button>
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
    placeholder="Search messages"
    aria-label="search"
    value={ui.query}
    onfocus={() => {
      ui.searchScope = 'message'
      ui.view = 'search'
    }}
    onkeydown={(e) => e.key === 'Enter' && ((ui.searchScope = 'message'), (ui.view = 'search'))}
    oninput={(e) => (ui.query = e.currentTarget.value)}
  />
</div>

<div class="screen">
  <div class="col">
  {#if !members.length}
    <p class="muted-note">
      このサイトはアーカイブされていません<br />
      nothing archived for this site yet
    </p>
  {/if}

  {#if online.length}
    <h2 class="sec">Online</h2>
    <div class="grid">
      {#each online as m (m.slug)}
        {@render cell(m)}
      {/each}
    </div>
  {/if}

  {#if offline.length}
    <div class="rule"></div>
    <h2 class="sec" class:dark={!jp}>{site.name}</h2>
    <div class="grid">
      {#each offline as m (m.slug)}
        {@render cell(m)}
      {/each}
    </div>
  {/if}

  <div class="rule"></div>
  <p class="muted-note">
    {site.name}：{siteTotals(ui.site).messages} messages · {siteTotals(ui.site).media} media<br />
    {archive.totals.messages} messages · {archive.totals.media} media total<br />
    sync: {fmtFull(lastChecked ?? archive.generated_at)}<br />
    tap a member to open the thread
  </p>
  </div>
</div>

{#snippet cell(m: Member)}
  <button class="cell" onclick={() => openMember(m.slug)}>
    <img class="ava" src={m.home ?? m.avatar ?? ''} alt={label(m)} loading="lazy" />
    {#if unreadCount(m.slug, m.messages) > 0}
      <span class="pill">{unreadCount(m.slug, m.messages)}</span>
    {/if}
    <span class="nm">{label(m)}</span>
    {#if sub(m)}
      <span class="sub">{sub(m)}</span>
    {/if}
  </button>
{/snippet}
