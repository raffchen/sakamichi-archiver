<script lang="ts">
  import { fade } from 'svelte/transition'
  import { keynav } from '../lib/actions'
  import { closeLightbox, claimMedia, releaseMedia, lightbox, stepLightbox } from '../lib/store.svelte'
  import { fmtDateTime } from '../lib/format'
  import { icon } from '../lib/icons'

  const m = $derived(lightbox.items[lightbox.i])
  const n = $derived(lightbox.items.length)

  /* the lightbox media (video/audio) is ephemeral — pause its own element on
     teardown, otherwise a removed-but-playing video keeps playing in the
     background and the next voice claim has nothing to stop */
  let mediaEl = $state<HTMLMediaElement | undefined>()
  $effect(() => {
    const el = mediaEl
    return () => el?.pause()
  })

  /* clicking the backdrop (anything that isn't the media, the nav buttons or
     the close button) returns to the thread */
  function onBackdrop(e: MouseEvent) {
    if ((e.target as HTMLElement)?.closest('button, img, video, audio')) return
    closeLightbox()
  }
</script>

<!-- the backdrop click is a convenience; Esc (use:keynav) and ✕ are the
     accessible close paths -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="lb"
  transition:fade={{ duration: 130 }}
  use:keynav={{ onLeft: () => stepLightbox(-1), onRight: () => stepLightbox(1), onEsc: closeLightbox }}
  onclick={onBackdrop}
>
  <div class="lb-top">
    <span>{lightbox.i + 1} / {n}</span>
    {#if m}<span>{fmtDateTime(m.at)}</span> · <span>{m.type}</span>{/if}
    <button class="x" aria-label="close" onclick={closeLightbox}>✕</button>
  </div>

  <div class="lb-body">
    {#if m}
      {#key m.id}
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
      {/key}
      {#if n > 1}
        <!-- click zones are full-height screen halves (see .lb-nav); the visible
             chevrons are separate so they can sit above the media, pinned to the
             viewport center instead of riding on the caption height.
             Clamped stepping means an end has no further item — hide that chip. -->
        {#if lightbox.i > 0}
          <button class="lb-nav l" aria-label="previous" onclick={() => stepLightbox(-1)}></button>
          <span class="lb-glyph l" aria-hidden="true">{@html icon('back')}</span>
        {/if}
        {#if lightbox.i < n - 1}
          <button class="lb-nav r" aria-label="next" onclick={() => stepLightbox(1)}></button>
          <span class="lb-glyph r" aria-hidden="true">{@html icon('forward')}</span>
        {/if}
      {/if}
    {/if}
  </div>

  {#if m?.text}<div class="lb-cap">{m.text}</div>{/if}
</div>
