/* Shape of public/index.json, produced by scripts/build-index.mjs.
   Message fields mirror the upstream API (see ../docs/api.md). */

export type MessageType = 'text' | 'picture' | 'video' | 'voice'

export interface Msg {
  id: number
  type: MessageType
  at: string // published_at, ISO 8601 UTC
  updated: string
  /** text body, or the caption of a picture/video message; %%% already expanded */
  text: string | null
  silent: boolean // is_silent -> "This video has no audio"
  fav: boolean
  mime: string | null
  file: string | null // /media/<slug>/<type>/<file>
  thumb: string | null // /thumbs/... (local, ffmpeg-generated)
  poster: string | null // video poster == thumb
  ratio: number | null // width/height from the API thumbnail dims
  dur: number | null // seconds (ffprobe), video/voice only — for the media-list badge
  missing: boolean // message exists but the file was never archived
}

export interface Member {
  slug: string
  name: string
  roman: string | null
  site: string | null
  group_id: number | null
  member_id: number | null
  home: string | null // single/ artwork -> home grid
  avatar: string | null // profile/ picture -> thread avatar
  first: string | null
  last: string | null
  counts: Record<string, number>
  message_count: number
  media_count: number
  missing: number
  source: string
  messages: Msg[]
  /* stage 4: set by the slim /api/index when older messages' texts were
     dropped (full texts come from /api/member/<slug> on thread open) */
  textsTruncated?: boolean
}

export interface Site {
  name: string
  roman: string
  origin?: string
  official?: string // the group's own website (the Official tab's link)
}

export interface BlogMemberInfo {
  key: string // directory name under media/blogs/
  site: string | null
  uuid: string // message/blog member_uuid (joins blog-generations.json)
  name: string
  kana: string | null // reading (blog-generations.json) — the reliable sort key
  roman: string | null // romanized name (official JSONP / en-wiki) — the .sub line
  gen: string | null
  gen_num: number | null
  graduated: boolean
  count: number
  first: string | null
  last: string | null
  thumb: string | null // latest post's thumbnail -> directory card
}

export interface BlogEntry {
  id: number
  title: string | null
  creator: string | null
  at: string // "YYYY/MM/DD HH:mm:ss" site-local
  link: string | null
  thumbnail: string | null // "files/..." relative to the member's blog dir
  thumb?: string | null // /thumbs/blog/<key>/<name>.jpg square crop for list rows
  content: string | null // post HTML (detail view only; list has `lead`)
  lead?: string | null
}

export interface BlogStats {
  years: Record<string, number> // posts per year ('2016': 1149), all sites
  siteYears: Record<string, Record<string, number>> // the same, per site key
  busiestDay: { date: string; count: number } | null // site-local day, e.g. '2025/12/31'
  images: { files: number; bytes: number } // blog/files originals across all members
}

export interface Archive {
  generated_at: string
  display_name: string
  sites: Record<string, Site>
  totals: {
    messages: number
    media: number
    disk?: { files: number; bytes: number } // archived message media on disk
  }
  members: Member[]
  blogs?: { members: BlogMemberInfo[]; stats?: BlogStats }
  /* stage 4: true when the served index dropped old message texts */
  textsTruncated?: boolean
}
