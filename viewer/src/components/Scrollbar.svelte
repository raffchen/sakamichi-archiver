<script lang="ts">
  /* Custom overlay scrollbar that hugs the phone column's right edge.
     The .screen scroll plane spans the whole window, so its native scrollbar
     sits at the screen edge — this component replaces it with a rail anchored
     to the column. The native scroller stays in charge of all scrolling
     (wheel, touch, keyboard, autoscroll); this only mirrors and drives it.
     Rendered inside .col: a sticky wrapper pins the rail to the visible
     screen area while the column scrolls underneath it. */
  import { onMount } from 'svelte'

  let host = $state<HTMLElement | null>(null) // sticky wrapper (inside .col)
  let screen = $state<HTMLElement | null>(null) // the .screen scroll plane

  let has = $state(false) // content overflows
  let visible = $state(false) // thumb currently shown
  let dragging = $state(false)
  let thumbH = $state(0)
  let thumbTop = $state(0)
  let railH = $state(0) // visible screen height, in layout px
  let padR = $state(0) // column's own padding-right, in layout px

  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let ro: ResizeObserver | undefined
  let hovering = false
  /* touch devices keep the rail up permanently: a 1.1s fade hides it before
     the user can aim at the thumb, and their grab then lands on the content
     as a pan — the rail flashes on but the thumb never follows the finger */
  const coarse = matchMedia('(hover: none), (pointer: coarse)').matches

  function measure() {
    if (!screen) return
    const ch = screen.clientHeight
    const sh = screen.scrollHeight
    railH = ch
    has = sh > ch + 1
    if (!has) return
    thumbH = Math.max(48, (ch / sh) * ch)
    const maxScroll = sh - ch
    thumbTop = maxScroll > 0 ? (screen.scrollTop / maxScroll) * (ch - thumbH) : 0
  }

  function flash() {
    visible = true
    if (coarse) return // touch: no auto-hide, the rail stays grabbable
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (!dragging && !hovering) visible = false
    }, 1100)
  }

  /* .phone applies CSS zoom; pointer deltas are viewport px while the
     scroller's geometry is layout px — convert via the rendered scale */
  function layoutZoom() {
    if (!screen) return 1
    const r = screen.getBoundingClientRect()
    return r.height > 0 ? r.height / screen.clientHeight : 1
  }

  /* --- thumb / track interaction --- */
  let startY = 0
  let startScroll = 0
  let activePointer = -1
  let thumbEl: HTMLElement | null = null
  let dragEl: HTMLElement | null = null

  /* Move/end handling lives on window for the duration of the drag, not on
     the thumb: pointer capture is best-effort, and browsers that don't
     retarget touch pointers to the thumb would otherwise stop delivering
     moves the moment the finger leaves the 5px thumb. */
  function onDragMove(e: PointerEvent) {
    if (!dragging || !screen || e.pointerId !== activePointer) return
    const ch = screen.clientHeight
    const maxScroll = screen.scrollHeight - ch
    const track = ch - thumbH
    if (track <= 0) return
    const d = ((e.clientY - startY) / layoutZoom()) * (maxScroll / track)
    screen.scrollTop = Math.min(Math.max(startScroll + d, 0), maxScroll)
  }

  function onDragEnd(e: PointerEvent) {
    if (!dragging || e.pointerId !== activePointer) return
    dragging = false
    activePointer = -1
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
    window.removeEventListener('pointercancel', onDragEnd)
    try {
      dragEl?.releasePointerCapture(e.pointerId)
    } catch {}
    dragEl = null
    flash()
  }

  /* shared by thumb grab and track click-drag; also fixes the track path
     ending its drag properly (it used to leave `dragging` set forever) */
  function beginDrag(e: PointerEvent, el: HTMLElement) {
    if (!screen || dragging) return // a second pointer must not re-anchor the drag
    e.preventDefault() // no text selection while dragging
    dragging = true
    activePointer = e.pointerId
    dragEl = el
    startY = e.clientY
    startScroll = screen.scrollTop
    try {
      el.setPointerCapture(e.pointerId)
    } catch {}
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragEnd)
    window.addEventListener('pointercancel', onDragEnd)
    flash()
  }

  function thumbDown(e: PointerEvent) {
    beginDrag(e, e.currentTarget as HTMLElement)
  }

  /* Mobile Firefox: Gecko's APZ resolves touch-action from its own
     compositor-side hit-testing and can claim a drag that starts on the
     thumb (or its hit-area) as a pan — firing pointercancel and killing the
     drag even though touch-action: none is set. Claiming the gesture at the
     touch level too (non-passive preventDefault) guarantees no native pan
     ever starts from the thumb. Pointer events fire before the touch
     events, so the drag is already armed when these run. */
  function onTouchStart(e: TouchEvent) {
    e.preventDefault()
  }
  function onTouchMove(e: TouchEvent) {
    e.preventDefault()
  }

  /* track click → jump so the thumb centers on the click, then keep
     dragging from there (so a click-drag never jumps back) */
  function trackDown(e: PointerEvent) {
    if (!screen || !host) return
    if ((e.target as HTMLElement).closest('.sb-thumb')) return // thumb handles it
    e.preventDefault()
    const r = host.getBoundingClientRect()
    const y = (e.clientY - r.top) / layoutZoom()
    const ch = screen.clientHeight
    const maxScroll = screen.scrollHeight - ch
    const track = ch - thumbH
    if (track <= 0) return
    screen.scrollTop = Math.min(Math.max(((y - thumbH / 2) / track) * maxScroll, 0), maxScroll)
    beginDrag(e, e.currentTarget as HTMLElement)
  }

  onMount(() => {
    screen = host?.closest('.screen') ?? null
    if (!screen) return
    /* some screens put the padding on .col itself (blog member/directory);
       the sticky wrapper then spans the content box, so the rail must shift
       out by that padding to reach the column's true edge */
    const col = host?.closest('.col')
    if (col) padR = parseFloat(getComputedStyle(col).paddingRight) || 0
    screen.addEventListener('scroll', onScroll, { passive: true })
    /* the column's height changes as images load and content streams in;
       the screen's own height changes on window resize / zoom */
    ro = new ResizeObserver(measure)
    ro.observe(screen)
    ro.observe(screen.firstElementChild as HTMLElement)
    /* the thumb is the drag surface: claim touches at the touch level too
       (see onTouchStart) — these must be non-passive to reach preventDefault */
    thumbEl?.addEventListener('touchstart', onTouchStart, { passive: false })
    thumbEl?.addEventListener('touchmove', onTouchMove, { passive: false })
    measure()
    flash() // show once on arrival so the custom rail is discoverable
    return () => {
      thumbEl?.removeEventListener('touchstart', onTouchStart)
      thumbEl?.removeEventListener('touchmove', onTouchMove)
      screen!.removeEventListener('scroll', onScroll)
      ro!.disconnect()
      if (hideTimer) clearTimeout(hideTimer)
    }
  })

  function onScroll() {
    measure()
    flash()
  }
</script>

  <!-- decorative: the native scroller remains the accessible surface -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="sb" class:on={has && visible} class:drag={dragging} bind:this={host} aria-hidden="true">
    <div
      class="sb-rail"
      style="height: {railH}px; right: -{padR}px"
      onpointerdown={trackDown}
      onpointerenter={() => {
        hovering = true
        flash()
      }}
      onpointerleave={() => {
        hovering = false
        flash()
      }}
    >
      <div
        class="sb-thumb"
        style="height: {thumbH}px; transform: translateY({thumbTop}px)"
        onpointerdown={thumbDown}
        bind:this={thumbEl}
      >
        <div class="sb-hit"></div>
      </div>
    </div>
  </div>

<style>
  /* sticky wrapper: height 0, pins the rail to the scrollport's top edge
     while the column scrolls; the rail (screen-height tall) hangs below it */
  .sb {
    position: sticky;
    top: 0;
    height: 0;
    z-index: 20; /* over content, under menus/popovers (30/31) and fixed overlays */
    user-select: none;
    -webkit-user-select: none;
  }
  .sb-rail {
    position: absolute;
    top: 0;
    right: 0;
    width: 14px;
    /* height set inline from .screen's clientHeight (layout px, so it scales
       with --app-zoom like everything else) */
    opacity: 0;
    transition: opacity 0.25s;
    /* touch: the track stays a pass-through indicator — only the thumb
       (below) is grabbable, so flicks near the edge still scroll normally */
    pointer-events: none;
    touch-action: none;
  }
  @media (hover: hover) {
    .sb-rail {
      pointer-events: auto;
    }
  }
  .sb.on .sb-rail {
    opacity: 1;
  }
  .sb-thumb {
    position: absolute;
    top: 0;
    right: 3px;
    width: 5px;
    border-radius: 4px;
    background: var(--sb-thumb);
    transition: width 0.15s, right 0.15s, background 0.15s;
    /* touch: the thumb is the drag surface. touch-action:none keeps the
       browser from turning the gesture into a scroll, so pointermove keeps
       firing and the drag drives scrollTop (pointer capture already routes
       moves outside the thumb back to it) */
    pointer-events: auto;
    touch-action: none;
  }
  /* an invisible thumb must not intercept flicks at its last position */
  .sb:not(.on) .sb-thumb {
    pointer-events: none;
  }
  /* invisible hit-area extension: fingers need ~40px targets and the thumb
     is 5px wide. It only extends outward and slightly vertically, so a
     flick on the content beside the rail still scrolls normally. A real
     element (not ::before) so every browser's hit-testing and touch-action
     resolution treat it identically. */
  .sb-hit {
    position: absolute;
    inset: -8px -10px -8px -6px;
    touch-action: none;
  }
  .sb-rail:hover .sb-thumb,
  .sb.drag .sb-thumb {
    width: 7px;
    right: 2px;
    background: var(--sb-thumb-strong);
  }
</style>
