import { beforeEach, describe, expect, it } from 'vitest'

import { loadVolume, saveVolume, loadPosition, savePosition, clearPosition } from './mediaPersist'

describe('mediaPersist', () => {
  beforeEach(() => localStorage.clear())

  it('volume defaults to 100% unmuted with nothing stored', () => {
    expect(loadVolume()).toEqual({ vol: 1, muted: false })
  })

  it('round-trips volume + mute', () => {
    saveVolume(0.42, true)
    expect(loadVolume()).toEqual({ vol: 0.42, muted: true })
  })

  it('clamps corrupt volume values into range', () => {
    localStorage.setItem('sakamichi-viewer:volume', JSON.stringify({ v: 7, m: false }))
    expect(loadVolume().vol).toBe(1)
    localStorage.setItem('sakamichi-viewer:volume', 'not json')
    expect(loadVolume()).toEqual({ vol: 1, muted: false })
  })

  it('positions round-trip per message id and default to 0', () => {
    expect(loadPosition(101)).toBe(0)
    savePosition(101, 12.34)
    expect(loadPosition(101)).toBeCloseTo(12.3) // stored to 0.1s precision
    savePosition(102, 3)
    expect(loadPosition(101)).toBeCloseTo(12.3)
    expect(loadPosition(102)).toBe(3)
  })

  it('clearPosition removes a single entry', () => {
    savePosition(101, 5)
    savePosition(102, 6)
    clearPosition(101)
    expect(loadPosition(101)).toBe(0)
    expect(loadPosition(102)).toBe(6)
  })

  it('caps the position map and drops the oldest entries', () => {
    for (let i = 0; i < 55; i++) savePosition(i, i)
    expect(loadPosition(0)).toBe(0) // evicted (oldest)
    expect(loadPosition(54)).toBe(54) // newest survives
    const stored = JSON.parse(localStorage.getItem('sakamichi-viewer:positions') ?? '{}')
    expect(Object.keys(stored).length).toBe(50)
  })
})
