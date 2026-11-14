<script lang="ts">
  import { onMount } from 'svelte'
  import type { Member, Msg } from '../lib/types'
  import { openMember, showLightbox, seen, ui } from '../lib/store.svelte'
  import { fmtDur, fmtMediaStamp, fmtMonth } from '../lib/format'
  import { disp } from '../lib/display'
  import { icon } from '../lib/icons'
  import VoicePlayer from './VoicePlayer.svelte'

  let { member }: { member: Member } = $props()

  const jp = $derived(ui.site === 'sakurazaka46')
  const who = $derived(jp ? member.name : disp(member))
  const tabs = [
    { id: 'all', label: 'All', ic: 'grid' },
    { id: 'picture', label: 'Photos', ic: 'photo' },
    { id: 'video', label: 'Videos', ic: 'film' },
    { id: 'voice', label: 'Voice', ic: 'voice' },
  ] as const

  let filter = $state<'all' | 'picture' | 'video' | 'voice'>('all')

  /* official media list: oldest at the top, newest at the bottom, so sort
     ascending and let the month sections build themselves in order */
  const sorted = $derived(
    [...member.messages]
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id))
      .filter((m) => m.file && (filter === 'all' || m.type === filter)),
  )

  const months = $derived.by(() => {
    const out: { key: string; label: string; items: Msg[] }[] = []
    for (const m of sorted) {
      const x = new Date(m.at)
      const key = `${x.getFullYear()}-${x.getMonth()}`
      const last = out.at(-1)
      if (last && last.key === key) last.items.push(m)
      else out.push({ key, label: fmtMonth(m.at), items: [m] })
    }
    return out
  })

  const open = (m: Msg) => {
    const i = sorted.findIndex((x) => x.id === m.id)
    if (i >= 0) showLightbox(sorted, i, member.slug)
  }

  /* deep link: #/gallery/<slug>/<id> opens straight into the lightbox */
  onMount(() => {
    if (ui.focusId == null) return
    const i = sorted.findIndex((x) => x.id === ui.focusId)
    if (i >= 0) showLightbox(sorted, i, member.slug)
    else ui.focusId = null
  })

  /* the official voice tab: a flat list (no month headers) with a bottom
     player bar; tapping a row plays it there.
     Leaving the tab resets the player entirely — coming back does not
     resume (or restart) an old selection, and the audio element is torn
     down so nothing keeps playing in the background. */
  let selId = $state<number | null>(null)
  const sel = $derived(sorted.find((m) => m.id === selId) ?? null)
  $effect(() => {
    if (filter !== 'voice') selId = null
  })
  /* the pink dot on the avatar is the official unread marker: rows newer
     than the last-read marker (which the thread page updates) */
  const lastSeen = $derived(seen[member.slug] ?? '')

  /* the official list opens scrolled to the bottom, on the newest media.
     Heights are deterministic (square cells), but fonts can settle after
     mount — scroll now and again shortly after. */
  let screenEl = $state<HTMLElement | null>(null)
  $effect(() => {
    filter
    const el = screenEl
    if (!el) return
    const go = () => (el.scrollTop = el.scrollHeight)
    requestAnimationFrame(go)
    const t = setTimeout(go, 350)
    return () => clearTimeout(t)
  })
</script>

<header class="head">
  <button class="ic back" aria-label="back" onclick={() => (ui.view = 'thread')}>
    <i class="fa-solid fa-chevron-left"></i>
  </button>
  <span class="title-left">{who} — Media</span>
  <button class="ic" aria-label="open thread" title="thread" onclick={() => openMember(member.slug)}>
    <i class="fa-solid fa-comment-dots"></i>
  </button>
</header>

<div class="tabs-row">
  {#each tabs as t (t.id)}
    <button class:on={filter === t.id} onclick={() => (filter = t.id)} aria-label={t.label} title={t.label}>
      <i>{@html icon(t.ic)}</i>
    </button>
  {/each}
</div>

<div class="screen" bind:this={screenEl}>
  {#if !sorted.length}
    <p class="muted-note">該当なし / no media{member.missing ? ` — ${member.missing} 件は未アーカイブ` : ''}</p>
  {:else if filter === 'voice'}
    <div class="vlist">
      {#each sorted as m (m.id)}
        <button class="vrow" class:on={selId === m.id} onclick={() => (selId = m.id)}>
          <span class="vava">
            <img src={member.avatar ?? member.home ?? ''} alt="" loading="lazy" />
            {#if m.at > lastSeen}<span class="vdot"></span>{/if}
          </span>
          <span class="vname">
            {who}
            {#if selId === m.id}<i class="vwave">{@html icon('voice')}</i>{/if}
          </span>
          <span class="vmeta">
            <span class="vdate">{fmtMediaStamp(m.at)}</span>
            <span class="vdur">{fmtDur(m.dur)}</span>
          </span>
        </button>
      {/each}
    </div>
  {:else}
    {#each months as mo (mo.key)}
      <h2 class="month">{mo.label}</h2>
      <div class="mgrid">
        {#each mo.items as m (m.id)}
          <figure>
            {#if m.type === 'voice'}
              <button class="vthumb" onclick={() => open(m)} aria-label="音声を再生 / play voice message">
                <i>{@html icon('voice')}</i>
              </button>
            {:else if m.type === 'video'}
              <button class="gbtn" onclick={() => open(m)} aria-label="開く / open">
                <img src={m.thumb ?? m.file ?? ''} alt="" loading="lazy" />
                <span class="vplay" aria-hidden="true"><i>{@html icon('play')}</i></span>
              </button>
            {:else}
              <button class="gbtn" onclick={() => open(m)} aria-label="開く / open">
                <img src={m.thumb ?? m.file ?? ''} alt="" loading="lazy" />
              </button>
            {/if}
            {#if m.type === 'video' && m.silent}
              <span class="mut">{@html icon('mute')}</span>
            {/if}
            {#if m.dur}
              <span class="dur">{fmtDur(m.dur)}</span>
            {/if}
          </figure>
        {/each}
      </div>
    {/each}
  {/if}
</div>

{#if filter === 'voice' && sel}
  <VoicePlayer m={sel} {member} {who} />
{/if}

<style>
  .gbtn {
    display: block;
    width: 100%;
    height: 100%;
    background: none;
  }

  /* ---- voice tab: official list design ---- */
  .vlist {
    padding-bottom: 8px;
  }
  .vrow {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 13px 14px;
    border-bottom: 1px solid var(--line);
    text-align: left;
  }
  .vava {
    position: relative;
    flex: none;
    width: 46px;
    height: 46px;
  }
  .vava img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }
  .vdot {
    position: absolute;
    top: 0;
    right: 0;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
  }
  .vname {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 17px;
    font-weight: 600;
    color: var(--ink);
  }
  .vrow.on .vname {
    color: var(--accent);
  }
  .vname :global(svg) {
    width: 19px;
    height: 19px;
    stroke: currentColor;
    fill: none;
    flex: none;
  }
  .vmeta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
    flex: none;
  }
  .vdate {
    color: var(--muted);
    font-size: 14.5px;
  }
  .vdur {
    color: var(--muted);
    font-size: 15px;
  }
</style>
