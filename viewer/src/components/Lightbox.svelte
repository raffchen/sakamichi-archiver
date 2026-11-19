<script lang="ts">
  import { fade } from 'svelte/transition'
  import { keynav, noPageZoom } from '../lib/actions'
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
     the seek bar, and horizontal drags there must keep seeking. While zoomed
     a one-finger drag on the image pans it instead of swiping (slides change
     only when fit); two fingers pinch-zoom with the midpoint's content
     pinned; a quick tap pairs with the previous one into a double-tap
     (fit ↔ 2× fit, centered on the tap — same geometry as the mouse). */
  let mode: '' | 'x' | 'y' | 'pan' | 'pinch' = ''
  let startX = 0
  let startY = 0
  let lastX = 0
  let lastT = 0
  let vel = 0 /* px/ms, for flick detection */
  let tapMoved = 0 /* furthest finger travel since touchstart — tap eligibility */
  let panZx0 = 0
  let panZy0 = 0
  let pinchD0 = 0
  let pinchScale0 = 1
  let pinchRaw = 1 /* undamped scale, settles on release */
  let pinchCx = 0.5 /* content fraction under the pinch midpoint */
  let pinchCy = 0.5
  let lastTapT = 0
  let lastTapX = 0
  let lastTapY = 0

  function startPinch(e: TouchEvent) {
    const a = e.touches[0]
    const b = e.touches[1]
    const tr = trackEl?.getBoundingClientRect()
    if (!tr || !a || !b) return
    pinchD0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    if (!pinchD0) return
    const img = curImgEl
    if (!img) return
    const ir = img.getBoundingClientRect() /* includes any current transform */
    const mx = (a.clientX + b.clientX) / 2 - tr.left
    const my = (a.clientY + b.clientY) / 2 - tr.top
    pinchCx = (mx - (ir.left - tr.left)) / ir.width
    pinchCy = (my - (ir.top - tr.top)) / ir.height
    pinchScale0 = scale
    pinchRaw = scale
    zoomAnim = false
    dragPx = 0 /* a second finger mid-swipe cancels the swipe */
    mode = 'pinch'
  }

  function noteTap(e: TouchEvent) {
    const t = e.changedTouches[0]
    if (!t) return
    if (!(e.target as HTMLElement)?.closest?.('.lb-media img')) return
    const now = performance.now()
    if (now - lastTapT < 300 && Math.hypot(t.clientX - lastTapX, t.clientY - lastTapY) < 30) {
      lastTapT = 0
      /* fit → 2× fit (capped at natural), zoomed → back to fit; the tapped
         point centers, edge-flush when it can't */
      if (scale > 1) animateZoom(zoomOut)
      else if (shrunk) {
        const tr = trackEl?.getBoundingClientRect()
        const ir = curImgEl?.getBoundingClientRect()
        if (!tr || !ir) return
        animateZoom(() =>
          zoomAt((t.clientX - ir.left) / ir.width, (t.clientY - ir.top) / ir.height, Math.min(2, sNat)),
        )
      }
      return
    }
    lastTapT = now
    lastTapX = t.clientX
    lastTapY = t.clientY
  }

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
    /* second finger down: pinch (unless the first touch owns a caption
       scroll); a swipe in flight is cancelled by startPinch */
    if (mode !== 'y' && e.touches.length >= 2 && nat.w > 0) {
      startPinch(e)
      return
    }
    startX = e.touches[0].clientX
    startY = e.touches[0].clientY
    lastX = startX
    lastT = performance.now()
    vel = 0
    tapMoved = 0
    if (scale > 1) {
      /* zoomed: one finger on the image pans, everything else is dead —
         slides change only when fit */
      if ((e.target as HTMLElement)?.closest('.lb-media img')) {
        mode = 'pan'
        panZx0 = zx
        panZy0 = zy
      } else {
        mode = 'y'
      }
      return
    }
    mode = ''
  }
  function onTouchMove(e: TouchEvent) {
    if (settling || mode === 'y') return
    if (mode === 'pinch') {
      if (e.touches.length < 2) return
      const a = e.touches[0]
      const b = e.touches[1]
      const tr = trackEl?.getBoundingClientRect()
      if (!tr || !pinchD0) return
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      pinchRaw = pinchScale0 * (d / pinchD0)
      /* elastic below fit and past the ceiling — settles on release */
      scale =
        pinchRaw < 1 ? 1 - (1 - pinchRaw) * 0.3 : pinchRaw > sMax ? sMax + (pinchRaw - sMax) * 0.3 : pinchRaw
      /* keep the pinch midpoint's content under the (moving) midpoint */
      const mx = (a.clientX + b.clientX) / 2 - tr.left
      const my = (a.clientY + b.clientY) / 2 - tr.top
      zx = clampZ(mx - pinchCx * dw, dw, bodyW)
      zy = clampZ(my - pinchCy * dh, dh, bodyH)
      return
    }
    if (mode === 'pan') {
      const t = e.touches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      tapMoved = Math.max(tapMoved, Math.hypot(dx, dy))
      zx = clampZ(panZx0 + dx, dw, bodyW)
      zy = clampZ(panZy0 + dy, dh, bodyH)
      return
    }
    const t = e.touches[0]
    const dx = t.clientX - startX
    const dy = t.clientY - startY
    tapMoved = Math.max(tapMoved, Math.hypot(dx, dy))
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
  function onTouchEnd(e: TouchEvent) {
    if (mode === 'pinch') {
      if (e.touches.length === 1) {
        /* one finger left: the pinch ends here (browsers lift fingers one
           touchend at a time, so this fires even for a two-finger release)
           — settle the elastic scale, then the finger pans at that scale */
        const t = e.touches[0]
        startX = t.clientX
        startY = t.clientY
        tapMoved = 99 /* the remaining finger is not a tap */
        const settled = Math.min(Math.max(pinchRaw, 1), sMax)
        animateZoom(() => {
          if (settled <= 1) zoomOut()
          else {
            scale = settled
            zx = clampZ(zx, dw, bodyW)
            zy = clampZ(zy, dh, bodyH)
          }
        })
        panZx0 = zx
        panZy0 = zy
        mode = 'pan'
        return
      }
      if (e.touches.length === 0) {
        mode = ''
        if (pinchRaw < 1) {
          animateZoom(zoomOut) /* pinched past fit — snap back */
          return
        }
        /* settle the elastic overshoot above the ceiling, re-clamp the pan
           for the settled scale */
        animateZoom(() => {
          scale = Math.min(Math.max(pinchRaw, 1), sMax)
          zx = clampZ(zx, dw, bodyW)
          zy = clampZ(zy, dh, bodyH)
        })
      }
      return /* 3+ fingers — wait for the count to settle */
    }
    if (mode === 'pan') {
      mode = ''
      if (tapMoved < 10) noteTap(e)
      return
    }
    if (mode !== 'x' || settling) {
      if (mode === '' && !settling && tapMoved < 10) noteTap(e)
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
     clicking it zooms to 100% centered on the clicked point. While zoomed
     the cursor is grab and dragging pans freely; a release that moved <5px
     is a click and zooms back out to fit. One zoom model, three inputs:
     mouse click = jump to 100% natural, double-tap = 2× fit, pinch =
     continuous between fit and min(4× fit, natural) with the midpoint's
     content pinned. Scale 1 = fitted; while zoomed one finger pans and
     swiping navigates only when fit (zoom-out-first). Arrow keys still
     step slides while zoomed (the new slide opens fitted). */
  let scale = $state(1) /* 1 = fitted; >1 = zoomed; pinch may dip <1 (elastic) */
  let zx = $state(0) /* zoomed image top-left, box-relative px */
  let zy = $state(0)
  let dragging = $state(false)
  let downX = 0
  let downY = 0
  let downZx = 0
  let downZy = 0
  let moved = 0
  let bodyH = $state(0)
  let trackEl = $state<HTMLElement>()
  let curImgEl = $state<HTMLImageElement>()

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
  const fitScale = $derived(nat.w > 0 ? Math.min(bodyW / nat.w, bodyH / nat.h, 1) : 1)
  const fitW = $derived(nat.w * fitScale)
  const fitH = $derived(nat.h * fitScale)
  const sNat = $derived(fitW > 0 ? nat.w / fitW : 1) /* 100% natural, in fit units */
  const shrunk = $derived(sNat > 1)
  const sMax = $derived(Math.min(4, sNat)) /* pinch ceiling: 4× fit, never past natural */
  const dw = $derived(fitW * scale)
  const dh = $derived(fitH * scale)

  /* coverage clamp: an axis the image fills keeps its edges flush with the
     box (pan range [box-d, 0]); a narrower axis is centered. Clamped at
     write time so reversing a drag doesn't eat distance against the limit. */
  function clampZ(v: number, d: number, box: number) {
    return d > box ? Math.min(Math.max(v, box - d), 0) : (box - d) / 2
  }
  const zxView = $derived(clampZ(zx, dw, bodyW))
  const zyView = $derived(clampZ(zy, dh, bodyH))
  /* the img keeps its fitted layout; zoom is transform-only (compositor, no
     layout per pinch frame): translate so zxView/zyView land as top-left
     after scaling about the (always box-centered) layout center */
  const tx = $derived(zxView - (bodyW - dw) / 2)
  const ty = $derived(zyView - (bodyH - dh) / 2)
  /* zoom-initiated changes (double-tap, pinch release snap) animate; the
     pinching/panning itself tracks the finger with no transition */
  let zoomAnim = $state(false)
  let zoomAnimTimer: ReturnType<typeof setTimeout> | undefined
  function animateZoom(fn: () => void) {
    zoomAnim = true
    fn()
    clearTimeout(zoomAnimTimer)
    zoomAnimTimer = setTimeout(() => (zoomAnim = false), 260)
  }

  /* shared zoom-in: put content fraction (fx, fy) of the image at the box
     center (a point near an edge can't be centered — not enough content
     beyond it — so the view settles with that edge flush instead) */
  function zoomAt(fx: number, fy: number, target: number) {
    const w = fitW * target
    const h = fitH * target
    zx = clampZ(bodyW / 2 - fx * w, w, bodyW)
    zy = clampZ(bodyH / 2 - fy * h, h, bodyH)
    scale = target
  }
  function zoomOut() {
    scale = 1
    zx = 0
    zy = 0
  }

  /* any slide change (or close) returns to the fitted view */
  $effect(() => {
    void lightbox.i
    void lightbox.open
    scale = 1
    zx = 0
    zy = 0
  })

  function zoomDown(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    dragging = true
    moved = 0
    downX = e.clientX
    downY = e.clientY
    downZx = zx
    downZy = zy
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function zoomMove(e: PointerEvent) {
    if (!dragging) return
    const dx = e.clientX - downX
    const dy = e.clientY - downY
    moved = Math.max(moved, Math.hypot(dx, dy))
    if (scale > 1) {
      zx = clampZ(downZx + dx, dw, bodyW)
      zy = clampZ(downZy + dy, dh, bodyH)
    }
  }
  function zoomUp(e: PointerEvent) {
    if (!dragging) return
    dragging = false
    if (moved >= 5) return /* a pan, not a click — keep the zoom */
    const img = e.currentTarget as HTMLImageElement
    if (scale > 1) {
      zoomOut()
      return
    }
    if (!shrunk || !img.naturalWidth) return
    const r = img.getBoundingClientRect()
    zoomAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, sNat)
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
  use:noPageZoom
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
      <div class="lb-track" bind:this={trackEl} bind:clientWidth={bodyW} bind:clientHeight={bodyH} class:settle={settling} style:transform={`translateX(${dragPx}px)`}>
        {#each slides as s (s.it.id)}
          <div class="lb-media" style:transform={`translateX(${(s.k - lightbox.i) * 100}%)`}>
            {#if s.k === lightbox.i}
              {#if s.it.type === 'picture'}
                <img
                  bind:this={curImgEl}
                  src={s.it.file ?? s.it.thumb ?? ''}
                  alt=""
                  draggable="false"
                  onload={noteImg}
                  class:zoomable={scale <= 1 && shrunk}
                  class:zoomed={scale > 1}
                  class:panning={scale > 1 && dragging}
                  class:zanim={zoomAnim}
                  style:transform={scale !== 1 ? `translate(${tx}px, ${ty}px) scale(${scale})` : null}
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
