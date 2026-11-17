import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachGlobalScroll, forwardWheel, scrollOwner } from './globalScroll'

/* forwardWheel decides which element a wheel event should scroll: the active
   .screen when the pointer is over dead space (body background, header, tab
   bar), null when a real scroller or a fixed overlay owns the event. happy-dom
   computes inline styles, and scrollHeight/clientHeight are stubbed per test. */

let host: HTMLElement

const stubScroll = (el: Element, scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

const ev = (target: Element, dy = 120) => ({ target, deltaY: dy, deltaX: 0 }) as WheelEvent

beforeEach(() => {
  document.body.innerHTML = ''
  host = document.createElement('div')
  host.className = 'phone'
  const screen = document.createElement('div')
  screen.className = 'screen'
  host.appendChild(screen)
  document.body.appendChild(host)
  stubScroll(screen, 5000, 800) // content taller than the viewport by default
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('forwardWheel', () => {
  it('returns the active screen for wheel events over dead space', () => {
    // pointer over the body background outside the phone column
    expect(forwardWheel(ev(document.body))).toBe(host.querySelector('.screen'))
    // pointer over the phone header (inside .phone, outside .screen)
    const head = document.createElement('div')
    head.className = 'head'
    host.prepend(head)
    expect(forwardWheel(ev(head))).toBe(host.querySelector('.screen'))
  })

  it('returns null when the pointer is over a genuinely scrollable ancestor', () => {
    const screen = host.querySelector<HTMLElement>('.screen')!
    const inner = document.createElement('div')
    inner.style.overflowY = 'auto'
    screen.appendChild(inner)
    const leaf = document.createElement('span')
    inner.appendChild(leaf)
    stubScroll(inner, 4000, 300)
    expect(forwardWheel(ev(leaf))).toBe(null)
  })

  it('returns null for a scrollable-styled ancestor with no overflow', () => {
    const screen = host.querySelector<HTMLElement>('.screen')!
    const inner = document.createElement('div')
    inner.style.overflowY = 'auto'
    inner.appendChild(document.createElement('span'))
    screen.appendChild(inner)
    stubScroll(inner, 300, 300) // fits — nothing to scroll natively
    expect(forwardWheel(ev(inner.querySelector('span')!))).toBe(screen)
  })

  it('never scrolls the screen from inside a fixed overlay', () => {
    const lb = document.createElement('div')
    lb.style.position = 'fixed'
    document.body.appendChild(lb)
    const img = document.createElement('img')
    lb.appendChild(img)
    expect(forwardWheel(ev(img))).toBe(null)
  })

  it('returns null when the screen itself has nothing to scroll', () => {
    stubScroll(host.querySelector<HTMLElement>('.screen')!, 800, 800)
    expect(forwardWheel(ev(document.body))).toBe(null)
  })

  it('ignores zero-delta events', () => {
    expect(forwardWheel(ev(document.body, 0))).toBe(null)
  })
})

describe('scrollOwner', () => {
  it('classifies dead space vs native scrollers vs overlays', () => {
    expect(scrollOwner(document.body)).toBe('dead')
    const screen = host.querySelector<HTMLElement>('.screen')!
    screen.style.overflowY = 'auto'
    expect(scrollOwner(screen)).toBe('native')
    const overlay = document.createElement('div')
    overlay.style.position = 'fixed'
    document.body.appendChild(overlay)
    expect(scrollOwner(overlay)).toBe('native')
  })
})

describe('middle-click autoscroll mode', () => {
  const down = (target: EventTarget, button = 1) =>
    target.dispatchEvent(
      new MouseEvent('mousedown', { button, bubbles: true, cancelable: true }),
    )

  it('engages on middle-click over dead space, ends on the next click', () => {
    const detach = attachGlobalScroll()
    try {
      const md = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true })
      Object.defineProperty(md, 'clientX', { value: 100 })
      Object.defineProperty(md, 'clientY', { value: 200 })
      document.body.dispatchEvent(md)
      expect(document.body.classList.contains('autoscroll')).toBe(true)
      // any further click ends the mode
      document.body.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
      expect(document.body.classList.contains('autoscroll')).toBe(false)
    } finally {
      detach()
    }
  })

  it('stays out of the way over native scrollers, overlays and links', () => {
    const detach = attachGlobalScroll()
    try {
      const screen = host.querySelector<HTMLElement>('.screen')!
      screen.style.overflowY = 'auto'
      down(screen) // native autoscroll owns this
      expect(document.body.classList.contains('autoscroll')).toBe(false)

      const overlay = document.createElement('div')
      overlay.style.position = 'fixed'
      document.body.appendChild(overlay)
      down(overlay)
      expect(document.body.classList.contains('autoscroll')).toBe(false)

      const a = document.createElement('a')
      document.body.appendChild(a)
      down(a)
      expect(document.body.classList.contains('autoscroll')).toBe(false)
    } finally {
      detach()
    }
  })

  it('Escape ends the mode', () => {
    const detach = attachGlobalScroll()
    try {
      down(document.body)
      expect(document.body.classList.contains('autoscroll')).toBe(true)
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(document.body.classList.contains('autoscroll')).toBe(false)
    } finally {
      detach()
    }
  })

  it('left clicks never engage the mode', () => {
    const detach = attachGlobalScroll()
    try {
      down(document.body, 0)
      expect(document.body.classList.contains('autoscroll')).toBe(false)
    } finally {
      detach()
    }
  })
})
