/* Client-side aggregation for the blog Info panel. Most numbers fall out of
   the directory's per-member rows (BlogMemberInfo); the index's blogs.stats
   carries only what needs post dates or a media walk (year histogram,
   busiest day, image totals — see build-index.mjs). */
import type { Archive, BlogMemberInfo, BlogStats } from './types'

/* Blog `at` stamps are site-local JST strings ("YYYY/MM/DD HH:mm:ss") —
   fixed-width, so lexicographic order is chronological and slicing is safe.
   They are NOT UTC like message timestamps: the UI displays them verbatim
   (Japan time), so comparisons against generated_at (a real ISO instant)
   must first pin the +09:00 offset. */
const jstMs = (s: string): number | null => {
  const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s)
  if (!m) return null
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`)
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Aug 2016" — a site-local stamp's month, digits taken as-is (Japan time). */
export function blogMonth(s: string | null): string | null {
  const m = /^(\d{4})\/(\d{2})/.exec(s ?? '')
  return m ? `${MON[+m[2] - 1]} ${m[1]}` : null
}

export interface BlogSiteRow {
  site: string
  label: string // group display name from archive.sites, falling back to the key
  members: number // directory cards for this site (greyed ones included)
  graduated: number
  posts: number
  first: string | null // site-local raw stamps (display via blogMonth/blogStamp)
  last: string | null
  years: [string, number][] // this site's posts-per-year, sorted oldest → newest
}

export interface BlogPanel {
  posts: number
  members: number
  graduated: number
  graduatedPosts: number // kept from erased upstream blogs
  first: string | null
  last: string | null
  top: BlogMemberInfo | null // most prolific
  active30: number // members whose newest post is within 30 days of generated_at
  rows: BlogSiteRow[]
  years: [string, number][] // sorted oldest → newest
  busiestDay: { date: string; count: number } | null
  images: { files: number; bytes: number } | null
}

export function blogPanel(archive: Archive): BlogPanel | null {
  const all = archive.blogs?.members ?? []
  if (!all.length) return null
  const stats: BlogStats | undefined = archive.blogs?.stats

  const bySite = new Map<string, BlogMemberInfo[]>()
  for (const b of all) {
    const arr = bySite.get(b.site ?? '') ?? []
    arr.push(b)
    bySite.set(b.site ?? '', arr)
  }

  let posts = 0
  let graduated = 0
  let graduatedPosts = 0
  let first: string | null = null
  let last: string | null = null
  let top: BlogMemberInfo | null = null
  const siteYears = (site: string): [string, number][] =>
    Object.entries(stats?.siteYears?.[site] ?? {}).sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const rows: BlogSiteRow[] = []
  for (const site of Object.keys(archive.sites)) {
    const list = bySite.get(site) ?? []
    if (!list.length) continue
    let sitePosts = 0
    let siteFirst: string | null = null
    let siteLast: string | null = null
    for (const b of list) {
      posts += b.count
      sitePosts += b.count
      if (b.graduated) graduatedPosts += b.count
      if (b.count > 0) {
        if (!siteFirst || (b.first && b.first < siteFirst)) siteFirst = b.first
        if (!siteLast || (b.last && b.last > siteLast)) siteLast = b.last
        if (!top || b.count > top.count) top = b
      }
    }
    if (siteFirst && (!first || siteFirst < first)) first = siteFirst
    if (siteLast && (!last || siteLast > last)) last = siteLast
    const g = list.filter((b) => b.graduated).length
    graduated += g
    rows.push({
      site,
      label: archive.sites[site]?.name ?? site,
      members: list.length,
      graduated: g,
      posts: sitePosts,
      first: siteFirst,
      last: siteLast,
      years: siteYears(site),
    })
  }

  const nowMs = Date.parse(archive.generated_at) || Date.now()
  const active30 = all.filter((b) => {
    const ms = b.last ? jstMs(b.last) : null
    return ms != null && nowMs - ms < 30 * 86_400_000
  }).length

  const years: [string, number][] = Object.entries(stats?.years ?? {}).sort(
    (a, b) => (a[0] < b[0] ? -1 : 1),
  )

  return {
    posts,
    members: all.length,
    graduated,
    graduatedPosts,
    first,
    last,
    top,
    active30,
    rows,
    years,
    busiestDay: stats?.busiestDay ?? null,
    images: stats?.images ?? null,
  }
}

export interface ChartSeg {
  site: string
  n: number
}
export interface ChartYear {
  year: string
  total: number
  segs: ChartSeg[] // stacked bottom-up in table-row order; a site with no posts
  // that year contributes no segment
}

/* One bar per year: all-sites mode stacks the rows' per-site histograms into
   segments; selected-site mode is that site alone (the Info panel colors the
   segments with each site's fixed accent). Years missing from every site's
   histogram don't appear — same as before stacking. */
export function stackedChart(rows: BlogSiteRow[], site: string | null): ChartYear[] {
  if (site) {
    const row = rows.find((r) => r.site === site)
    return (row?.years ?? []).map(([year, n]) => ({ year, total: n, segs: [{ site, n }] }))
  }
  const byYear = new Map<string, ChartSeg[]>()
  for (const r of rows)
    for (const [year, n] of r.years) {
      if (n <= 0) continue // histograms only carry years with posts, but be safe
      const segs = byYear.get(year) ?? []
      segs.push({ site: r.site, n })
      byYear.set(year, segs)
    }
  return [...byYear.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([year, segs]) => ({ year, total: segs.reduce((a, s) => a + s.n, 0), segs }))
}
