import { beforeEach, describe, expect, it, vi } from 'vitest'

/* the auth store is a module-level singleton; re-import it fresh per test
   (same pattern as store.test.ts) */
let mod: typeof import('./auth.svelte')
let auth: (typeof import('./auth.svelte'))['auth'] // the $state proxy

beforeEach(async () => {
  vi.resetModules()
  vi.restoreAllMocks()
  mod = await import('./auth.svelte')
  auth = mod.auth
})

describe('checkAuth', () => {
  it('marks the gate required+locked when the server says so', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ required: true, authed: false }), { status: 200 })),
    )
    await mod.checkAuth()
    expect(auth.required).toBe(true)
    expect(auth.authed).toBe(false)
    expect(auth.checked).toBe(true)
  })

  it('stays open (no gate) when the server has no VIEWER_PASSWORD', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ required: false, authed: true }), { status: 200 })),
    )
    await mod.checkAuth()
    expect(auth.required).toBe(false)
    expect(auth.authed).toBe(true)
  })

  it('treats a missing endpoint (vite dev) as no gate', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))
    await mod.checkAuth()
    expect(auth.required).toBe(false)
  })
})

describe('requireLogin', () => {
  it('opens the login screen only when gated and not yet authed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ required: true, authed: false }), { status: 200 })),
    )
    await mod.checkAuth()
    mod.requireLogin()
    expect(auth.open).toBe(true)

    auth.open = false
    auth.authed = true
    mod.requireLogin()
    expect(auth.open).toBe(false)

    auth.authed = false
    auth.required = false // gate off (dev) — fetches never need to prompt
    mod.requireLogin()
    expect(auth.open).toBe(false)
  })
})

describe('login', () => {
  it('reloads the page on success', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    )
    expect(await mod.login('good')).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('surfaces the error text on a wrong password', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'wrong password' }), { status: 401 })),
    )
    expect(await mod.login('bad')).toBe(false)
    expect(auth.error).toContain('wrong password')
  })

  it('shows the throttle message on 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })))
    expect(await mod.login('x')).toBe(false)
    expect(auth.error).toContain('too many attempts')
  })
})
