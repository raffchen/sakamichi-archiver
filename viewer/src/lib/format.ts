/* Timestamps in the archive are UTC; the real apps (and this viewer) display
   browser-local time. See README §7 — that's why the emulator screenshots show
   3:57 for a message published 11:57Z (the AVD clock runs US Pacific). */

const WD = ['日', '月', '火', '水', '木', '金', '土']

const d = (iso: string) => new Date(iso)

export function dayKey(iso: string): string {
  const x = d(iso)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

export const isSameDay = (a: string, b: string) => dayKey(a) === dayKey(b)

/** "11/12 3:57" — the app's per-message stamp (12-hour clock) */
export function fmtStamp(iso: string): string {
  const x = d(iso)
  let h = x.getHours() % 12
  if (h === 0) h = 12
  return `${x.getMonth() + 1}/${x.getDate()} ${h}:${String(x.getMinutes()).padStart(2, '0')}`
}

/** "11/12 15:57" — for the gallery / search rows */
export function fmtDateTime(iso: string): string {
  const x = d(iso)
  return `${x.getMonth() + 1}/${x.getDate()} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`
}

/** "2026年11月12日 (木)" — day separator */
export function fmtDayLabel(iso: string): string {
  const x = d(iso)
  return `${x.getFullYear()}年${x.getMonth() + 1}月${x.getDate()}日 (${WD[x.getDay()]})`
}

export function fmtDayShort(iso: string): string {
  const x = d(iso)
  return `${x.getMonth() + 1}/${x.getDate()} (${WD[x.getDay()]})`
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Nov 2026" — month header of the official media list */
export function fmtMonth(iso: string): string {
  const x = d(iso)
  return `${MON[x.getMonth()]} ${x.getFullYear()}`
}

export function fmtFull(iso: string): string {
  const x = d(iso)
  return `${x.getFullYear()}/${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`
}

export function fmtDur(sec: number | null): string {
  if (!sec || !isFinite(sec)) return '--:--'
  const s = Math.round(sec)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** "9/18/2026 23:55" — voice list row stamp (official media page) */
export function fmtMediaStamp(iso: string): string {
  const x = d(iso)
  return `${x.getMonth() + 1}/${x.getDate()}/${x.getFullYear()} ${x.getHours()}:${String(x.getMinutes()).padStart(2, '0')}`
}

export function daysAgo(iso: string, refIso: string): number {
  return Math.round((d(refIso).getTime() - d(iso).getTime()) / 86_400_000)
}

export function sizeOf(n: number): string {
  if (n > 1_000_000_000) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n > 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`
  if (n > 1_000) return `${(n / 1_000).toFixed(0)} kB`
  return `${n} B`
}

/** "11/14/2026 20:06" — the app's blog-card stamp (numeric, 24-hour) */
export function fmtBlogStamp(iso: string): string {
  const x = d(iso)
  return (
    `${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}/${x.getFullYear()} ` +
    `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`
  )
}
