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
import sirv from 'sirv'

const VIEWER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(VIEWER, '..')
const MEDIA = path.resolve(process.env.MEDIA_DIR || path.join(ROOT, 'media'))
const DIST = path.resolve(process.env.DIST_DIR || path.join(VIEWER, 'dist'))
const PUB = path.resolve(process.env.PUBLIC_DIR || path.join(VIEWER, 'public'))
const LOGS = path.resolve(process.env.LOGS_DIR || path.join(ROOT, 'logs'))
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || ''
const PORT = Number(process.env.PORT || 8080)
const INDEX = path.join(PUB, 'index.json')

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

  if (p === '/api/version') {
    const raw = readIndexJson()
    if (!raw) return sendJson(res, 404, { error: 'no index yet' })
    try {
      return sendJson(res, 200, { generated_at: JSON.parse(raw).generated_at })
    } catch {
      return sendJson(res, 500, { error: 'index unreadable' })
    }
  }

  if (p === '/api/index') {
    const raw = readIndexJson()
    if (!raw) return sendJson(res, 404, { error: 'no index yet (build-index pending or failed)' })
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    })
    return res.end(raw)
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
    // fallback; note this bumps generated_at and triggers client reloads
    say('falling back to a 6h rebuild interval')
    setInterval(buildIndex, 6 * 60 * 60 * 1000).unref()
  }
})
