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
