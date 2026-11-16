#!/usr/bin/env node
/*
 * server.mjs — the production server for the viewer (docker; docs/deployment.md)
 *
 * What it does, in order:
 *   1. serves the built static bundle (dist/) at /
 *   2. mounts the archive at /media/** via sirv — Range support + percent-encoded
 *      Japanese folder names, ported 1:1 from the serveArchive() plugin in
 *      vite.config.ts (same options, same headers)
 *   3. serves runtime-built files (public/) at /index.json + /thumbs/**
 *      as a fallback chain — dev mode so files created after startup resolve
 *   4. builds the index at startup (build-index.mjs, needs ffmpeg) and rebuilds
 *      it (debounced fs-watch) whenever the media volume changes
 *   5. /api/* — index + version + health for the client and the container
 *      healthcheck
 *   6. optional login gate (VIEWER_PASSWORD): the talk/message side answers
 *      401 to anonymous clients while the blog archive stays public — the
 *      login screen lives in the SPA (viewer/src/lib/auth.svelte.ts), no
 *      basic_auth popup. Unset ⇒ everything is public (local dev).
 *
 * Config (env, with the local-development layout as default):
 *   PORT        :8080
 *   MEDIA_DIR   <repo>/media
 *   DIST_DIR    <viewer>/dist
 *   PUBLIC_DIR  <viewer>/public
 *
 * `npm run dev` / `vite preview` remain the local development path; this file
 * is only the production entry point.
 */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import sirv from 'sirv'

const VIEWER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(VIEWER, '..')
const MEDIA = path.resolve(process.env.MEDIA_DIR || path.join(ROOT, 'media'))
const DIST = path.resolve(process.env.DIST_DIR || path.join(VIEWER, 'dist'))
const PUB = path.resolve(process.env.PUBLIC_DIR || path.join(VIEWER, 'public'))
const LOGS = path.resolve(process.env.LOGS_DIR || path.join(ROOT, 'logs'))
const DB_PATH = process.env.DB_PATH || path.join(PUB, 'index.sqlite')
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || ''

/* ---- optional login gate (VIEWER_PASSWORD) ----------------------------
   The talk/message side of the archive is subscription content; the blog
   archive is fine to be public. When VIEWER_PASSWORD is set, every path
   carrying message data (needsAuth below) answers 401 until the client
   POSTs the password to /api/login; the SPA shows its own login screen
   instead of a basic_auth popup.

   Sessions are stateless: the cookie carries an expiry plus an HMAC
   signature whose key is derived from the password itself. Nothing lives
   in a file or DB, sessions survive container restarts, and changing the
   password invalidates every session at once (the derived key changes).
   Unset ⇒ the gate is off entirely (local dev, vite dev has no server). */
const AUTH_PW = process.env.VIEWER_PASSWORD || ''
const AUTH_COOKIE = 'sakamichi_auth'
const AUTH_TTL_MS = 30 * 864e5 // 30 days
const AUTH_SECRET = AUTH_PW
  ? crypto.createHash('sha256').update('sakamichi-auth-v1:' + AUTH_PW).digest()
  : null
const authSignature = (exp) =>
  crypto.createHmac('sha256', AUTH_SECRET).update('auth:' + exp).digest('hex')

/** fixed-length constant-time string comparison (hash both sides first) */
function safeEqStr(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

const parseCookies = (req) => {
  const out = {}
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

function isAuthed(req) {
  if (!AUTH_SECRET) return true // gate disabled — everything is public
  const raw = parseCookies(req)[AUTH_COOKIE]
  if (!raw) return false
  const dot = raw.indexOf('.')
  const exp = Number(raw.slice(0, dot))
  const sig = raw.slice(dot + 1)
  if (!Number.isFinite(exp) || exp < Date.now() || !/^[0-9a-f]{64}$/.test(sig)) return false
  return safeEqStr(sig, authSignature(exp))
}

/** which paths carry talk/message data — the login boundary; the blog
    archive (and its media) is deliberately public. /index.json is the RAW
    on-disk index (unslimmed, full texts) so it must never reach an
    anonymous client; the slimmed /api/index handles that (anon variant
    below). Message media is path-distinguishable under the group-first
    layout (media/<site>/messages/**, thumbs mirror it) — legacy flat
    message trees (media/<member>) would NOT be gated by the segment check,
    but this archive has none (see docs/deployment.md §2.1). */
function needsAuth(p, qp) {
  if (p.startsWith('/api/member/')) return true
  if (p === '/api/search') return qp.get('type') !== 'blog' // blog search stays public
  if (p === '/index.json') return true
  if (/^\/(media|thumbs)\//.test(p)) {
    try {
      return /\/messages\//.test(decodeURIComponent(p))
    } catch {
      return true // un-decodable path — treat as sensitive
    }
  }
  return false
}

/* naive per-IP throttle on failed logins: escalating lockout, in-memory
   (resets on restart — the goal is slowing brute force, not forensics) */
const loginFails = new Map() // ip → { n, until }
const loginThrottled = (ip) => {
  const rec = loginFails.get(ip)
  return rec && rec.until > Date.now() ? rec.until : 0
}
const loginFailed = (ip) => {
  if (loginFails.size > 500)
    for (const [k, v] of loginFails) if (v.until < Date.now()) loginFails.delete(k)
  const n = (loginFails.get(ip)?.n ?? 0) + 1
  // one typo shouldn't lock anyone out — the window opens at the 2nd failure
  loginFails.set(ip, { n, until: n >= 2 ? Date.now() + Math.min(n - 1, 8) * 1500 : 0 })
}

/* kuromoji, lazy: only the reading-snippet fallback needs token positions,
   so the ~0.5 s dictionary load happens on the first search that needs it */
let tokenizerPromise = null
const getTokenizer = () =>
  (tokenizerPromise ??= import(path.join(VIEWER, 'scripts', 'tokenize.mjs'))
    .then((m) => m.buildTokenizer(say))
    .catch(() => null))

/* stage 5: embedding model, lazy — ~5 s model load + a few hundred MB RAM on
   the first search; null ⇒ related stays empty and search stays exact-only */
let embedderPromise = null
const getEmbedder = () =>
  (embedderPromise ??= import(path.join(VIEWER, 'scripts', 'embed.mjs'))
    .then((m) => m.buildEmbedder(say))
    .catch(() => null))

/* semantic cutoffs: e5-small's absolute cosines run high (anisotropy), so the
   floor alone can't separate — hits must also be within GAP of the best hit.
   Both tunable per env (stage 6 tunes them with logged distributions). */
const SEMANTIC_MIN_COS = Number(process.env.SEMANTIC_MIN_COS) || 0.65
const SEMANTIC_GAP = Number(process.env.SEMANTIC_GAP) || 0.06
/* unscoped (mixed-corpus) related budgets per group; a scoped search gives the
   active group the full 20 */
const BLOG_CAP = 12
const MSG_CAP = 8
/* stage 6: set SEMANTIC_LOG=1 to log per-query score distributions (tuning aid) */
const SEMANTIC_LOG = process.env.SEMANTIC_LOG === '1'

/* long-lived read-only handle for the DB-backed /api/blog feed (O(1) reads;
   any failure falls back to the file scan per request) */
let feedDb = null
const getFeedDb = () => {
  if (feedDb !== null) return feedDb
  try {
    feedDb = fs.existsSync(DB_PATH) ? new DatabaseSync(DB_PATH, { readOnly: true }) : false
  } catch (e) {
    say(`! feed DB unavailable (${e.message}) — /api/blog reads files`)
    feedDb = false
  }
  return feedDb || null
}
const PORT = Number(process.env.PORT || 8080)
const INDEX = path.join(PUB, 'index.json')
/* stage 4: how many recent messages keep their text in the SLIM /api/index
   payload (talk-list previews). Full texts stay on disk + /api/member/<slug>. */
const SLIM_TEXT_KEEP = 5
const slimCache = { mtime: 0, full: /** @type {string | null} */ (null), anon: /** @type {string | null} */ (null) }

// session-cookie upload (docs/deployment.md §3.7): site key → cookie file
// (same names harvest-session.py writes, so grab-media.py needs no changes)
const COOKIE_FILES = {
  nogizaka46: 'nogizaka-session-cookie.txt',
  sakurazaka46: 'sakura-session-cookie.txt',
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const audit = (msg) => console.log(`[audit] ${new Date().toISOString()} ${msg}`)

/** constant-time bearer check; disabled entirely when UPLOAD_TOKEN is unset */
function authorized(req) {
  if (!UPLOAD_TOKEN) return false
  const got = Buffer.from(req.headers.authorization || '')
  const want = Buffer.from('Bearer ' + UPLOAD_TOKEN)
  return got.length === want.length && crypto.timingSafeEqual(got, want)
}

/** read the request body with a hard size cap (a session uuid is 36 bytes);
    over-cap data is drained silently so the 413 response still gets sent */
function readBody(req, cap = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0
    let done = false
    const chunks = []
    const settle = (fn, val) => {
      if (!done) {
        done = true
        fn(val)
      }
    }
    req.on('data', (c) => {
      size += c.length
      if (size > cap) {
        settle(reject, Object.assign(new Error('payload too large'), { status: 413 }))
        return // drain
      }
      chunks.push(c)
    })
    req.on('end', () => settle(resolve, Buffer.concat(chunks).toString('utf8')))
    req.on('error', (e) => settle(reject, e))
  })
}

function sessionStatus() {
  const sites = {}
  for (const [site, cookieFile] of Object.entries(COOKIE_FILES)) {
    let status = null
    try {
      status = JSON.parse(fs.readFileSync(path.join(LOGS, `${site}-session-status.json`), 'utf8'))
    } catch { /* no record yet */ }
    let cookieAgeDays = null
    try {
      // mtime updates on every rotation — i.e. on every successful renewal
      cookieAgeDays = +((Date.now() - fs.statSync(path.join(LOGS, cookieFile)).mtimeMs) / 864e5).toFixed(3)
    } catch { /* no cookie file yet */ }
    sites[site] = {
      ok: status?.ok ?? null,
      checked_at: status?.checked_at ?? null,
      last_error: status?.last_error ?? null,
      cookie_age_days: cookieAgeDays,
    }
  }
  return sites
}

const say = (...a) => console.log(`[server]`, ...a)

// ---------------------------------------------------------------- reindex
let rebuilding = false
let dirtyDuringRebuild = false
let lastError = null

function buildIndex() {
  return new Promise((resolve) => {
    if (rebuilding) {
      dirtyDuringRebuild = true
      return resolve()
    }
    rebuilding = true
    say('building index…')
    const child = spawn(
      process.execPath,
      [path.join(VIEWER, 'scripts', 'build-index.mjs')],
      { stdio: 'inherit', env: { ...process.env } },
    )
    child.on('exit', (code) => {
      rebuilding = false
      lastError = code === 0 ? null : `build-index exited ${code}`
      if (code !== 0) say(`! index build failed (${code})`)
      resolve()
      if (dirtyDuringRebuild) {
        dirtyDuringRebuild = false
        buildIndex()
      }
    })
  })
}

/**
 * Debounced fs-watch on the media volume — same shape as the watchArchive()
 * plugin in vite.config.ts (one big sync lands hundreds of files; re-arm if
 * edits arrive while a rebuild is running). Unlike the dev plugin there is no
 * websocket to ping: clients poll /api/version and reload on change.
 */
function watchMedia() {
  let timer = null
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      buildIndex()
    }, 1500)
  }
  try {
    fs.watch(MEDIA, { recursive: true }, schedule)
    say(`watching ${MEDIA} for changes`)
    return true
  } catch (e) {
    say(`! cannot watch ${MEDIA} (${e.message}) — index updates need a restart`)
    return false
  }
}

// ---------------------------------------------------------------- static
const mediaFiles = sirv(MEDIA, {
  dev: true, // check the filesystem per request: the syncer adds files while we run
  single: false,
  extensions: [],
  setHeaders(res, file) {
    // .jfif is JPEG; some CDNs serve it without a usable type
    if (/\.jfif$/i.test(file)) res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Access-Control-Allow-Origin', '*')
  },
})

const distFiles = sirv(DIST, {
  dev: false,
  single: false, // hash routing — nothing but / needs the shell
})

const pubFiles = sirv(PUB, {
  dev: true, // thumbs/ and index.json are created after startup
  single: false,
  extensions: [],
  setHeaders(res, file) {
    if (/\.jfif$/i.test(file)) res.setHeader('Content-Type', 'image/jpeg')
    res.setHeader('Access-Control-Allow-Origin', '*')
  },
})

const readIndexJson = () => {
  try {
    return fs.readFileSync(INDEX)
  } catch {
    return null
  }
}

function sendJson(res, status, body, cache = 'no-store') {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': cache,
  })
  res.end(JSON.stringify(body))
}

// ---------------------------------------------------------------- handler
const app = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const p = url.pathname

  if (p === '/api/health') {
    // alive regardless of index state — the healthcheck must not flap while
    // the first index build is still running
    return sendJson(res, 200, { ok: true, lastError })
  }

  /* ---- login gate: status + login + logout, then the path gate. Everything
     below that carries talk data answers 401 {error:'auth required'} to
     anonymous clients (needsAuth above); the SPA's login screen (auth.svelte.ts)
     handles the UX. ---- */
  if (p === '/api/auth') {
    return sendJson(res, 200, { required: !!AUTH_SECRET, authed: isAuthed(req) })
  }

  if (p === '/api/login' && req.method === 'POST') {
    if (!AUTH_SECRET) return sendJson(res, 400, { error: 'auth disabled (VIEWER_PASSWORD not set)' })
    const ip = req.socket.remoteAddress || '?'
    const throttledUntil = loginThrottled(ip)
    if (throttledUntil) {
      audit(`login throttled from ${ip}`)
      return sendJson(res, 429, { error: `too many attempts — retry after ${new Date(throttledUntil).toISOString()}` })
    }
    let body = {}
    try {
      body = JSON.parse((await readBody(req)) || '{}')
    } catch {}
    if (typeof body.password === 'string' && body.password && safeEqStr(body.password, AUTH_PW)) {
      loginFails.delete(ip)
      const exp = Date.now() + AUTH_TTL_MS
      // Caddy terminates TLS and sets x-forwarded-proto (trusted_proxies is
      // configured) — Secure only applies when the client actually used https
      const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') ? '; Secure' : ''
      res.setHeader(
        'Set-Cookie',
        `${AUTH_COOKIE}=${exp}.${authSignature(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_TTL_MS / 1000}${secure}`,
      )
      audit(`login ok from ${ip}`)
      return sendJson(res, 200, { ok: true })
    }
    loginFailed(ip)
    audit(`login failed from ${ip}`)
    return sendJson(res, 401, { error: 'wrong password' })
  }

  if (p === '/api/logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
    return sendJson(res, 200, { ok: true })
  }

  if (AUTH_SECRET && !isAuthed(req) && needsAuth(p, url.searchParams)) {
    return sendJson(res, 401, { error: 'auth required' })
  }

  if (p === '/api/version') {
    const raw = readIndexJson()
    if (!raw) return sendJson(res, 404, { error: 'no index yet' })
    try {
      return sendJson(res, 200, { generated_at: JSON.parse(raw).generated_at })
    } catch {
      return sendJson(res, 500, { error: 'index unreadable' })
    }
  }

  if (p === '/api/sync/status') {
    // public (unlike /api/secrets/status): the Talk footer shows when the API
    // was last checked — grabbed from the syncer's session-status records,
    // which every grab-media round (probe or full) refreshes. Reads live from
    // the logs dir, so it's fresh between index rebuilds.
    const sites = sessionStatus()
    const checked = Object.values(sites).map((s) => s.checked_at).filter(Boolean).sort()
    return sendJson(res, 200, {
      last_checked: checked.length ? checked[checked.length - 1] : null,
      sites: Object.fromEntries(
        Object.entries(sites).map(([k, v]) => [k, { checked_at: v.checked_at, ok: v.ok }]),
      ),
    })
  }

  if (p === '/api/index') {
    const raw = readIndexJson()
    if (!raw) return sendJson(res, 404, { error: 'no index yet (build-index pending or failed)' })
    // stage 4: clients get a SLIM index — message texts for all but the most
    // recent few are dropped (talk-list previews only need the last one; deep
    // history comes from /api/member/<slug> when a thread opens). Keeps the
    // download flat as the archive grows; the disk index stays full (it's the
    // source for /api/member). vite dev serves the raw file — dev keeps full
    // texts + the client-scan search fallback.
    try {
      const st = fs.statSync(INDEX)
      if (!slimCache.full || slimCache.mtime !== st.mtimeMs) {
        const idx = JSON.parse(raw)
        let truncated = false
        for (const m of idx.members) {
          if (m.messages.length > SLIM_TEXT_KEEP) {
            for (let i = 0; i < m.messages.length - SLIM_TEXT_KEEP; i++) m.messages[i].text = null
            m.textsTruncated = true
            truncated = true
          }
        }
        if (truncated) idx.textsTruncated = true
        slimCache.mtime = st.mtimeMs
        slimCache.full = JSON.stringify(idx)
        // anonymous variant (login gate): the message arrays ARE talk data
        // (previews, media URLs, counts of what's new) — empty them entirely;
        // names, sites and the blog directory stay public
        const anon = JSON.parse(slimCache.full)
        for (const m of anon.members) m.messages = []
        delete anon.textsTruncated
        slimCache.anon = JSON.stringify(anon)
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      })
      return res.end(isAuthed(req) ? slimCache.full : slimCache.anon)
    } catch (e) {
      say(`! slimming index failed (${e.message}) — serving raw`)
      // the raw file is unslimmed (full texts) — never an anonymous body
      if (!isAuthed(req)) return sendJson(res, 500, { error: 'index unreadable' })
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      })
      return res.end(raw)
    }
  }

  // --- one member, full texts (stage 4): thread/gallery fetch this on open
  // when the slim index flagged textsTruncated
  if (p.startsWith('/api/member/')) {
    const raw = readIndexJson()
    if (!raw) return sendJson(res, 404, { error: 'no index yet (build-index pending or failed)' })
    let slug = decodeURIComponent(p.slice('/api/member/'.length))
    slug = slug.replace(/\/$/, '')
    let mem = null
    try {
      mem = JSON.parse(raw).members.find((m) => m.slug === slug) ?? null
    } catch {
      return sendJson(res, 500, { error: 'index unreadable' })
    }
    if (!mem) return sendJson(res, 404, { error: `unknown member: ${slug}` })
    return sendJson(res, 200, mem)
  }

  // --- search (stage 2): exact matches over messages + blog posts via FTS5.
  // Reads the indexer's derived SQLite (WAL → concurrent with rebuilds); when
  // the DB is absent/corrupt the endpoint reports available:false and the
  // client falls back to its in-memory scan. The `related` (semantic) section
  // arrives in stage 5 — the shape is final today so the client won't change.
  if (p === '/api/search') {
    const qp = new URL(req.url, 'http://localhost').searchParams
    const raw = (qp.get('q') ?? '').trim()
    const limit = Math.min(Number(qp.get('limit')) || 30, 100)
    // scope: ?type=blog (the Blog tab's search bar) or ?type=message — omit
    // for the Talk page's everything-search
    const scope = qp.get('type') === 'blog' || qp.get('type') === 'message' ? qp.get('type') : null
    const t0 = Date.now()
    // stage 3: match readings, not just surface text. Normalize the query the
    // same way the indexer normalized the readings: katakana → hiragana (incl.
    // half-width kana), latin lowercased. Surface columns match the raw query,
    // reading columns match the normalized one — one MATCH covers both.
    const kataToHira = (s) => s
      .replace(/[ｦ-ﾟ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)) // half-width kana
      .replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)) // katakana
      .toLowerCase()
    const normalized = kataToHira(raw)
    const tokens = normalized ? await getTokenizer().then((t) => t ?? null).catch(() => null) : null
    const empty = { available: false, exact: [], related: [], took_ms: 0 }
    if (!raw) return sendJson(res, 200, { ...empty, available: true })
    let db = null
    try {
      if (fs.existsSync(DB_PATH)) {
        db = new DatabaseSync(DB_PATH, { readOnly: true, allowExtension: true })
        try {
          const vec = await import('sqlite-vec')
          vec.load(db)
        } catch (e) {
          say(`! sqlite-vec unavailable on the server (${e.message}) — related stays empty`)
        }
      }
    } catch (e) {
      say(`! search DB unreadable (${e.message}) — client falls back`)
    }
    if (!db) return sendJson(res, 200, empty)

    try {
      const results = []
      const cps = [...raw]
      /* When the best match lives in the reading column (kana query vs kanji
         text), snippet(-1) happily shows the kana reading dump — replace it
         with a plain window over the real text so cards never show readings. */
      const realSnippet = (snip, baseText) => {
        const m = /<mark>([\s\S]*?)<\/mark>/.exec(snip)
        /* reading-column match (or no mark at all): find the kanji surface
           word whose kuromoji reading contains the query and mark IT
           (ひかり → 光) */
        if (!m || !baseText.toLowerCase().includes(m[1].toLowerCase())) {
          if (tokens) {
            for (const tok of tokens.tokens(baseText)) {
              const reading = tok.reading ? kataToHira(tok.reading) : ''
              if (reading.includes(normalized) && tok.surface_form && baseText.includes(tok.surface_form)) {
                const surface = tok.surface_form
                const i = baseText.indexOf(surface)
                const start = Math.max(0, i - 30)
                return (
                  (start > 0 ? '…' : '') +
                  baseText.slice(start, i + Math.max(surface.length, 60)).replace(surface, () => `<mark>${surface}</mark>`) +
                  (i + Math.max(surface.length, 60) < baseText.length ? '…' : '')
                )
              }
            }
          }
          if (!m) return snip
        }
        const hit = m[1]
        const needle = [raw, normalized].find((n) => baseText.toLowerCase().includes(n.toLowerCase())) ?? null
        if (!needle) return baseText.slice(0, 100) + (baseText.length > 100 ? '…' : '')
        const i = baseText.toLowerCase().indexOf(needle.toLowerCase())
        const start = Math.max(0, i - 30)
        return (
          (start > 0 ? '…' : '') +
          baseText.slice(start, i + Math.max(needle.length, 60)).replace(needle, () => `<mark>${needle}</mark>`) +
          (i + Math.max(needle.length, 60) < baseText.length ? '…' : '')
        )
      }
      if (cps.length >= 3) {
        // trigram phrase == exact substring; quotes doubled for FTS safety.
        // Column weights (title, body, reading / text, reading): surface hits
        // rank well above reading-only hits.
        if (scope !== 'message') {
          const posts = db
          .prepare(
            `SELECT p.member_key AS "key", p.site, p.post_id AS id, p.title, p.member_name AS member,
                    p.at, p.body, bm25(posts_fts, 10.0, 10.0, 1.0) AS score,
                    snippet(posts_fts, -1, '<mark>', '</mark>', '…', 16) AS snippet
             FROM posts_fts JOIN posts p ON p.rowid = posts_fts.rowid
             WHERE posts_fts MATCH ? ORDER BY score LIMIT ?`,
          )
          .all(`"${raw.replaceAll('"', '""')}" OR "${normalized.replaceAll('"', '""')}"`, limit)
          for (const r of posts) {
            r.snippet = realSnippet(r.snippet, `${r.title ?? ''} ${r.body ?? ''}`)
            results.push({ type: 'blog', ...r })
          }
        }
        if (scope !== 'blog') {
          const msgs = db
          .prepare(
            `SELECT m.slug, m.msg_id AS id, m.at, m.type, bm25(messages_fts, 10.0, 1.0) AS score,
                    snippet(messages_fts, 0, '<mark>', '</mark>', '…', 16) AS snippet
             FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid
             WHERE messages_fts MATCH ? ORDER BY score LIMIT ?`,
          )
          .all(`"${raw.replaceAll('"', '""')}" OR "${normalized.replaceAll('"', '""')}"`, limit)
          // slug → display name/site comes from the JSON index (search DB stays name-free)
          const members = new Map(
            (JSON.parse(readIndexJson() ?? '[]')?.members ?? []).map((m) => [m.slug, m]),
          )
          for (const r of msgs) {
            const mem = members.get(r.slug)
            const text = (mem?.messages ?? []).find((m) => m.id === r.id)?.text ?? ''
            results.push({
              type: 'message',
              slug: r.slug,
              id: r.id,
              at: r.at,
              mtype: r.type,
              member: mem ? (mem.roman ?? mem.name) : r.slug.replace(/_/g, ' '),
              site: mem?.site ?? null,
              avatar: mem?.avatar ?? null,
              score: r.score,
              snippet: realSnippet(r.snippet, text),
            })
          }
        }
      } else {
        // <3 code points: below the trigram minimum — instr() scan instead
        // (over surface AND reading columns)
        if (scope !== 'message') {
          const posts = db
            .prepare(
              `SELECT member_key AS "key", site, post_id AS id, title, member_name AS member, at, body, reading
               FROM posts WHERE instr(title, ?) > 0 OR instr(body, ?) > 0 OR instr(reading, ?) > 0 LIMIT ?`,
            )
            .all(raw, raw, normalized, limit)
          for (const r of posts) {
            const hay = r.title.includes(raw) ? r.title : r.body
            const i = hay.indexOf(raw)
            const start = Math.max(0, i - 30)
            results.push({
              type: 'blog',
              ...r,
              score: 0,
              snippet: i < 0
                ? (r.reading ?? '').slice(0, 60)
                : (start > 0 ? '…' : '') +
                  hay.slice(start, i + raw.length + 60).replace(raw, () => `<mark>${raw}</mark>`) +
                  (i + raw.length + 60 < hay.length ? '…' : ''),
            })
          }
        }
        if (scope !== 'blog') {
          const msgs = db
            .prepare(
              `SELECT slug, msg_id AS id, at, type, reading FROM messages WHERE instr(text, ?) > 0 OR instr(reading, ?) > 0 LIMIT ?`,
            )
            .all(raw, normalized, limit)
          const members = new Map(
            (JSON.parse(readIndexJson() ?? '[]')?.members ?? []).map((m) => [m.slug, m]),
          )
          for (const r of msgs) {
            const mem = members.get(r.slug)
            const text = (mem?.messages ?? []).find((m) => m.id === r.id)?.text ?? ''
            const i = text.indexOf(raw)
            const start = Math.max(0, i - 30)
            results.push({
              type: 'message',
              slug: r.slug,
              id: r.id,
              at: r.at,
              mtype: r.type,
              member: mem ? (mem.roman ?? mem.name) : r.slug.replace(/_/g, ' '),
              site: mem?.site ?? null,
              avatar: mem?.avatar ?? null,
              score: 0,
              snippet: i < 0
                ? text.slice(0, 80) + (text.length > 80 ? '…' : '')
                : (start > 0 ? '…' : '') +
                  text.slice(start, i + raw.length + 60).replace(raw, () => `<mark>${raw}</mark>`) +
                  (i + raw.length + 60 < text.length ? '…' : ''),
            })
          }
        }
      }
      results.sort((a, b) => a.score - b.score) // bm25: lower (more negative) = better
      // stage 5/6: the related (semantic) section — blog posts near the query
      // in embedding space (chunked, vec_posts) plus whole-message vectors
      // (vec_messages). Never fused with exact; exact hits are deduped out.
      const related = []
      const embedder = await getEmbedder()
      if (embedder) {
        const qv = await embedder.query(raw).catch(() => null)
        if (qv) {
          const qbuf = Buffer.from(qv.buffer, qv.byteOffset, qv.byteLength)
          const dists = []
          try {
            const members = new Map(
              (JSON.parse(readIndexJson() ?? '[]')?.members ?? []).map((m) => [m.slug, m]),
            )
            const knnPosts = db
              .prepare(`SELECT rowid, distance FROM vec_posts WHERE embedding MATCH ? ORDER BY distance LIMIT 60`)
              .all(qbuf)
            const resolve = db.prepare(
              `SELECT p.member_key AS "key", p.site, p.post_id AS id, p.title, p.member_name AS member, p.at, p.body
               FROM post_chunks c JOIN posts p ON p.rowid = c.post_rowid WHERE c.vec_rowid = ?`,
            )
            const byPost = new Map()
            for (const k of knnPosts) {
              dists.push(k.distance)
              const p = resolve.get(k.rowid)
              if (!p) continue
              const cos = 1 - k.distance
              const kkey = `${p.key}/${p.id}`
              const cur = byPost.get(kkey)
              if (!cur || cos > cur.score) byPost.set(kkey, { ...p, score: cos })
            }
            const exactBlog = new Set(results.filter((r) => r.type === 'blog').map((r) => `${r.key}/${r.id}`))
            const exactMsg = new Set(results.filter((r) => r.type === 'message').map((r) => `${r.slug}/${r.id}`))
            /* the search scope applies to related too: Talk search gets messages,
               Blog search gets posts, the unscoped API search mixes both. Scores
               don't share a scale across corpora (passage-length bias), so each
               group ranks with its own gap rule + budget. */
            const blogCap = scope === 'blog' ? 20 : scope === 'message' ? 0 : BLOG_CAP
            const msgCap = scope === 'message' ? 20 : scope === 'blog' ? 0 : MSG_CAP
            const cand = [...byPost.values()]
              .filter((c) => !exactBlog.has(`${c.key}/${c.id}`) && c.score >= SEMANTIC_MIN_COS)
              .sort((a, b) => b.score - a.score)
            const best = cand[0]?.score ?? 0
            for (const c of cand) {
              if (c.score < best - SEMANTIC_GAP) break
              if (related.length >= blogCap) break
              related.push({
                type: 'blog',
                key: c.key,
                site: c.site,
                id: c.id,
                title: c.title,
                member: c.member,
                at: c.at,
                score: c.score,
                snippet: (c.body ?? '').slice(0, 120) + ((c.body ?? '').length > 120 ? '…' : ''),
              })
            }
            // stage 6: whole-message vectors (second rank group, same cutoffs)
            const knnMsgs = db
              .prepare(`SELECT rowid, distance FROM vec_messages WHERE embedding MATCH ? ORDER BY distance LIMIT 60`)
              .all(qbuf)
            const resolveMsg = db.prepare(
              `SELECT slug, msg_id AS id, at, type, text FROM messages WHERE vec_rowid = ?`,
            )
            const candMsg = []
            for (const k of knnMsgs) {
              dists.push(k.distance)
              const m = resolveMsg.get(k.rowid)
              if (!m) continue
              const cos = 1 - k.distance
              if (exactMsg.has(`${m.slug}/${m.id}`) || cos < SEMANTIC_MIN_COS) continue
              const mem = members.get(m.slug)
              candMsg.push({
                type: 'message',
                slug: m.slug,
                id: m.id,
                at: m.at,
                mtype: m.type,
                member: mem ? (mem.roman ?? mem.name) : m.slug.replace(/_/g, ' '),
                site: mem?.site ?? null,
                avatar: mem?.avatar ?? null,
                score: cos,
                snippet: (m.text ?? '').slice(0, 120) + ((m.text ?? '').length > 120 ? '…' : ''),
              })
            }
            candMsg.sort((a, b) => b.score - a.score)
            const bestMsg = candMsg[0]?.score ?? 0
            for (const c of candMsg) {
              if (c.score < bestMsg - SEMANTIC_GAP) break
              if (related.length >= blogCap + msgCap) break
              related.push(c)
            }
            /* group order is preserved (blog first, then messages) — the client
               renders them as separate subsections; no cross-corpus merge sort,
               the scores aren't comparable */
            if (SEMANTIC_LOG && dists.length) {
              const sorted = [...dists].sort((a, b) => a - b).map((d) => (1 - d).toFixed(3))
              say(`semantic: "${raw}" n=${dists.length} cos ${sorted[0]}…${sorted.slice(0, 20).join(' ')} min=${sorted.at(-1)}`)
            }
          } catch (e) {
            say(`! related search failed (${e.message}) — exact section unaffected`)
          }
        }
      }
      return sendJson(res, 200, { available: true, exact: results.slice(0, limit), related, took_ms: Date.now() - t0 })
    } catch (e) {
      say(`! /api/search failed (${e.message})`)
      return sendJson(res, 200, empty)
    }
  }

  // --- session-cookie upload + status (bearer-gated; 404 unless configured) ---
  if (p.startsWith('/api/secrets/')) {
    if (!UPLOAD_TOKEN) return sendJson(res, 404, { error: 'disabled (UPLOAD_TOKEN not set)' })

    if (p === '/api/secrets/session' && req.method === 'POST') {
      if (!authorized(req)) {
        audit('upload rejected (bad token)')
        return sendJson(res, 401, { error: 'unauthorized' })
      }
      let body
      try {
        body = JSON.parse((await readBody(req)) || '{}')
      } catch (e) {
        audit(`upload rejected (${e.message})`)
        return sendJson(res, e.status ?? 400, { error: e.message })
      }
      const { site, cookie } = body ?? {}
      if (!COOKIE_FILES[site]) {
        audit('upload rejected (unknown site)')
        return sendJson(res, 400, { error: `unknown site; expected one of ${Object.keys(COOKIE_FILES).join(', ')}` })
      }
      if (typeof cookie !== 'string' || !UUID_RE.test(cookie.trim())) {
        audit(`upload rejected (bad cookie shape) for ${site}`)
        return sendJson(res, 400, { error: 'cookie must be the session uuid' })
      }
      fs.mkdirSync(LOGS, { recursive: true })
      const file = path.join(LOGS, COOKIE_FILES[site])
      fs.writeFileSync(file + '.tmp', cookie.trim())
      fs.renameSync(file + '.tmp', file)
      audit(`cookie uploaded for ${site}`)
      return sendJson(res, 200, { ok: true, site })
    }

    if (p === '/api/secrets/status') {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      return sendJson(res, 200, { sites: sessionStatus() })
    }

    return sendJson(res, 404, { error: 'unknown api route' })
  }

  // --- blog posts (tools/grab-blog.py output) — bodies stay on disk and are
  //     fetched lazily: the list strips content to a plain-text lead, the
  //     detail endpoint returns the full HTML for one post
  /* strip tags for the two-line lead. Official blog posts embed mail-app CSS
     (p.p1 {margin: ...}) inside <style> blocks — drop block CONTENT first or
     every lead would start with CSS (same rule as build-index's stripHtml) */
  const blogLead = (html) =>
    html
      ? html
          .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
          .replace(/<[^>]*>/g, ' ')
          .replace(/&[a-z#0-9]+;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 140)
      : null

  // /api/blog — the official app's "sort by upload time" view: the newest
  // posts across EVERY archived member in one feed. ?site=<key> filters to
  // one site, ?limit= caps the response (default 60, max 200), ?order=asc
  // flips to oldest-first. Reads each member's _blogs.json (small files;
  // directory metadata only, no bodies).
  /* blog member dirs live at media/<site>/blogs/<key>/blog (group-first
     layout); the legacy flat tree media/blogs/<key> is still honored so the
     server works before and after a migration. blogMedia() builds /media URLs
     that match wherever the member's dir physically is. */
  const blogRoots = () => {
    const roots = []
    try {
      for (const d of fs.readdirSync(MEDIA, { withFileTypes: true }))
        if (d.isDirectory() && d.name !== 'blogs' && !d.name.startsWith('.'))
          roots.push({ root: path.join(MEDIA, d.name, 'blogs'), site: d.name })
    } catch {}
    roots.push({ root: path.join(MEDIA, 'blogs'), site: null }) // legacy flat tree
    return roots.filter((r) => fs.existsSync(r.root))
  }
  const blogMedia = (site, key, rest) =>
    site
      ? `/media/${site}/blogs/${encodeURIComponent(key)}/blog/${rest}`
      : `/media/blogs/${encodeURIComponent(key)}/blog/${rest}`

  if (p === '/api/blog' || p === '/api/blog/') {
    const q = new URL(req.url, 'http://x').searchParams
    const site = q.get('site')
    const limit = Math.min(Number(q.get('limit')) || 60, 200)
    /* stage 6: read the feed from the search DB when possible — O(1) instead
       of re-reading every member's _blogs.json per request. Falls back to the
       file scan whenever the DB is absent/corrupt (graceful, as always). */
    let feed = null
    try {
      const sdb = getFeedDb()
      if (sdb) {
        feed = sdb
          .prepare(
            `SELECT member_key AS "key", post_id AS id, title, at, member_name AS member, site, thumb, body
             FROM posts ${site ? 'WHERE site = ?' : ''} ORDER BY at DESC LIMIT ?`,
          )
          .all(...(site ? [site] : []), limit)
          .map((r) => ({
            key: r.key,
            member: r.member,
            site: r.site,
            id: r.id,
            title: r.title,
            at: r.at,
            thumbnail: r.thumb ? blogMedia(r.site, r.key, r.thumb) : null,
            lead: (r.body ?? '').slice(0, 140) || null, // body is stored HTML-stripped
          }))
      }
    } catch (e) {
      feed = null // corrupt DB / missing member dir — fall back below
    }
    if (feed) return sendJson(res, 200, { posts: feed })
    const posts = []
    for (const { root, site: rootSite } of blogRoots()) {
      for (const key of fs.readdirSync(root)) {
        let state = null
        try {
          state = JSON.parse(fs.readFileSync(path.join(root, key, 'blog', '_blogs.json'), 'utf8'))
        } catch {}
        if (!state?.entries?.length) continue
        if (site && (state.site ?? rootSite ?? '') !== site) continue
        for (const e of state.entries)
          posts.push({
            key,
            member: state.member ?? key.replace(/_/g, ' '),
            site: state.site ?? rootSite ?? null,
            id: e.id,
            title: e.title,
            at: e.at,
            thumbnail: e.thumbnail ? blogMedia(rootSite, key, e.thumbnail) : null,
            lead: blogLead(e.content),
          })
      }
    }
    // "YYYY/MM/DD HH:mm:ss" sorts lexicographically
    const desc = q.get('order') !== 'asc'
    posts.sort((a, b) => (a.at < b.at ? (desc ? 1 : -1) : a.at > b.at ? (desc ? -1 : 1) : 0))
    return sendJson(res, 200, { posts: posts.slice(0, limit) })
  }

  if (p.startsWith('/api/blog/')) {
    const safe = (s) => (s && !/[/\\]|^\.{1,2}$/.test(s) ? s : null)
    const key = safe(decodeURIComponent(p.split('/')[3] ?? ''))
    if (!key) return sendJson(res, 404, { error: 'no such blog' })
    // 川﨑/崎: U+FA11 has no NFKC decomposition in V8, so fold it manually —
    // some keyboards/URL bars hand back the plain 崎 form
    const fold = (s) => s.normalize('NFKC').replace(/\uFA11/g, '\u5D0E')
    // resolve the member across site-scoped trees first, legacy flat tree last
    const found = (() => {
      for (const { root, site } of blogRoots()) {
        if (fs.existsSync(path.join(root, key))) return { root, dir: key, site }
        const hit = fs.readdirSync(root).find((d) => fold(d) === fold(key))
        if (hit) return { root, dir: hit, site }
      }
      return null
    })()
    if (!found) return sendJson(res, 404, { error: 'no such blog' })
    const dir = found.dir
    const file = path.join(found.root, dir, 'blog', '_blogs.json')
    let state
    try {
      state = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      return sendJson(res, 404, { error: 'no such blog' })
    }
    // grab-blog stores post images as bare "files/<n>" — prefix them so the
    // HTML can be dropped straight into the page (thumbnails likewise)
    const prefixLocal = (html, key) =>
      html
        ? html.replace(/(["'])(files\/)/g, `$1${blogMedia(found.site, key, '')}$2`)
        : html
    const parts = p.split('/').slice(3).map(decodeURIComponent)
    if (parts[1] != null) {
      const entry = (state.entries ?? []).find((e) => String(e.id) === parts[1])
      if (!entry) return sendJson(res, 404, { error: 'no such post' })
      return sendJson(res, 200, {
        key,
        member: state.member,
        site: state.site ?? found.site,
        entry: { ...entry, content: prefixLocal(entry.content, dir), lead: blogLead(entry.content) },
      })
    }
    return sendJson(res, 200, {
      key,
      member: state.member,
      site: state.site ?? found.site,
      entries: (state.entries ?? []).map(({ content, ...e }) => ({ ...e, lead: blogLead(content) })).reverse(),
    })
  }

  if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'unknown api route' })

  // /media/** — the archive (Range-capable, decode percent-encoded slugs).
  // Strip the mount prefix before handing to sirv — same as vite's
  // middlewares.use('/media', serve()) did in the dev server.
  if (p === '/media') {
    res.writeHead(302, { Location: '/media/' })
    return res.end()
  }
  if (p.startsWith('/media/')) {
    req.url = req.url.slice('/media'.length)
    return mediaFiles(req, res)
  }

  // static: built bundle first, then runtime-built files (index.json, thumbs/)
  return distFiles(req, res, () => pubFiles(req, res, () => {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  }))
})

// ---------------------------------------------------------------- boot
say(`media: ${MEDIA}`)
say(`dist:  ${DIST}`)
say(`logs:  ${LOGS} (upload endpoint ${UPLOAD_TOKEN ? 'enabled' : 'disabled — no UPLOAD_TOKEN'})`)

// listen first, build second: /api/health is green immediately and the client
// gets the index as soon as the build lands (thumbs on a cold volume take a
// while — ffmpeg dominates)
app.listen(PORT, () => say(`listening on :${PORT}`))
buildIndex().then(() => {
  const watching = watchMedia()
  if (!watching) {
    // no fs-watch available (network volume etc.) — rebuild periodically as a
    // fallback; build-index skips the write when nothing changed, so clients
    // only reload if the archive content actually moved
    say('falling back to a 6h rebuild interval')
    setInterval(buildIndex, 6 * 60 * 60 * 1000).unref()
  }
})
