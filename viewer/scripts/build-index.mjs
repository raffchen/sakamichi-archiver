#!/usr/bin/env node
/*
 * build-index.mjs — turn media/<member>/ (produced by tools/grab-media.py) into
 * one flat public/index.json for the viewer, plus local proxy thumbnails.
 *
 * The archive layout is the input contract:
 *   media/<slug>/_messages.json          all messages (text + media), chronological
 *   media/<slug>/{picture,video,voice}/<message-id>_<published-at>.<ext>
 *   media/<slug>/profile/                chat avatar  (member's own choice)
 *   media/<slug>/single/                 home-grid art (tracks latest single)
 *
 * Media files are matched to messages by leading <message-id>, never by
 * reconstructing the filename (the extension comes from a signed CDN URL and
 * can vary), so the join stays correct if grab-media.py changes naming.
 *
 * Usage:  node scripts/build-index.mjs [--no-thumbs] [--force-thumbs]
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VIEWER = path.resolve(HERE, '..')
const ROOT = path.resolve(VIEWER, '..')
// In the container these are set by the environment (docs/deployment.md):
//   MEDIA_DIR   the archive volume
//   PUBLIC_DIR  where index.json + thumbs/ land (the server serves it at / and /thumbs)
//   ARCHIVE_CONFIG  archive.config.json override
const MEDIA = path.resolve(process.env.MEDIA_DIR || path.join(ROOT, 'media'))
const PUB = path.resolve(process.env.PUBLIC_DIR || path.join(VIEWER, 'public'))
const CONFIG = path.resolve(process.env.ARCHIVE_CONFIG || path.join(VIEWER, 'archive.config.json'))
const THUMBS = path.join(PUB, 'thumbs')

const argv = process.argv.slice(2)
const makeThumbs = !argv.includes('--no-thumbs')
const forceThumbs = argv.includes('--force-thumbs')
const QUIET = argv.includes('--quiet')

const TYPES = ['picture', 'video', 'voice']
const MIME = {
  picture: 'image/jpeg',
  video: 'video/mp4',
  voice: 'audio/mp4',
}
const THUMB_W = 400

const say = (...a) => !QUIET && console.log(...a)

// ---------------------------------------------------------------- helpers
const enc = (p) => p.split('/').map(encodeURIComponent).join('/')

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`  ! ${path.relative(ROOT, file)}: ${e.message}`)
    return null
  }
}

/** the chat avatar the member actually chose: the `thumbnail` file in
    profile/_profile.json — NOT the newest file in profile/ (a member can have
    several cached variants there, and newer ≠ current) */
function profileAvatar(dir, memberId) {
  const pdir = path.join(dir, 'profile')
  const list = readJson(path.join(pdir, '_profile.json'))
  const entries = Array.isArray(list) ? list : list ? [list] : []
  // some folders cache the whole member list; pick this member's own entry
  const me = entries.find((e) => e.id === memberId) ?? entries[0]
  const name = me?.thumbnail ? me.thumbnail.split('?')[0].split('/').pop() : null
  if (name && fs.existsSync(path.join(pdir, name))) return name
  return null
}

/** newest asset in a folder, by the <id>-<YYYYMMDD>-<HHMMSS> stamp in the name */
function newestAsset(dir) {
  if (!fs.existsSync(dir)) return null
  const files = fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith('_') && !f.startsWith('.'))
    .filter((f) => /\.(jpe?g|png|jfif|gif|webp)$/i.test(f))
  if (!files.length) return null
  return files.sort().at(-1)
}

/** id -> filename for every file in a member's media folders */
function filesByMessageId(slugDir) {
  const map = new Map()
  for (const type of TYPES) {
    const dir = path.join(slugDir, type)
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) {
      const m = /^(\d+)_/.exec(f)
      if (!m) continue
      map.set(Number(m[1]), { type, name: f })
    }
  }
  return map
}

function ffmpegAvailable() {
  const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  return !r.error && r.status === 0
}

/** seconds, rounded — for the media-list duration badge (the API doesn't
    carry duration, so it's probed from the archived file) */
function probeDuration(file) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  if (r.error || r.status !== 0) return null
  const s = parseFloat(r.stdout.toString().trim())
  return Number.isFinite(s) ? Math.round(s) : null
}

/** tiny promise pool so ~200 ffmpeg calls don't take forever */
async function pool(items, workers, fn) {
  let i = 0
  let done = 0
  const run = async () => {
    while (true) {
      const k = i++
      if (k >= items.length) return
      await fn(items[k])
      if (++done % 40 === 0) say(`    thumbs ${done}/${items.length}`)
    }
  }
  await Promise.all(Array.from({ length: workers }, run))
}

function ffmpegTo(out, input, video) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y']
  if (video) args.push('-i', input, '-frames:v', '1')
  else args.push('-i', input)
  args.push('-vf', `scale=${THUMB_W}:-2`, '-q:v', '3', out)
  const r = spawnSync('ffmpeg', args, { stdio: 'ignore' })
  return r.status === 0
}

// ---------------------------------------------------------------- main
if (!fs.existsSync(MEDIA)) {
  // In a container the media volume can legitimately be empty on first boot —
  // write an empty index instead of failing so the viewer still comes up; the
  // fs-watch on the server re-indexes as soon as the syncer lands files.
  console.warn(`no media/ archive at ${MEDIA} — writing an empty index`)
}
const config = readJson(CONFIG) ?? { members: {} }
const displayName = config.display_name ?? 'raff'
const sites = config.sites ?? {}

const slugs = fs.existsSync(MEDIA)
  ? fs
      .readdirSync(MEDIA, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
  : []

const members = []
const thumbJobs = []

for (const slug of slugs) {
  const dir = path.join(MEDIA, slug)
  let messages = readJson(path.join(dir, '_messages.json'))
  let source = '_messages.json'
  if (!messages) {
    messages = readJson(path.join(dir, '_manifest.json')) // media-only fallback
    source = '_manifest.json'
  }
  if (!messages?.length) {
    console.warn(`  ! ${slug}: no _messages.json / _manifest.json — skipped`)
    continue
  }

  // site attribution: _member.json (written by grab-media.py) wins over config
  const meta = readJson(path.join(dir, '_member.json')) ?? {}
  const conf = config.members?.[slug] ?? {}
  // a folder that isn't in archive.config.json still gets indexed — under the first site
  const site = meta.site ?? conf.site ?? Object.keys(sites)[0] ?? null
  if (!meta.site && !conf.site)
    console.warn(`  ! ${slug}: not in archive.config.json — assuming site "${site}" (add it if that's wrong)`)

  const files = filesByMessageId(dir)
  const counts = { text: 0, picture: 0, video: 0, voice: 0 }
  const thumbDirName = slug
  let missing = 0

  const msgs = []
  for (const m of messages) {
    counts[m.type] = (counts[m.type] ?? 0) + 1
    const hit = files.get(m.id)
    const entry = {
      id: m.id,
      type: m.type,
      at: m.published_at,
      updated: m.updated_at,
      // %%% is the app's placeholder for the subscriber's display name
      text: (m.text ?? '').replaceAll('%%%', displayName) || null,
      silent: !!m.is_silent,
      fav: !!m.is_favorite,
      mime: hit ? (MIME[m.type] ?? null) : null,
      file: null,
      thumb: null,
      poster: null,
      missing: m.type !== 'text' && !hit, // text messages have no file to archive
    }
    // aspect ratio straight from the API's thumbnail dims (no layout jump)
    if (m.thumbnail_width && m.thumbnail_height) {
      entry.ratio = +(m.thumbnail_width / m.thumbnail_height).toFixed(4)
    }
    if (hit) {
      const rel = `${slug}/${hit.type}/${hit.name}`
      entry.file = `/media/${enc(rel)}`
      const tRel = `${thumbDirName}/${m.id}.jpg`
      entry.thumb = `/thumbs/${enc(tRel)}`
      if (m.type === 'video') entry.poster = entry.thumb
      if (m.type === 'video' || m.type === 'voice')
        entry.dur = probeDuration(path.join(dir, hit.type, hit.name))
      fs.mkdirSync(path.join(THUMBS, thumbDirName), { recursive: true })
      thumbJobs.push({
        out: path.join(THUMBS, thumbDirName, `${m.id}.jpg`),
        input: path.join(dir, hit.type, hit.name),
        video: m.type === 'video',
      })
    } else if (m.type !== 'text') {
      missing++
    }
    msgs.push(entry)
  }
  msgs.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id))

  const memberId = meta.member_id ?? messages[0]?.member_id ?? null
  const profile = profileAvatar(dir, memberId) ?? newestAsset(path.join(dir, 'profile'))
  const home = newestAsset(path.join(dir, 'single'))

  members.push({
    slug,
    name: meta.name ?? conf.name ?? slug.replace(/_/g, ' '),
    roman: meta.roman ?? conf.roman ?? null,
    /* あいうえお reading for sorting (kanji is ambiguous); kana falls back to name */
    kana: meta.kana ?? conf.kana ?? null,
    site: site ?? null,
    group_id: meta.group_id ?? messages[0]?.group_id ?? null,
    member_id: memberId,
    // home grid uses the single artwork, the thread uses the chat avatar
    // (two independent image systems — see docs/api.md)
    home: home ? `/media/${enc(`${slug}/single/${home}`)}` : null,
    avatar: profile ? `/media/${enc(`${slug}/profile/${profile}`)}` : null,
    first: msgs[0]?.at ?? null,
    last: msgs.at(-1)?.at ?? null,
    counts,
    message_count: msgs.length,
    media_count: counts.picture + counts.video + counts.voice,
    missing,
    source,
    messages: msgs,
  })
}

/* あいうえお order by last name: Intl's Japanese collator handles the kana
   readings in archive.config.json (kanji itself can't be sorted reliably).
   Members without a kana field sort by their kanji name, last. */
const collator = new Intl.Collator('ja')
const sortKey = (m) => m.kana ?? m.name
members.sort((a, b) => collator.compare(sortKey(a), sortKey(b)))

// thumbnails (video poster frames + grid thumbs), incremental like the archiver
let thumbNote = 'skipped'
if (makeThumbs && thumbJobs.length) {
  if (!ffmpegAvailable()) {
    thumbNote = 'no ffmpeg — skipped'
    console.warn('ffmpeg not found: video posters / grid thumbs disabled (viewer falls back to full files)')
  } else {
    const todo = forceThumbs ? thumbJobs : thumbJobs.filter((j) => !fs.existsSync(j.out))
    fs.mkdirSync(THUMBS, { recursive: true })
    const t0 = Date.now()
    await pool(todo, 4, async (j) => ffmpegTo(j.out, j.input, j.video))
    thumbNote = `${todo.length} new / ${thumbJobs.length} total (${((Date.now() - t0) / 1000).toFixed(1)}s)`
  }
}

const totals = members.reduce(
  (t, m) => {
    t.messages += m.message_count
    t.media += m.media_count
    return t
  },
  { messages: 0, media: 0 },
)

const index = {
  generated_at: new Date().toISOString(),
  display_name: displayName,
  sites,
  totals,
  members,
}

// index.json is written atomically (tmp + rename): the server may serve it to
// polling clients while a rebuild lands, so a truncated write must never be
// observable under the final name.
fs.mkdirSync(PUB, { recursive: true })
const indexTmp = path.join(PUB, 'index.json.tmp')
fs.writeFileSync(indexTmp, JSON.stringify(index))
fs.renameSync(indexTmp, path.join(PUB, 'index.json'))

say(`index.json: ${members.length} members, ${totals.messages} messages, ${totals.media} media`)
say(`thumbs: ${thumbNote}`)
for (const m of members) {
  const c = m.counts
  say(
    `  ${(m.roman ?? m.name).padEnd(17)} ${String(m.message_count).padStart(4)} msgs  ` +
      `img ${String(c.picture).padStart(3)} vid ${String(c.video).padStart(3)} voice ${String(c.voice).padStart(3)}` +
      (m.missing ? `  (${m.missing} not archived)` : ''),
  )
}
