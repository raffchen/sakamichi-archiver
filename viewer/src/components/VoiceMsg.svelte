<script lang="ts">
  import type { Msg } from '../lib/types'
  import { fmtDur } from '../lib/format'
  import { icon } from '../lib/icons'
  import { claimMedia, releaseMedia } from '../lib/store.svelte'

  let { m, autostart = false }: { m: Msg; autostart?: boolean } = $props()

  let audio = $state<HTMLAudioElement | undefined>()
  let playing = $state(false)
  let dur = $state(0)
  let cur = $state(0)
  let vol = $state(1)
  let muted = $state(false)
  /* before the first play the label shows the clip's total length; once
     playback (or a scrub) moves the position, it becomes a running clock */
  let started = $state(false)

  const toggle = () => {
    const a = audio
    if (!a) return
    if (a.paused) void a.play?.()?.catch(() => {}) // AutoplayPolicy can reject the first gesture
    else a.pause()
  }

  /* the media-page voice player remounts this per selected row and wants
     playback to start immediately (the tap that chose the row provides the
     user activation) */
  $effect(() => {
    if (autostart && audio) void audio.play?.()?.catch(() => {})
  })
</script>

<div class="bubble media voice">
  <div class="vrow">
    <button class="go" onclick={toggle} aria-label={playing ? 'pause' : 'play'}>
      {@html icon(playing ? 'pause' : 'play')}
    </button>
    <!-- draggable scrubber: two-way bound with the audio's currentTime,
         so dragging seeks and playback moves the thumb. The time shows the
         position within the file instead of the total length. -->
    <input
      class="scrub"
      type="range"
      min="0"
      max={dur || 1}
      step="0.1"
      bind:value={cur}
      oninput={() => (started = true)}
      style="--p: {dur ? Math.round((cur / dur) * 100) : 0}%"
      aria-label="position"
    />
    <span class="dur">{started ? (cur ? fmtDur(cur) : '0:00') : fmtDur(dur || null)}</span>
    <div class="vol-wrap">
      <div class="vol-pop">
        <input
          class="vol-slider"
          type="range"
          min="0"
          max="1"
          step="0.01"
          bind:value={vol}
          style="--v: {Math.round(vol * 100)}%"
          aria-label="volume"
        />
      </div>
      <button
        class="vol-toggle"
        onclick={() => (muted = !muted)}
        aria-label={muted ? 'unmute' : 'mute'}
        title={muted ? 'unmute' : 'mute'}
      >
        <i
          class="fa-solid {muted || vol === 0 ? 'fa-volume-xmark' : vol < 0.5 ? 'fa-volume-low' : 'fa-volume-high'}"
        ></i>
      </button>
    </div>
  </div>
</div>

{#if m.file}
  <audio
    src={m.file}
    preload="metadata"
    bind:this={audio}
    bind:currentTime={cur}
    bind:duration={dur}
    bind:volume={vol}
    bind:muted={muted}
    onplay={(e) => {
      playing = true
      started = true
      claimMedia(e.currentTarget)
    }}
    onpause={(e) => {
      playing = false
      releaseMedia(e.currentTarget)
    }}
    onended={(e) => {
      playing = false
      releaseMedia(e.currentTarget)
    }}
  ></audio>
{:else}
  <div class="missing">🔊 通話メッセージ（未アーカイブ）/ voice message not archived</div>
{/if}

<style>
  audio {
    display: none;
  }
</style>
