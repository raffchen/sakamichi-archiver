/* Persist playback state across reloads (localStorage).

   A reindex reload mid-video resets position and volume — annoying while a
   long sync is running. This module keeps the two worst symptoms alive across
   ANY reload (deploy, F5, lightbox remount):
     - volume/mute: global preference, applied to every voice/video element
     - position: per message id, resumed on the next play of that media

   Storage is best-effort: private mode / quota errors are swallowed, playback
   just starts fresh. Positions live in ONE capped key so the store can't grow
   unbounded (oldest entries drop off, insertion order). */

const VOL_KEY = 'sakamichi-viewer:volume'
const POS_KEY = 'sakamichi-viewer:positions'
const POS_MAX = 50

type Volume = { vol: number; muted: boolean }

export function loadVolume(): Volume {
  try {
    const j = JSON.parse(localStorage.getItem(VOL_KEY) ?? '{}')
    const vol = typeof j.v === 'number' ? Math.min(1, Math.max(0, j.v)) : 1
    return { vol, muted: !!j.m }
  } catch {
    return { vol: 1, muted: false }
  }
}

export function saveVolume(vol: number, muted: boolean) {
  try {
    localStorage.setItem(VOL_KEY, JSON.stringify({ v: vol, m: muted }))
  } catch {
    /* ignore */
  }
}

function readPositions(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/** Seconds, or 0 when nothing was saved for this media. */
export function loadPosition(id: number): number {
  const t = readPositions()[String(id)]
  return typeof t === 'number' ? t : 0
}

/** Caller throttles: save on pause/teardown and every few seconds at most. */
export function savePosition(id: number, seconds: number) {
  try {
    const j = readPositions()
    j[String(id)] = Math.round(seconds * 10) / 10
    const keys = Object.keys(j)
    if (keys.length > POS_MAX) {
      for (const k of keys.slice(0, keys.length - POS_MAX)) delete j[k]
    }
    localStorage.setItem(POS_KEY, JSON.stringify(j))
  } catch {
    /* ignore */
  }
}

/** Finished (or restarted from the top) — don't resume next time. */
export function clearPosition(id: number) {
  try {
    const j = readPositions()
    delete j[String(id)]
    localStorage.setItem(POS_KEY, JSON.stringify(j))
  } catch {
    /* ignore */
  }
}
