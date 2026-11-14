<script lang="ts">
  import type { Archive, Member } from '../lib/types'
  import { openMember, ui, unreadCount } from '../lib/store.svelte'
  import { daysAgo, fmtDateTime } from '../lib/format'
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
  <span class="sp"></span>
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
    onfocus={() => (ui.view = 'search')}
    onkeydown={(e) => e.key === 'Enter' && (ui.view = 'search')}
    oninput={(e) => (ui.query = e.currentTarget.value)}
  />
</div>

<div class="screen">
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
    {#each siteKeys as k, i (k)}{#if i} — {/if}{archive.sites[k]?.name ?? k}：{siteTotals(k).messages} messages · {siteTotals(k).media} media{/each}<br />
    {archive.totals.messages} messages · {archive.totals.media} media total<br />
    sync: {fmtDateTime(archive.generated_at)}<br />
    tap a member to open the thread
  </p>
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
