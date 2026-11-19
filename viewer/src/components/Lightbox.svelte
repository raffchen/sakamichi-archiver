<script lang="ts">
  import { fade } from 'svelte/transition'
  import { keynav } from '../lib/actions'
  import { closeLightbox, claimMedia, releaseMedia, lightbox, stepLightbox } from '../lib/store.svelte'
  import { fmtDateTime } from '../lib/format'
  import { icon } from '../lib/icons'
  import { loadVolume, saveVolume, loadPosition, savePosition, clearPosition } from '../lib/mediaPersist'

  const m = $derived(lightbox.items[lightbox.i])
  const n = $derived(lightbox.items.length)

  /* The media strip is a carousel of up to three slides — previous, current,
     next — that follows the finger 1:1 while dragging (Twitter/X style) and
     settles onto the nearest slide on release. Arrows and keyboard ride the
     same settle animation, so every entry point looks identical. */

  /* neighbours of the current index, keeping their absolute index k so each
     slide can be placed at (k - i) * 100% of the track */
  const slides = $derived.by(() => {
    const out: { it: (typeof lightbox.items)[number]; k: number }[] = []
    for (let k = Math.max(0, lightbox.i - 1); k <= Math.min(n - 1, lightbox.i + 1); k++) {
      out.push({ it: lightbox.items[k], k })
    }
    return out
  })

  /* the track's own width — NOT the body's: slide offsets are percentages of
     the track (body minus the 8px side padding), so the settle target must be
     in the same units or the spring overshoots before the index flip */
  let bodyW = $state(0)
  let dragPx = $state(0) /* finger offset from the current slide, px */
  let settling = $state(false) /* the track is animating to its target */

  /* a programmatic step (arrow chip / keyboard): animate the track a full
     slide over, then flip the index underneath — visually identical to a
     committed drag, and clamped ends do nothing */
  function step(d: number) {
    if (settling) return
    if (d < 0 ? lightbox.i === 0 : lightbox.i === n - 1) return
    beginSettle(-d * bodyW)
  }

  function beginSettle(target: number) {
    settling = true
    dragPx = target
    setTimeout(flip, 280)
  }

  /* the settle animation ends here: with the track now parked one full slide
     over, swapping i (and zeroing the offset) recomputes every slide's
     position to the exact same pixels — no visible jump */
  function flip() {
    const d = Math.round(-dragPx / bodyW)
    settling = false
    dragPx = 0
    if (d) stepLightbox(d)
  }

  /* touch drag — vertical drags stay with the caption scroll, and touches
     that begin on a button/link never drag the track. Videos DO drag, except
     over their own controls strip (bottom edge of the element): that area is
     the seek bar, and horizontal drags there must keep seeking. */
  let mode: '' | 'x' | 'y' = ''
  let startX = 0
  let startY = 0
  let lastX = 0
  let lastT = 0
  let vel = 0 /* px/ms, for flick detection */
  function onTouchStart(e: TouchEvent) {
    if (settling || (e.target as HTMLElement)?.closest('button, a')) {
      mode = 'y'
      return
    }
    const media = (e.target as HTMLElement)?.closest('video, audio')
    if (media) {
      const r = media.getBoundingClientRect()
      if (e.touches[0].clientY > r.bottom - Math.max(48, r.height * 0.18)) {
        mode = 'y'
        return
      }
    }
    startX = e.touches[0].clientX
    startY = e.touches[0].clientY
    lastX = startX
    lastT = performance.now()
    vel = 0
    mode = ''
  }
  function onTouchMove(e: TouchEvent) {
    if (settling || mode === 'y') return
    const t = e.touches[0]
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    if (!mode) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      mode = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
      if (mode === 'y') return
    }
    /* rubber-band past the ends — there is nothing to slide in from there */
    let x = dx
    if ((lightbox.i === 0 && x > 0) || (lightbox.i === n - 1 && x < 0)) x *= 0.25
    dragPx = x
    const now = performance.now()
    if (now > lastT) {
      vel = (t.clientX - lastX) / (now - lastT)
      lastX = t.clientX
      lastT = now
    }
  }
  function onTouchEnd() {
    if (mode !== 'x' || settling) {
      mode = ''
      return
    }
    mode = ''
    /* commit when the drag passes a quarter of the track, or on a quick flick
       in the drag direction even from a short distance */
    const towards = dragPx < 0 ? 1 : -1
    const canCommit = towards === 1 ? lightbox.i < n - 1 : lightbox.i > 0
    const far = Math.abs(dragPx) > bodyW * 0.25
    const flick = Math.abs(vel) > 0.5 && Math.abs(dragPx) > 24 && Math.sign(vel) === Math.sign(dragPx)
    beginSettle(canCommit && (far || flick) ? -towards * bodyW : 0)
  }

  /* ---- full-size zoom (mouse) ----
     A fitted image smaller than its natural size offers a zoom-in cursor;
     clicking it zooms to 100% centered on the clicked point (the click's
     x/y fraction of the fitted image maps onto the same fraction of the
     full-size one — no dumping at the top-left corner). While zoomed the
     cursor is grab and dragging pans freely; a release that moved <5px is
     a click and zooms back out to fit. Mouse only — touch keeps the 1:1
     swipe; arrow keys still step slides (the new slide opens fitted). */
  let zoomed = $state(false)
  let panX = $state(0)
  let panY = $state(0)
  /* the zoom-in click's fraction of the image — state, so re-zooming at a
     new point re-centers instead of keeping the first click's anchor */
  let anchorX = $state(0.5)
  let anchorY = $state(0.5)
  let dragging = $state(false)
  let downX = 0
  let downY = 0
  let downPanX = 0
  let downPanY = 0
  let moved = 0
  let bodyH = $state(0)

  /* natural sizes by src: a neighbour that later becomes the current slide
     reuses its element without a fresh load event, so per-src is the only
     reliable key; imgTick makes the deriveds re-read the map on any load */
  const natSizes = new Map<string, { w: number; h: number }>()
  let imgTick = $state(0)
  function noteImg(e: Event) {
    const el = e.currentTarget as HTMLImageElement
    if (!el.naturalWidth) return
    natSizes.set(el.getAttribute('src') ?? '', { w: el.naturalWidth, h: el.naturalHeight })
    imgTick++
  }
  const curSrc = $derived(lightbox.items[lightbox.i]?.file ?? lightbox.items[lightbox.i]?.thumb ?? '')
  const nat = $derived.by(() => {
    void imgTick
    return natSizes.get(curSrc) ?? { w: 0, h: 0 }
  })
  /* the fitted view shrinks the image when the slide box is smaller than it */
  const shrunk = $derived(nat.w > 0 && (nat.w > bodyW || nat.h > bodyH))

  /* pan along one axis, clamped to the coverage range (0 = pinned when the
     image doesn't fill the box) — clamping at write time keeps the state in
     range so reversing a drag doesn't eat distance against the limit */
  function clampPan(v: number, natDim: number, box: number, anchor: number) {
    if (natDim <= box) return 0
    const lo = box / 2 - natDim * (1 - anchor)
    const hi = anchor * natDim - box / 2
    return Math.min(Math.max(v, lo), hi)
  }

  /* the 100% view's top-left: the anchored point sits dead center, plus the
     accumulated pan — clamped so an axis the image fills never shows a gap
     (the image edge stops flush with the box edge and no further), while an
     axis narrower than the box stays centered with no pan at all */
  const zoomLeft = $derived.by(() => {
    if (nat.w <= bodyW) return (bodyW - nat.w) / 2
    return bodyW / 2 - anchorX * nat.w + clampPan(panX, nat.w, bodyW, anchorX)
  })
  const zoomTop = $derived.by(() => {
    if (nat.h <= bodyH) return (bodyH - nat.h) / 2
    return bodyH / 2 - anchorY * nat.h + clampPan(panY, nat.h, bodyH, anchorY)
  })

  /* any slide change (or close) returns to the fitted view */
  $effect(() => {
    void lightbox.i
    void lightbox.open
    zoomed = false
    panX = 0
    panY = 0
  })

  function zoomDown(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    dragging = true
    moved = 0
    downX = e.clientX
    downY = e.clientY
    downPanX = panX
    downPanY = panY
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function zoomMove(e: PointerEvent) {
    if (!dragging) return
    const dx = e.clientX - downX
    const dy = e.clientY - downY
    moved = Math.max(moved, Math.hypot(dx, dy))
    if (zoomed) {
      panX = clampPan(downPanX + dx, nat.w, bodyW, anchorX)
      panY = clampPan(downPanY + dy, nat.h, bodyH, anchorY)
    }
  }
  function zoomUp(e: PointerEvent) {
    if (!dragging) return
    dragging = false
    if (moved >= 5) return /* a pan, not a click — keep the zoom */
    const img = e.currentTarget as HTMLImageElement
    if (zoomed) {
      zoomed = false
      panX = 0
      panY = 0
      return
    }
    if (!shrunk || !img.naturalWidth) return
    const r = img.getBoundingClientRect()
    anchorX = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1)
    anchorY = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1)
    /* start in range: a point near an edge can't be centered (not enough
       content beyond it) — the view settles with that edge flush instead */
    panX = clampPan(0, nat.w, bodyW, anchorX)
    panY = clampPan(0, nat.h, bodyH, anchorY)
    zoomed = true
  }

  /* decode the neighbours ahead of the drag — otherwise the incoming slide is
     blank until its image loads and the drag shows nothing arriving */
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
  /* volume preference is global (localStorage, shared with the voice bubbles);
     position is per message id and session-scoped (in memory) — saved on
     pause, throttled while playing, and in the teardown effect so a slide
     change or close-and-reopen resumes, while a page reload starts fresh */
  const savedVol = loadVolume()
  let lbVol = $state(savedVol.vol)
  let lbMuted = $state(savedVol.muted)
  $effect(() => {
    saveVolume(lbVol, lbMuted)
  })

  let lastSaved = 0
  const persistEl = (el: HTMLMediaElement | undefined, it: { id: number } | undefined) => {
    if (!el || !it) return
    const t = el.currentTime
    if (t > 0.5 && t < (el.duration || 0) - 0.5) {
      savePosition(it.id, t)
      lastSaved = t
    }
  }
  const resume = (el: HTMLMediaElement | undefined, it: { id: number } | undefined) => {
    if (!el || !it) return
    const t = loadPosition(it.id)
    if (t > 0 && t < (el.duration || 0) - 0.5) {
      el.currentTime = t
      lastSaved = t
    }
  }

  /* dependencies: the element itself (new slide ⇒ save the outgoing one) and
     the current item — the captured el/it are what the cleanup persists */
  $effect(() => {
    const el = mediaEl
    const it = lightbox.items[lightbox.i]
    return () => {
      persistEl(el, it)
      el?.pause()
    }
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
  ontouchmove={onTouchMove}
  ontouchend={onTouchEnd}
  ontouchcancel={onTouchEnd}
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
      <div class="lb-track" bind:clientWidth={bodyW} bind:clientHeight={bodyH} class:settle={settling} style:transform={`translateX(${dragPx}px)`}>
        {#each slides as s (s.it.id)}
          <div class="lb-media" style:transform={`translateX(${(s.k - lightbox.i) * 100}%)`}>
            {#if s.k === lightbox.i}
              {#if s.it.type === 'picture'}
                <img
                  src={s.it.file ?? s.it.thumb ?? ''}
                  alt=""
                  draggable="false"
                  onload={noteImg}
                  class:zoomable={!zoomed && shrunk}
                  class:zoomed
                  class:panning={zoomed && dragging}
                  style:left={zoomed ? `${zoomLeft}px` : null}
                  style:top={zoomed ? `${zoomTop}px` : null}
                  style:width={zoomed ? `${nat.w}px` : null}
                  style:height={zoomed ? `${nat.h}px` : null}
                  onpointerdown={zoomDown}
                  onpointermove={zoomMove}
                  onpointerup={zoomUp}
                  onpointercancel={() => (dragging = false)}
                />
              {:else if s.it.type === 'video'}
                <!-- no caption track exists for these clips; the message text is shown below -->
                <!-- svelte-ignore a11y_media_has_caption -->
                <!-- is_silent means the app autoplays it muted; muted playback is also the
                     only thing browsers allow without a user gesture -->
                <video
                  bind:this={mediaEl}
                  src={s.it.file ?? ''}
                  poster={s.it.poster ?? undefined}
                  controls
                  autoplay
                  playsinline
                  muted={s.it.silent}
                  bind:volume={lbVol}
                  onloadedmetadata={(e) => resume(e.currentTarget, s.it)}
                  ontimeupdate={(e) => {
                    if (Math.abs(e.currentTarget.currentTime - lastSaved) > 2) persistEl(e.currentTarget, s.it)
                  }}
                  onplay={(e) => claimMedia(e.currentTarget)}
                  onpause={(e) => {
                    releaseMedia(e.currentTarget)
                    persistEl(e.currentTarget, s.it)
                  }}
                  onended={(e) => {
                    releaseMedia(e.currentTarget)
                    clearPosition(s.it.id)
                  }}
                ></video>
              {:else if s.it.type === 'voice'}
                <!-- svelte-ignore a11y_media_has_caption -->
                <audio
                  bind:this={mediaEl}
                  class="lb-audio"
                  src={s.it.file ?? ''}
                  controls
                  autoplay
                  bind:volume={lbVol}
                  bind:muted={lbMuted}
                  onloadedmetadata={(e) => resume(e.currentTarget, s.it)}
                  ontimeupdate={(e) => {
                    if (Math.abs(e.currentTarget.currentTime - lastSaved) > 2) persistEl(e.currentTarget, s.it)
                  }}
                  onplay={(e) => claimMedia(e.currentTarget)}
                  onpause={(e) => {
                    releaseMedia(e.currentTarget)
                    persistEl(e.currentTarget, s.it)
                  }}
                  onended={(e) => {
                    releaseMedia(e.currentTarget)
                    clearPosition(s.it.id)
                  }}
                ></audio>
              {/if}
            <!-- neighbours show a still instead of live media: a video sliding
                 by must not autoplay, an audio clip has nothing to show -->
            {:else if s.it.type === 'picture'}
              <img src={s.it.file ?? s.it.thumb ?? ''} alt="" />
            {:else if s.it.type === 'video'}
              <img src={s.it.poster ?? s.it.thumb ?? ''} alt="" />
            {:else}
              <span class="lb-voice-ph">{@html icon('voice')}</span>
            {/if}
          </div>
        {/each}
      </div>
      {#if n > 1}
        <!-- click zones are full-height screen halves (see .lb-nav); the visible
             chevrons are separate so they can sit above the media, pinned to the
             viewport center instead of riding on the caption height.
             Clamped stepping means an end has no further item — hide that chip.
             On touch/portrait screens both are display:none (CSS below): swipe
             is the only navigation there. -->
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
