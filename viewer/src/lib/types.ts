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
}

export interface Site {
  name: string
  roman: string
  origin?: string
}

export interface Archive {
  generated_at: string
  display_name: string
  sites: Record<string, Site>
  totals: { messages: number; media: number }
  members: Member[]
}
