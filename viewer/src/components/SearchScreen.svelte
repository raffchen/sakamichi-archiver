<script lang="ts">
  import { onMount } from 'svelte'
  import type { Archive, Member, Msg } from '../lib/types'
  import { openMember, ui } from '../lib/store.svelte'
  import { fmtDateTime } from '../lib/format'
  import { disp } from '../lib/display'

  let { archive }: { archive: Archive } = $props()

  let input = $state<HTMLInputElement | undefined>()
  const q = $derived(ui.query.trim())
  const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  type Hit = { m: Member; msg: Msg }
  const hits = $derived.by(() => {
    if (!q) return [] as Hit[]
    const needle = q.toLowerCase()
    const out: Hit[] = []
    for (const mem of archive.members) {
      for (const msg of mem.messages) {
        if (msg.text && msg.text.toLowerCase().includes(needle)) out.push({ m: mem, msg })
        if (out.length >= 300) return out
      }
    }
    return out
  })

  const parts = (text: string) =>
    text.split(new RegExp(`(${escRe(q)})`, 'ig')).map((s) => ({ s, hit: q ? s.toLowerCase() === q.toLowerCase() : false }))

  onMount(() => input?.focus())
</script>

<header class="head">
  <button class="ic back" aria-label="back" onclick={() => (ui.view = 'home')}>
    <i class="fa-solid fa-chevron-left"></i>
  </button>
  <span class="title-left">Search</span>
  <span class="sp"></span>
</header>

<div class="searchbar">
  <input
    type="search"
    bind:this={input}
    bind:value={ui.query}
    placeholder="キーワード / keyword"
    aria-label="search"
  />
</div>

<div class="screen">
  {#if !q}
    <p class="muted-note">{archive.totals.messages} 件のメッセージから検索 / searching {archive.totals.messages} messages</p>
  {:else if !hits.length}
    <p class="muted-note">該当なし / no matches for “{q}”</p>
  {:else}
    <p class="muted-note">{hits.length}{hits.length >= 300 ? '+' : ''} 件中</p>
    {#each hits as h (`${h.m.slug}-${h.msg.id}`)}
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
            {#each parts(h.msg.text ?? '') as p}
              {#if p.hit}<mark>{p.s}</mark>{:else}{p.s}{/if}
            {/each}
          </span>
        </span>
      </button>
    {/each}
  {/if}
</div>
