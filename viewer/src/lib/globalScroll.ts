/* Desktop UX: the app renders as a centered phone-width column, so the areas
   left and right of it belong to <body>, which never scrolls — the wheel feels
   dead wherever the mouse isn't inside the column, and middle-click autoscroll
   has no scrollable ancestor to drive. Forward stray wheel events to the
   active .screen, and run our own autoscroll when middle-clicking dead space.

   We only take over when nothing else should own the event: an ancestor that
   is genuinely scrollable (the screen itself, thread scrollers, overlay lists)
   handles everything natively, and anything inside a fixed overlay (lightbox,
   sheets) is never hijacked to scroll the screen underneath. */

const DEAD_ZONE = 4 // px around the anchor where autoscroll doesn't move
const SPEED = 6 // autoscroll px/s per px of mouse displacement

/** who should natively own scrolling for a pointer at this target:
    'native' = a scrollable ancestor or a fixed overlay (don't interfere),
    'dead' = nothing scrolls here — hand it to the active screen */
export function scrollOwner(target: EventTarget | null): 'native' | 'dead' {
  let el = target as Element | null
  while (el && el !== document.body) {
    if (!(el instanceof Element)) break
    const cs = getComputedStyle(el)
    if (cs.position === 'fixed') return 'native'
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1)
      return 'native'
    el = el.parentElement
  }
  return 'dead'
}

export function forwardWheel(e: { target: EventTarget | null; deltaY: number; deltaX: number }): HTMLElement | null {
  if (!e.deltaY && !e.deltaX) return null
  if (scrollOwner(e.target) === 'native') return null
  const screen = document.querySelector<HTMLElement>('.phone .screen')
  return screen && screen.scrollHeight > screen.clientHeight + 1 ? screen : null
}

/** our own middle-click autoscroll for dead space (Windows-style: click to
    anchor, move the mouse to scroll, click again / Esc to stop). Native
    autoscroll can't be pointed at the .screen from outside the column, so we
    drive it with a rAF loop instead. */
export function attachGlobalScroll(): () => void {
  let state: {
    anchorX: number
    anchorY: number
    curX: number
    curY: number
    last: number
    raf: number
  } | null = null

  const stop = () => {
    if (!state) return
    cancelAnimationFrame(state.raf)
    document.body.classList.remove('autoscroll')
    state = null
  }

  const tick = (t: number) => {
    if (!state) return
    const dt = state.last ? Math.min(t - state.last, 100) : 16
    state.last = t
    const screen = document.querySelector<HTMLElement>('.phone .screen')
    if (!screen || screen.scrollHeight <= screen.clientHeight + 1) {
      state.raf = requestAnimationFrame(tick)
      return
    }
    // CSS zoom on .phone makes its scrollTop units smaller than viewport px
    const zoom = parseFloat(getComputedStyle(document.querySelector<HTMLElement>('.phone')!).zoom) || 1
    const dy = state.curY - state.anchorY
    const dx = state.curX - state.anchorX
    const vy = Math.abs(dy) <= DEAD_ZONE ? 0 : (dy - Math.sign(dy) * DEAD_ZONE) * SPEED
    const vx = Math.abs(dx) <= DEAD_ZONE ? 0 : (dx - Math.sign(dx) * DEAD_ZONE) * SPEED
    if (vx || vy) screen.scrollBy(vx * (dt / 1000) / zoom, vy * (dt / 1000) / zoom)
    state.raf = requestAnimationFrame(tick)
  }

  const onMouseDown = (e: MouseEvent) => {
    if (state) {
      stop() // any click ends the mode, like native autoscroll
      if (e.button === 1) e.preventDefault()
      return
    }
    if (e.button !== 1) return
    if ((e.target as Element | null)?.closest?.('a')) return // middle-click = open in new tab
    if (scrollOwner(e.target) === 'native') return // native autoscroll handles it
    e.preventDefault() // suppress native autoscroll — it has nothing to scroll here
    state = { anchorX: e.clientX, anchorY: e.clientY, curX: e.clientX, curY: e.clientY, last: 0, raf: 0 }
    document.body.classList.add('autoscroll')
    state.raf = requestAnimationFrame(tick)
  }

  const onMouseMove = (e: MouseEvent) => {
    if (!state) return
    state.curX = e.clientX
    state.curY = e.clientY
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') stop()
  }

  const onWheel = (e: WheelEvent) => {
    const target = forwardWheel(e)
    if (target) target.scrollBy(e.deltaX, e.deltaY)
  }
  window.addEventListener('wheel', onWheel, { passive: true })
  window.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('keydown', onKey)
  window.addEventListener('blur', stop)

  return () => {
    stop()
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('mousedown', onMouseDown)
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('blur', stop)
  }
}
