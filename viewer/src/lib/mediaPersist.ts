/* Persist playback state across component remounts.

   Two different lifetimes on purpose:
     - volume/mute → localStorage: a device preference, survives reloads,
       deploys, F5 — every voice/video element picks it up
     - position → plain in-memory Map: session-scoped. Closing the lightbox or
       navigating away and coming back resumes the clip, but a page reload
       starts it from the top — resuming across a reset felt wrong, and
       localStorage would keep the position alive forever.

   Storage is best-effort: private mode / quota errors are swallowed, playback
   just starts fresh. */

const VOL_KEY = 'sakamichi-viewer:volume'

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

/* seconds; 0 when nothing was saved for this media */
const positions = new Map<number, number>()

export function loadPosition(id: number): number {
  return positions.get(id) ?? 0
}

/** Caller throttles: save on pause/teardown and every few seconds at most. */
export function savePosition(id: number, seconds: number) {
  positions.set(id, Math.round(seconds * 10) / 10)
}

/** Finished (or restarted from the top) — don't resume on the next open. */
export function clearPosition(id: number) {
  positions.delete(id)
}
