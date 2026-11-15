import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clickOutside, keynav, sentinel } from './actions'

/* Svelte's ActionReturn is `void | { update?, destroy? }`; tests always want
   the object half. */
const ret = (r: unknown): { update?: (params: any) => void; destroy?: () => void } =>
  (r ?? {}) as any

let IO: any // the stubbed IntersectionObserver class

beforeEach(() => {
  /* sentinel() needs an IntersectionObserver; happy-dom doesn't ship one. */
  class IOStub {
    static instances: IOStub[] = []
    cb: (entries: { isIntersecting: boolean }[]) => void
    rootMargin: string
    observed: Element[] = []
    disconnected = false
    constructor(cb: IOStub['cb'], opts?: { rootMargin?: string }) {
      this.cb = cb
      this.rootMargin = opts?.rootMargin ?? ''
      IOStub.instances.push(this)
    }
    observe(el: Element) {
      this.observed.push(el)
    }
    disconnect() {
      this.disconnected = true
    }
  }
  vi.stubGlobal('IntersectionObserver', IOStub)
  IO = IOStub
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sentinel', () => {
  it('observes the node with a 400px root margin and fires onLoad on intersect', () => {
    const node = document.createElement('div')
    const onLoad = vi.fn()
    sentinel(node, { onLoad })

    expect(IO.instances).toHaveLength(1)
    const io = IO.instances[0]
    expect(io.rootMargin).toBe('400px 0px')
    expect(io.observed).toEqual([node])

    io.cb([{ isIntersecting: true }])
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('ignores non-intersecting entries', () => {
    const node = document.createElement('div')
    const onLoad = vi.fn()
    sentinel(node, { onLoad })
    ;(IO.instances[0] as any).cb([{ isIntersecting: false }])
    expect(onLoad).not.toHaveBeenCalled()
  })

  it('respects enabled: false, and update() re-enables', () => {
    const node = document.createElement('div')
    const onLoad = vi.fn()
    const action = ret(sentinel(node, { onLoad, enabled: false }))
    const io = IO.instances[0]

    io.cb([{ isIntersecting: true }])
    expect(onLoad).not.toHaveBeenCalled()

    action.update!({ onLoad, enabled: true })
    io.cb([{ isIntersecting: true }])
    expect(onLoad).toHaveBeenCalledTimes(1)
  })

  it('disconnects on destroy', () => {
    const node = document.createElement('div')
    const action = ret(sentinel(node, { onLoad: vi.fn() }))
    action.destroy?.()
    expect(IO.instances[0].disconnected).toBe(true)
  })
})

describe('clickOutside', () => {
  it('fires onOutside for a pointerdown outside the node, not inside', async () => {
    const node = document.createElement('div')
    const inside = document.createElement('span')
    node.appendChild(inside)
    document.body.appendChild(node)
    const onOutside = vi.fn()
    clickOutside(node, onOutside)

    // registration is deferred one tick so the opening pointerdown can't
    // immediately close the menu
    await new Promise((r) => setTimeout(r, 0))

    // listener sits on document: dispatch outside directly on document...
    document.dispatchEvent(new Event('pointerdown'))
    expect(onOutside).toHaveBeenCalledTimes(1)

    // ...and inside on the node (bubbling up to document with target = node)
    node.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(onOutside).toHaveBeenCalledTimes(1) // inside — not fired
  })

  it('stops firing after destroy', async () => {
    const node = document.createElement('div')
    const onOutside = vi.fn()
    const action = ret(clickOutside(node, onOutside))
    await new Promise((r) => setTimeout(r, 0))
    action.destroy?.()
    document.dispatchEvent(new Event('pointerdown'))
    expect(onOutside).not.toHaveBeenCalled()
  })

  it('update() swaps the callback', async () => {
    const node = document.createElement('div')
    const first = vi.fn()
    const second = vi.fn()
    const action = ret(clickOutside(node, first))
    await new Promise((r) => setTimeout(r, 0))
    action.update!(second)
    document.dispatchEvent(new Event('pointerdown'))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('keynav', () => {
  type Handlers = { onLeft?: () => void; onRight?: () => void; onEsc?: () => void }

  const press = (key: string) => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true })
    const spy = vi.spyOn(ev, 'preventDefault')
    window.dispatchEvent(ev)
    return spy
  }

  /* keynav adds a window listener that survives the test unless destroyed —
     leaked listeners from earlier tests would preventDefault the same event */
  const actions: { update?: (p: any) => void; destroy?: () => void }[] = []
  afterEach(() => actions.forEach((a) => a.destroy?.()))

  it('maps Escape and the arrows to their handlers and preventDefaults', () => {
    const h: Handlers = { onEsc: vi.fn(), onLeft: vi.fn(), onRight: vi.fn() }
    actions.push(ret(keynav(document.createElement('div'), h)))

    expect(press('Escape').mock.calls).toHaveLength(1)
    expect(h.onEsc).toHaveBeenCalledTimes(1)
    expect(press('ArrowLeft')).toHaveBeenCalled()
    expect(h.onLeft).toHaveBeenCalledTimes(1)
    expect(press('ArrowRight')).toHaveBeenCalled()
    expect(h.onRight).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys entirely', () => {
    const h: Handlers = { onEsc: vi.fn() }
    actions.push(ret(keynav(document.createElement('div'), h)))
    expect(press('Enter')).not.toHaveBeenCalled()
    expect(h.onEsc).not.toHaveBeenCalled()
  })

  it('update() swaps handlers and destroy() removes the window listener', () => {
    const a: Handlers = { onEsc: vi.fn() }
    const b: Handlers = { onEsc: vi.fn() }
    const action = ret(keynav(document.createElement('div'), a))
    action.update!(b)
    expect(press('Escape').mock.calls).toHaveLength(1)
    expect(b.onEsc).toHaveBeenCalledTimes(1)
    expect(a.onEsc).not.toHaveBeenCalled()

    action.destroy?.()
    press('Escape')
    expect(b.onEsc).toHaveBeenCalledTimes(1) // no further calls
  })
})
