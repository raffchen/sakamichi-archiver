import { describe, expect, it } from 'vitest'
import { blogPanel, blogMonth } from './blogStats'
import type { Archive, BlogMemberInfo, BlogStats } from './types'

/* BlogMemberInfo factory — most fields don't matter for the aggregation */
const bm = (o: Partial<BlogMemberInfo>): BlogMemberInfo => ({
  key: 'k',
  site: null,
  uuid: 'u',
  name: 'n',
  kana: null,
  roman: null,
  gen: null,
  gen_num: null,
  graduated: false,
  count: 0,
  first: null,
  last: null,
  thumb: null,
  ...o,
})

const arch = (members: BlogMemberInfo[], stats?: BlogStats): Archive => ({
  generated_at: '2026-11-24T00:00:00Z',
  display_name: 't',
  sites: {
    nogizaka46: { name: '乃木坂46', roman: 'nogizaka46' },
    hinatazaka46: { name: '日向坂46', roman: 'hinatazaka46' },
  },
  totals: { messages: 0, media: 0 },
  members: [],
  blogs: { members, stats },
})

describe('blogMonth', () => {
  it('reads the site-local stamp digits as-is (Japan time, not converted)', () => {
    expect(blogMonth('2016/08/02 02:39:00')).toBe('Aug 2016')
    expect(blogMonth('2017/07/01 23:24:00')).toBe('Jul 2017')
    expect(blogMonth('garbage')).toBeNull()
    expect(blogMonth(null)).toBeNull()
  })
})

describe('blogPanel', () => {
  it('returns null for an archive with no blog directory', () => {
    expect(blogPanel(arch([]))).toBeNull()
  })

  it('aggregates totals, the graduated split and kept posts', () => {
    const p = blogPanel(
      arch(
        [
          bm({ key: 'a', site: 'nogizaka46', count: 100, graduated: false, first: '2020/01/01 10:00:00', last: '2026/11/20 21:00:00' }),
          bm({ key: 'b', site: 'nogizaka46', count: 5, graduated: true, first: '2017/07/01 00:00:00', last: '2021/12/31 23:00:00' }),
          bm({ key: 'c', site: 'hinatazaka46', count: 200, graduated: true, first: '2016/08/02 00:00:00', last: '2024/04/05 10:00:00' }),
        ],
        { years: { '2020': 10, '2016': 20 }, busiestDay: { date: '2025/12/31', count: 74 }, images: { files: 11, bytes: 2_000_000_000 } },
      ),
    )!
    expect(p.posts).toBe(305)
    expect(p.members).toBe(3)
    expect(p.graduated).toBe(2)
    expect(p.graduatedPosts).toBe(205)
    expect(p.first).toBe('2016/08/02 00:00:00')
    expect(p.last).toBe('2026/11/20 21:00:00')
    expect(p.top?.key).toBe('c')
    /* years sort oldest → newest */
    expect(p.years).toEqual([['2016', 20], ['2020', 10]])
    expect(p.busiestDay).toEqual({ date: '2025/12/31', count: 74 })
    expect(p.images).toEqual({ files: 11, bytes: 2_000_000_000 })
  })

  it('builds one row per site with that site\'s span', () => {
    const p = blogPanel(
      arch(
        [
          bm({ key: 'a', site: 'nogizaka46', count: 10, first: '2017/07/01 00:00:00', last: '2026/11/20 21:00:00' }),
          bm({ key: 'b', site: 'nogizaka46', count: 20, first: '2018/01/01 00:00:00', last: '2026/11/01 00:00:00' }),
          bm({ key: 'c', site: 'hinatazaka46', count: 30, first: '2016/08/02 00:00:00', last: '2026/11/21 13:00:00' }),
        ],
      ),
    )!
    expect(p.rows.map((r) => [r.site, r.members, r.posts, r.first, r.last])).toEqual([
      ['nogizaka46', 2, 30, '2017/07/01 00:00:00', '2026/11/20 21:00:00'],
      ['hinatazaka46', 1, 30, '2016/08/02 00:00:00', '2026/11/21 13:00:00'],
    ])
    expect(p.rows[0].label).toBe('乃木坂46')
  })

  it('counts members active within 30 days of the index build (JST offsets pinned)', () => {
    const members = [
      /* 2026/11/23 23:00 UTC — 1h before generated_at: active */
      bm({ key: 'a', site: 'nogizaka46', count: 1, last: '2026/11/24 08:00:00' }),
      /* 2026/10/31 23:00 UTC — 24 days: still active */
      bm({ key: 'b', site: 'nogizaka46', count: 1, last: '2026/11/01 08:00:00' }),
      /* ~54 days before generated_at: outside the window */
      bm({ key: 'c', site: 'hinatazaka46', count: 1, last: '2026/10/01 08:00:00' }),
      /* never posted */
      bm({ key: 'd', site: 'hinatazaka46', count: 0 }),
    ]
    expect(blogPanel(arch(members))!.active30).toBe(2)
  })

  it('degrades gracefully when the index predates blogs.stats', () => {
    const p = blogPanel(arch([bm({ key: 'a', site: 'nogizaka46', count: 7 })]))!
    expect(p.posts).toBe(7)
    expect(p.years).toEqual([])
    expect(p.busiestDay).toBeNull()
    expect(p.images).toBeNull()
  })
})
