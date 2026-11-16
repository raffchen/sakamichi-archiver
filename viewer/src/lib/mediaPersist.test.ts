import { beforeEach, describe, expect, it, vi } from 'vitest'

/* The position map is module-level state; re-import it fresh for every test
   so tests can't leak positions into each other (same pattern as store.test). */
let mp: typeof import('./mediaPersist')

beforeEach(async () => {
  vi.resetModules()
  mp = await import('./mediaPersist')
  localStorage.clear()
})

describe('mediaPersist', () => {
  it('volume defaults to 100% unmuted with nothing stored', () => {
    expect(mp.loadVolume()).toEqual({ vol: 1, muted: false })
  })

  it('round-trips volume + mute', () => {
    mp.saveVolume(0.42, true)
    expect(mp.loadVolume()).toEqual({ vol: 0.42, muted: true })
  })

  it('clamps corrupt volume values into range', () => {
    localStorage.setItem('sakamichi-viewer:volume', JSON.stringify({ v: 7, m: false }))
    expect(mp.loadVolume().vol).toBe(1)
    localStorage.setItem('sakamichi-viewer:volume', 'not json')
    expect(mp.loadVolume()).toEqual({ vol: 1, muted: false })
  })

  it('positions round-trip per message id and default to 0', () => {
    expect(mp.loadPosition(101)).toBe(0)
    mp.savePosition(101, 12.34)
    expect(mp.loadPosition(101)).toBeCloseTo(12.3) // stored to 0.1s precision
    mp.savePosition(102, 3)
    expect(mp.loadPosition(101)).toBeCloseTo(12.3)
    expect(mp.loadPosition(102)).toBe(3)
  })

  it('clearPosition removes a single entry', () => {
    mp.savePosition(101, 5)
    mp.savePosition(102, 6)
    mp.clearPosition(101)
    expect(mp.loadPosition(101)).toBe(0)
    expect(mp.loadPosition(102)).toBe(6)
  })

  it('positions are session-scoped — never written to localStorage', () => {
    mp.savePosition(101, 9)
    expect(localStorage.getItem('sakamichi-viewer:positions')).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  it('volume lives in localStorage while positions do not', () => {
    mp.saveVolume(0.5, false)
    mp.savePosition(101, 9)
    expect(localStorage.getItem('sakamichi-viewer:volume')).not.toBeNull()
    expect(localStorage.getItem('sakamichi-viewer:positions')).toBeNull()
  })
})
