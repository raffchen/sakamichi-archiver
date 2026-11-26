/* Client-side aggregation for the Talk-tab Info panel. Member-level fields
   (message_count, counts, first/last, missing) carry most of it; the pulse
   stats (busiest day, last-7-days, listen/watch time) need per-message rows,
   which the logged-in index has in full — the Talk side is login-gated, so
   the anonymized variant (emptied message arrays) never reaches this panel.
   Message timestamps are real UTC instants and display browser-local, unlike
   the blog stamps (Japan time verbatim). */
import type { Archive, Member, MessageType } from './types'
import { dayKey } from './format'

const TYPES: MessageType[] = ['text', 'picture', 'video', 'voice']
export const TYPE_EMOJI: Record<MessageType, string> = {
  text: '💬',
  picture: '📷',
  video: '🎬',
  voice: '🔊',
}

export interface TalkPanel {
  msgs: number
  members: number
  sites: number
  first: string | null // UTC instants (ISO)
  last: string | null
  mediaFiles: number
  disk: { files: number; bytes: number } | null // build-time walk (totals.disk)
  types: { type: MessageType; n: number }[] // fixed order, zeroes included
  busiestDay: { day: string; count: number } | null // local day key 'YYYY-MM-DD'
  last7: number | null // messages within 7 days of generated_at
  listen: number | null // seconds of voice + video
  missing: number
  topRate: { member: Member; perDay: number; msgs: number; days: number } | null
  perMessage: boolean // false when the index served emptied message arrays
}

export function talkPanel(archive: Archive): TalkPanel | null {
  const members = archive.members.filter((m) => m.message_count > 0)
  if (!members.length) return null

  let msgs = 0
  let mediaFiles = 0
  let missing = 0
  let first: string | null = null
  let last: string | null = null
  const typeTotals = new Map<MessageType, number>(TYPES.map((t) => [t, 0]))
  let top: { member: Member; perDay: number; msgs: number; days: number } | null = null
  for (const m of members) {
    msgs += m.message_count
    mediaFiles += m.media_count
    missing += m.missing
    for (const t of TYPES) typeTotals.set(t, typeTotals.get(t)! + (m.counts[t] ?? 0))
    if (m.first && (!first || m.first < first)) first = m.first
    if (m.last && (!last || m.last > last)) last = m.last
  }

  /* fair top talker: messages per day of subscription age (first message →
     archive's newest), not raw counts — the longest-subscribed member would
     otherwise win by seniority alone */
  const lastMs = last ? Date.parse(last) : 0
  for (const m of members) {
    if (!m.first) continue
    const days = Math.max(1, Math.ceil((lastMs - Date.parse(m.first)) / 86_400_000))
    const perDay = m.message_count / days
    if (!top || perDay > top.perDay) top = { member: m, perDay, msgs: m.message_count, days }
  }

  /* per-message pulse: busiest local day, last-7-days volume, listen/watch
     time. Unavailable when the index served emptied message arrays. */
  const perMessage = members.some((m) => m.messages.length > 0)
  let busiestDay: TalkPanel['busiestDay'] = null
  let last7: number | null = null
  let listen: number | null = null
  if (perMessage) {
    const byDay = new Map<string, number>()
    listen = 0
    const cutoff = (Date.parse(archive.generated_at) || Date.now()) - 7 * 86_400_000
    last7 = 0
    for (const m of members)
      for (const msg of m.messages) {
        if (!msg.at) continue
        const k = dayKey(msg.at)
        byDay.set(k, (byDay.get(k) ?? 0) + 1)
        if (Date.parse(msg.at) >= cutoff) last7!++
        if ((msg.type === 'voice' || msg.type === 'video') && msg.dur) listen! += msg.dur
      }
    for (const [day, count] of byDay)
      if (!busiestDay || count > busiestDay.count) busiestDay = { day, count }
  }

  return {
    msgs,
    members: members.length,
    sites: new Set(members.map((m) => m.site)).size,
    first,
    last,
    mediaFiles,
    disk: archive.totals.disk ?? null,
    types: TYPES.map((t) => ({ type: t, n: typeTotals.get(t)! })),
    busiestDay,
    last7,
    listen,
    missing,
    topRate: top,
    perMessage,
  }
}
