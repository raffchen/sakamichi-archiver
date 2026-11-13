import type { Action } from 'svelte/action'

/** Calls onLoad when the element scrolls into view (load older messages). */
export const sentinel: Action<HTMLDivElement, { onLoad?: () => void; enabled?: boolean }> = (node, params) => {
  let opts = params ?? {}
  let io: IntersectionObserver | undefined

  const connect = () => {
    io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && opts.enabled !== false) opts.onLoad?.()
      },
      { rootMargin: '400px 0px' },
    )
    io.observe(node)
  }
  connect()

  return {
    update(next) {
      opts = next ?? {}
    },
    destroy() {
      io?.disconnect()
    },
  }
}

/** Global keyboard shortcuts (lightbox): ← → Esc. */
export const keynav: Action<HTMLElement, { onLeft?: () => void; onRight?: () => void; onEsc?: () => void }> = (
  _node,
  handlers,
) => {
  let h = handlers ?? {}
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') h.onEsc?.()
    else if (e.key === 'ArrowLeft') h.onLeft?.()
    else if (e.key === 'ArrowRight') h.onRight?.()
    else return
    e.preventDefault()
  }
  window.addEventListener('keydown', onKey)
  return {
    update(next) {
      h = next ?? {}
    },
    destroy() {
      window.removeEventListener('keydown', onKey)
    },
  }
}
