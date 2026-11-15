import { describe, expect, it } from 'vitest'
import {
  dayKey,
  daysAgo,
  fmtBlogStamp,
  fmtDateTime,
  fmtDayLabel,
  fmtDayShort,
  fmtDur,
  fmtFull,
  fmtMediaStamp,
  fmtMonth,
  fmtStamp,
  isSameDay,
  sizeOf,
} from './format'

/* Timestamps are UTC in the archive but rendered browser-local; the test env
   pins TZ=UTC (vitest.config.ts), so expectations below are UTC values. */
const T = '2026-11-12T02:57:00Z' // Thu 2026-11-12 02:57 UTC
const LATE = '2026-11-12T15:07:00Z'

describe('dayKey / isSameDay', () => {
  it('pads the month and day', () => {
    expect(dayKey('2026-03-05T10:00:00Z')).toBe('2026-03-05')
    expect(dayKey(T)).toBe('2026-11-12')
  })

  it('compares by local day, not by instant', () => {
    expect(isSameDay(T, '2026-11-12T23:59:00Z')).toBe(true)
    expect(isSameDay(T, '2026-11-13T00:00:00Z')).toBe(false)
  })
})

describe('fmtStamp', () => {
  it('formats "M/D h:mm" on a 12-hour clock', () => {
    expect(fmtStamp(T)).toBe('11/12 2:57')
    expect(fmtStamp('2026-11-12T13:05:00Z')).toBe('11/12 1:05')
  })

  it('maps hour 0 to 12 (12 AM)', () => {
    expect(fmtStamp('2026-11-12T00:01:00Z')).toBe('11/12 12:01')
  })
})

describe('fmtDateTime', () => {
  it('formats "M/D HH:mm" on a 24-hour clock, zero-padded', () => {
    expect(fmtDateTime(LATE)).toBe('11/12 15:07')
    expect(fmtDateTime('2026-01-01T09:05:00Z')).toBe('1/1 09:05')
  })
})

describe('fmtDayLabel / fmtDayShort', () => {
  it('renders the full Japanese day separator with the right weekday', () => {
    expect(fmtDayLabel(T)).toBe('2026年11月12日 (木)')
    expect(fmtDayLabel('2026-11-18T10:00:00Z')).toBe('2026年11月18日 (水)')
  })

  it('renders the short form', () => {
    expect(fmtDayShort(T)).toBe('11/12 (木)')
  })
})

describe('fmtMonth / fmtFull', () => {
  it('formats the gallery month header', () => {
    expect(fmtMonth(T)).toBe('Nov 2026')
    expect(fmtMonth('2026-01-01T00:00:00Z')).toBe('Jan 2026')
  })

  it('formats the full zero-padded stamp', () => {
    expect(fmtFull(LATE)).toBe('2026/11/12 15:07')
  })
})

describe('fmtDur', () => {
  it('shows --:-- for null / non-finite / zero', () => {
    expect(fmtDur(null)).toBe('--:--')
    expect(fmtDur(0)).toBe('--:--')
    expect(fmtDur(NaN)).toBe('--:--')
    expect(fmtDur(Infinity)).toBe('--:--')
  })

  it('rounds seconds and pads minutes/seconds', () => {
    expect(fmtDur(59)).toBe('00:59')
    expect(fmtDur(60)).toBe('01:00')
    expect(fmtDur(600)).toBe('10:00')
    expect(fmtDur(61.4)).toBe('01:01') // rounds to 61s
  })
})

describe('fmtMediaStamp', () => {
  it('formats "M/D/YYYY H:mm" for voice list rows', () => {
    expect(fmtMediaStamp(T)).toBe('11/12/2026 2:57')
    expect(fmtMediaStamp(LATE)).toBe('11/12/2026 15:07')
  })
})

describe('fmtBlogStamp', () => {
  it('formats the zero-padded "MM/DD/YYYY HH:mm" blog-card stamp', () => {
    expect(fmtBlogStamp(T)).toBe('11/12/2026 02:57')
    expect(fmtBlogStamp('2026-01-05T09:03:00Z')).toBe('01/05/2026 09:03')
  })
})

describe('daysAgo', () => {
  it('counts whole days between two stamps', () => {
    expect(daysAgo('2026-11-10T00:00:00Z', '2026-11-12T00:00:00Z')).toBe(2)
    expect(daysAgo('2026-11-12T10:00:00Z', '2026-11-12T11:00:00Z')).toBe(0)
  })
})

describe('sizeOf', () => {
  it('formats bytes / kB / MB', () => {
    expect(sizeOf(500)).toBe('500 B')
    expect(sizeOf(1_500)).toBe('2 kB')
    expect(sizeOf(90_000)).toBe('90 kB')
    expect(sizeOf(1_234_567)).toBe('1.2 MB')
  })
})
