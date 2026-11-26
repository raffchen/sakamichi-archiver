import { describe, expect, it } from 'vitest'
import { rosterGroups, talkPanel } from './talkStats'
import type { Archive, Member, Msg } from './types'

const msg = (o: Partial<Msg>): Msg => ({
  id: 1,
  type: 'text',
  at: '2026-11-01T00:00:00Z',
  updated: o.at ?? '2026-11-01T00:00:00Z',
  text: 'hi',
  silent: false,
  fav: false,
  mime: null,
  file: null,
  thumb: null,
  poster: null,
  ratio: null,
  dur: null,
  missing: false,
  ...o,
})

const member = (o: Partial<Member>): Member => ({
  slug: 's',
  name: 'n',
  roman: null,
  site: 'nogizaka46',
  group_id: 1,
  member_id: 1,
  home: null,
  avatar: null,
  first: null,
  last: null,
  counts: {},
  message_count: 0,
  media_count: 0,
  missing: 0,
  source: 'test',
  messages: [],
  ...o,
})

const arch = (members: Member[], disk?: { files: number; bytes: number }): Archive => ({
  generated_at: '2026-11-26T00:00:00Z',
  display_name: 't',
  sites: { nogizaka46: { name: '乃木坂46', roman: 'nogizaka46' } },
  totals: { messages: 0, media: 0, disk },
  members,
})

describe('talkPanel', () => {
  it('returns null for an archive with no subscribed members', () => {
    expect(talkPanel(arch([]))).toBeNull()
  })

  it('aggregates member-level totals, the type mix and the disk stat', () => {
    const p = talkPanel(
      arch(
        [
          member({
            slug: 'a',
            message_count: 10,
            media_count: 4,
            missing: 1,
            counts: { text: 6, picture: 4 },
            first: '2026-10-01T00:00:00Z',
            last: '2026-11-20T00:00:00Z',
          }),
          member({
            slug: 'b',
            site: 'sakurazaka46',
            message_count: 30,
            counts: { text: 20, video: 10 },
            first: '2026-11-19T00:00:00Z',
            last: '2026-11-25T23:00:00Z',
          }),
        ],
        { files: 40, bytes: 500_000_000 },
      ),
    )!
    expect(p.msgs).toBe(40)
    expect(p.members).toBe(2)
    expect(p.sites).toBe(2)
    expect(p.first).toBe('2026-10-01T00:00:00Z')
    expect(p.last).toBe('2026-11-25T23:00:00Z')
    expect(p.mediaFiles).toBe(4)
    expect(p.missing).toBe(1)
    expect(p.types.map((t) => [t.type, t.n])).toEqual([
      ['text', 26],
      ['picture', 4],
      ['video', 10],
      ['voice', 0],
    ])
    expect(p.disk).toEqual({ files: 40, bytes: 500_000_000 })
  })

  it('ranks top talker by messages per day of subscription age, not raw count', () => {
    /* the long-standing member has 4.5× the messages but half the daily rate */
    const p = talkPanel(
      arch([
        member({
          slug: 'old',
          message_count: 90,
          counts: { text: 90 },
          first: '2026-07-01T00:00:00Z', // 148 days before generated_at
          last: '2026-11-25T00:00:00Z',
        }),
        member({
          slug: 'new',
          message_count: 20,
          counts: { text: 20 },
          first: '2026-11-20T00:00:00Z', // 5 days before generated_at
          last: '2026-11-25T00:00:00Z',
        }),
      ]),
    )!
    expect(p.topRate!.member.slug).toBe('new') // 4/day vs 0.6/day
    expect(p.topRate!.perDay).toBeCloseTo(20 / 5, 5)
    expect(p.topRate!.days).toBe(5)
  })

  it('computes the per-message pulse: busiest local day, last 7 days, listen time', () => {
    const p = talkPanel(
      arch([
        member({
          slug: 'a',
          message_count: 5,
          counts: { voice: 1, video: 1, text: 3 },
          first: '2026-11-01T00:00:00Z',
          last: '2026-11-25T00:00:00Z',
          messages: [
            msg({ id: 1, at: '2026-11-24T23:30:00Z', type: 'voice', dur: 90 }),
            msg({ id: 2, at: '2026-11-25T10:00:00Z', type: 'video', dur: 60 }),
            /* 6 days before the generated_at cutoff: inside the window */
            msg({ id: 3, at: '2026-11-20T00:00:00Z' }),
            /* 7.5 days before: outside */
            msg({ id: 4, at: '2026-11-18T12:00:00Z' }),
            msg({ id: 5, at: '2026-11-24T23:30:00Z' }),
          ],
        }),
      ]),
    )!
    /* two messages share that UTC instant — one local day, count 2 */
    expect(p.busiestDay).toEqual({ day: '2026-11-24', count: 2 })
    expect(p.last7).toBe(4) // ids 1, 2, 3, 5 — id 4 is 7.5 days before generated_at
    expect(p.listen).toBe(150)
  })

  it('marks per-message stats unavailable when the index served emptied arrays', () => {
    const p = talkPanel(
      arch([
        member({
          slug: 'a',
          message_count: 9,
          counts: { text: 9 },
          first: '2026-10-01T00:00:00Z',
          last: '2026-11-20T00:00:00Z',
        }),
      ]),
    )!
    expect(p.perMessage).toBe(false)
    expect(p.busiestDay).toBeNull()
    expect(p.last7).toBeNull()
    expect(p.listen).toBeNull()
    expect(p.topRate!.member.slug).toBe('a') // still derivable from member fields
  })
})

describe('rosterGroups', () => {
  const sites = {
    nogizaka46: { name: '乃木坂46', roman: 'nogizaka46' },
    sakurazaka46: { name: '桜坂46', roman: 'sakurazaka46' },
  }

  it('groups by site in archive order, counts desc within each group', () => {
    const g = rosterGroups(
      [
        member({ slug: 'a', site: 'sakurazaka46', message_count: 3 }),
        member({ slug: 'b', site: 'nogizaka46', message_count: 5 }),
        member({ slug: 'c', site: 'nogizaka46', message_count: 9 }),
        member({ slug: 'd', site: 'sakurazaka46', message_count: 1 }),
      ],
      sites,
    )
    expect(g.map((x) => x.name)).toEqual(['乃木坂46', '桜坂46'])
    expect(g[0].members.map((m) => m.slug)).toEqual(['c', 'b'])
    expect(g[1].members.map((m) => m.slug)).toEqual(['a', 'd'])
  })

  it('puts siteless members in a trailing fallback group', () => {
    const g = rosterGroups(
      [member({ slug: 'x', site: undefined, message_count: 2 }), member({ slug: 'y', site: 'nogizaka46', message_count: 1 })],
      sites,
    )
    expect(g.map((x) => x.name)).toEqual(['乃木坂46', ''])
    expect(g[1].members.map((m) => m.slug)).toEqual(['x'])
  })

  it('labels unknown site ids with the key itself, sorted after the known ones', () => {
    const g = rosterGroups(
      [
        member({ slug: 'z', site: 'tokyo46', message_count: 4 }),
        member({ slug: 'y', site: 'nogizaka46', message_count: 1 }),
      ],
      sites,
    )
    expect(g.map((x) => x.name)).toEqual(['乃木坂46', 'tokyo46'])
  })
})
