<script lang="ts">
  import { fade, type TransitionConfig } from 'svelte/transition'
import { cubicOut } from 'svelte/easing'
  import { keynav } from '../lib/actions'
  import { closeLightbox, claimMedia, releaseMedia, lightbox, stepLightbox } from '../lib/store.svelte'
  import { fmtDateTime } from '../lib/format'
  import { icon } from '../lib/icons'

  const m = $derived(lightbox.items[lightbox.i])
  const n = $derived(lightbox.items.length)

  /* direction of the last step — a push transition: the outgoing media slides
     out one way while the incoming slides in from the other, in sync, like a
     carousel. Every entry point (swipe, arrows, keys) goes through step() so
     dir is always right. dir starts 0 = "not a step": the lightbox just opens
     with the overlay fade, no slide. */
  let dir = $state(0)
  function step(d: number) {
    dir = d
    stepLightbox(d)
  }

  /* percent-based push halves (translateX(±100%) of the full-width overlay),
     so both layers move together and their edges stay glued — no fade. */
  function pushIn(node: Element, { dir: d }: { dir: number }): TransitionConfig {
    return d
      ? { duration: 260, easing: cubicOut, css: (t: number) => `transform: translateX(${d * 100 * (1 - t)}%)` }
      : { duration: 0, css: () => '' } /* dir 0 = the box just opened — no slide */
  }
  function pushOut(node: Element, { dir: d }: { dir: number }): TransitionConfig {
    return d
      ? { duration: 260, easing: cubicOut, css: (t: number) => `transform: translateX(${-d * 100 * (1 - t)}%)` }
      : { duration: 0, css: () => '' }
  }

  /* decode the neighbours ahead of the step — otherwise the sliding-in layer
     is blank until its image loads and the push shows nothing arriving */
  $effect(() => {
    const { items, i } = lightbox
    for (const k of [i - 1, i + 1]) {
      const it = items[k]
      const src = it && (it.type === 'picture' ? (it.file ?? it.thumb) : (it.poster ?? it.thumb))
      if (src) new Image().src = src
    }
  })

  /* the lightbox media (video/audio) is ephemeral — pause its own element on
     teardown, otherwise a removed-but-playing video keeps playing in the
     background and the next voice claim has nothing to stop */
  let mediaEl = $state<HTMLMediaElement | undefined>()
  $effect(() => {
    const el = mediaEl
    return () => el?.pause()
  })

  /* clicking the backdrop (anything that isn't the media, the nav buttons or
     the close/download buttons) returns to the thread */
  function onBackdrop(e: MouseEvent) {
    if ((e.target as HTMLElement)?.closest('button, a, img, video, audio')) return
    closeLightbox()
  }

  /* download keeps the archive filename (<message-id>_<published-at>.<ext>) */
  function fileName(m: (typeof lightbox.items)[number]) {
    const p = m.file ?? m.thumb ?? ''
    return decodeURIComponent(p.split('/').pop() || '') || 'media'
  }

  /* touch swipe navigation — on phones the arrow chips are hidden (CSS below:
     they sat on top of the photo and blurred it), so a horizontal flick steps
     prev/next. Vertical drags (caption scroll) and anything starting on a
     button/link/video/audio are left alone — those have their own gestures. */
  let touchX = 0
  let touchY = 0
  let swiping = false
  function onTouchStart(e: TouchEvent) {
    if ((e.target as HTMLElement)?.closest('button, a, video, audio')) {
      swiping = false
      return
    }
    touchX = e.touches[0].clientX
    touchY = e.touches[0].clientY
    swiping = true
  }
  function onTouchEnd(e: TouchEvent) {
    if (!swiping) return
    swiping = false
    const dx = e.changedTouches[0].clientX - touchX
    const dy = e.changedTouches[0].clientY - touchY
    /* 48px minimum flick, and clearly more horizontal than vertical */
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    step(dx < 0 ? 1 : -1)
  }
</script>

<!-- the backdrop click is a convenience; Esc (use:keynav) and ✕ are the
     accessible close paths -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="lb"
  transition:fade={{ duration: 130 }}
  use:keynav={{ onLeft: () => step(-1), onRight: () => step(1), onEsc: closeLightbox }}
  onclick={onBackdrop}
  ontouchstart={onTouchStart}
  ontouchend={onTouchEnd}
>
  <div class="lb-top">
    <span>{lightbox.i + 1} / {n}</span>
    {#if m}<span>{fmtDateTime(m.at)}</span> · <span>{m.type}</span>{/if}
    {#if m?.file || m?.thumb}
      <a class="dl" href={m.file ?? m.thumb!} download={fileName(m)} aria-label="download" title="download">{@html icon('download')}</a>
    {/if}
    <button class="x" aria-label="close" onclick={closeLightbox}>✕</button>
  </div>

  <div class="lb-body">
    {#if m}
      {#key m.id}
        <!-- the wrapper is an absolutely-positioned overlay (see .lb-media) so
             the outgoing media fades out underneath the incoming one instead
             of both briefly stacking as separate grid rows -->
        <div class="lb-media" in:pushIn={{ dir }} out:pushOut={{ dir }}>
        {#if m.type === 'picture'}
          <img src={m.file ?? m.thumb ?? ''} alt="" />
        {:else if m.type === 'video'}
          <!-- no caption track exists for these clips; the message text is shown below -->
          <!-- svelte-ignore a11y_media_has_caption -->
          <!-- is_silent means the app autoplays it muted; muted playback is also the
               only thing browsers allow without a user gesture -->
          <video
            bind:this={mediaEl}
            src={m.file ?? ''}
            poster={m.poster ?? undefined}
            controls
            autoplay
            playsinline
            muted={m.silent}
            onplay={(e) => claimMedia(e.currentTarget)}
            onpause={(e) => releaseMedia(e.currentTarget)}
            onended={(e) => releaseMedia(e.currentTarget)}
          ></video>
        {:else if m.type === 'voice'}
          <!-- svelte-ignore a11y_media_has_caption -->
          <audio
            bind:this={mediaEl}
            class="lb-audio"
            src={m.file ?? ''}
            controls
            autoplay
            onplay={(e) => claimMedia(e.currentTarget)}
            onpause={(e) => releaseMedia(e.currentTarget)}
            onended={(e) => releaseMedia(e.currentTarget)}
          ></audio>
        {/if}
        </div>
      {/key}
      {#if n > 1}
        <!-- click zones are full-height screen halves (see .lb-nav); the visible
             chevrons are separate so they can sit above the media, pinned to the
             viewport center instead of riding on the caption height.
             Clamped stepping means an end has no further item — hide that chip. -->
        {#if lightbox.i > 0}
          <button class="lb-nav l" aria-label="previous" onclick={() => step(-1)}></button>
          <span class="lb-glyph l" aria-hidden="true">{@html icon('back')}</span>
        {/if}
        {#if lightbox.i < n - 1}
          <button class="lb-nav r" aria-label="next" onclick={() => step(1)}></button>
          <span class="lb-glyph r" aria-hidden="true">{@html icon('forward')}</span>
        {/if}
      {/if}
    {/if}
  </div>

  {#if m?.text}<div class="lb-cap">{m.text}</div>{/if}
</div>
