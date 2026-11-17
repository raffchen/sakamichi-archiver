/* Desktop UX: the app renders as a centered phone-width column, so the areas
   left and right of it belong to <body>, which never scrolls — the wheel feels
   dead wherever the mouse isn't inside the column. Forward those stray wheel
   events to the active .screen so scrolling works anywhere over the window.

   We only forward when nothing else should own the event: an ancestor that is
   genuinely scrollable (the screen itself, thread scrollers, overlay lists)
   handles it natively, and anything inside a fixed overlay (lightbox, info /
   login sheets) is never forwarded to the screen underneath. */

export function forwardWheel(e: { target: EventTarget | null; deltaY: number; deltaX: number }): HTMLElement | null {
  if (!e.deltaY && !e.deltaX) return null
  let el = e.target as Element | null
  while (el && el !== document.body) {
    if (!(el instanceof Element)) break
    const cs = getComputedStyle(el)
    if (cs.position === 'fixed') return null // overlay — not the screen's business
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1)
      return null // a real scroller owns this wheel natively
    el = el.parentElement
  }
  const screen = document.querySelector<HTMLElement>('.phone .screen')
  return screen && screen.scrollHeight > screen.clientHeight + 1 ? screen : null
}

/** listen for stray wheel events and scroll the active screen; returns cleanup */
export function attachGlobalScroll(): () => void {
  const onWheel = (e: WheelEvent) => {
    const target = forwardWheel(e)
    if (target) target.scrollBy(e.deltaX, e.deltaY)
  }
  window.addEventListener('wheel', onWheel, { passive: true })
  return () => window.removeEventListener('wheel', onWheel)
}
