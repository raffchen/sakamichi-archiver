<script lang="ts">
  import { onMount, tick } from 'svelte'
  import type { Archive, Member, Msg } from '../lib/types'
  import { markSeen, openGallery, seenAt, showLightbox, ui } from '../lib/store.svelte'
  import { dayKey, fmtDayLabel } from '../lib/format'
  import { disp } from '../lib/display'
  import { sentinel } from '../lib/actions'
  import Message from './Message.svelte'

  let { archive, member }: { archive: Archive; member: Member } = $props()

  const PAGE = 40
  const jp = $derived(ui.site === 'sakurazaka46')
  const who = $derived(jp ? member.name : disp(member))

  let shown = $state(PAGE)
  let el = $state<HTMLElement | undefined>()
  let boundary = $state('') // "new" divider position, snapshotted before we mark read

  const visible = $derived(member.messages.slice(-shown))
  const atStart = $derived(visible.length === member.messages.length)
  const media = $derived(member.messages.filter((m) => m.file))

  /* flat block list: day separators + the "New" marker interleaved */
  const blocks = $derived.by(() => {
    const out: Array<{ k: string; kind: 'sep'; at: string } | { k: string; kind: 'new' } | { k: string; kind: 'msg'; m: Msg }> = []
    let prev: string | null = null
    let newPlaced = false
    for (const m of visible) {
      const dk = dayKey(m.at)
      if (dk !== prev) {
        out.push({ k: `d${m.id}`, kind: 'sep', at: m.at })
        prev = dk
      }
      if (!newPlaced && boundary && m.at > boundary) {
        out.push({ k: 'new', kind: 'new' })
        newPlaced = true
      }
      out.push({ k: `m${m.id}`, kind: 'msg', m })
    }
    return out
  })

  const openMedia = (m: Msg) => {
    const i = media.findIndex((x) => x.id === m.id)
    if (i >= 0) showLightbox(media, i, member.slug)
  }

  async function loadOlder() {
    if (atStart || !el) return
    const prevH = el.scrollHeight
    const prevTop = el.scrollTop
    shown = Math.min(member.messages.length, shown + PAGE)
    await tick()
    if (el) el.scrollTop = el.scrollHeight - prevH + prevTop
  }

  onMount(async () => {
    boundary = seenAt(member.slug) ?? ''
    markSeen(member.slug, member.last)

    const focus = ui.focusId
    if (focus != null) {
      const idx = member.messages.findIndex((m) => m.id === focus)
      if (idx >= 0) shown = Math.max(shown, member.messages.length - idx + 5)
      await tick()
      document.getElementById(`m-${focus}`)?.scrollIntoView({ block: 'center' })
      ui.focusId = null
    } else {
      await tick()
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight // open at the newest message, like the app
      })
    }
  })
</script>

<header class="head">
  <button class="ic back" aria-label="back" onclick={() => (ui.view = 'home')}>
    <i class="fa-solid fa-chevron-left"></i>
  </button>
  <span class="title-left">{who}</span>
  <button
    class="ic"
    title="this member’s media"
    aria-label="media gallery"
    onclick={() => openGallery(member.slug)}
  >
    <i class="fa-solid fa-images"></i>
  </button>
</header>

<div class="screen" bind:this={el}>
  <div class="thread">
    <div class="top-load" use:sentinel={{ onLoad: loadOlder, enabled: !atStart }}>
      {atStart
        ? `—— 先頭 / start of archive (${member.message_count} messages) ——`
        : `older messages… ${shown}/${member.message_count}`}
    </div>

    {#each blocks as b (b.k)}
      {#if b.kind === 'sep'}
        <div class="daysep">{fmtDayLabel(b.at)}</div>
      {:else if b.kind === 'new'}
        <div class="newsep">New</div>
      {:else}
        <Message m={b.m} {member} {who} onOpenMedia={openMedia} />
      {/if}
    {/each}
  </div>
</div>
