import { svelte } from '@sveltejs/vite-plugin-svelte'
import sirv from 'sirv'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'

const VIEWER = path.dirname(fileURLToPath(import.meta.url))
const MEDIA = path.resolve(VIEWER, '..', 'media')

/**
 * Rebuild public/index.json (and new thumbnails) whenever media/ changes —
 * e.g. after `python tools/grab-media.py` — then push a live reload to any
 * open viewer tabs. Debounced (one big sync writes hundreds of files), and
 * re-arms if edits land while a rebuild is still running.
 */
function watchArchive(): Plugin {
  let timer: ReturnType<typeof setTimeout> | null = null
  let rebuilding = false
  let dirtyDuringRebuild = false

  const schedule = (server: ViteDevServer) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (rebuilding) {
        dirtyDuringRebuild = true
        return
      }
      rebuilding = true
      const child = spawn(
        process.execPath,
        [path.join(VIEWER, 'scripts', 'build-index.mjs')],
        { stdio: 'inherit' },
      )
      child.on('exit', () => {
        rebuilding = false
        server.ws.send({ type: 'full-reload' })
        if (dirtyDuringRebuild) {
          dirtyDuringRebuild = false
          schedule(server)
        }
      })
    }, 1500)
  }

  return {
    name: 'watch-archive',
    configureServer(server) {
      server.watcher.add(MEDIA)
      // filter by path! the root watcher also fires for our own output
      // (public/index.json, thumbs) — reacting to those loops forever
      const onEv = (file: string) => {
        if (file && path.resolve(file).startsWith(MEDIA + path.sep))
          schedule(server)
      }
      for (const ev of ['change', 'add', 'unlink'] as const)
        server.watcher.on(ev, onEv)
    },
  }
}

/**
 * Serve the archive at /media/** straight from disk — no copy of ~180 MB.
 * Must support HTTP Range: <video>/<audio> seeking is impossible otherwise
 * (and note `python -m http.server` does NOT support Range — don't swap this out).
 * The folder names are Japanese, so paths arrive percent-encoded; sirv decodes them.
 */
function serveArchive() {
  const handler = {
    name: 'serve-archive',
    configureServer(server: any) {
      server.middlewares.use('/media', serve())
    },
    configurePreviewServer(server: any) {
      server.middlewares.use('/media', serve())
    },
  }
  return handler
}

const serve = () =>
  sirv(MEDIA, {
    dev: true,
    single: false,
    extensions: [],
    setHeaders(res, file) {
      // .jfif is JPEG; some CDNs serve it without a usable type
      if (/\.jfif$/i.test(file)) res.setHeader('Content-Type', 'image/jpeg')
      res.setHeader('Access-Control-Allow-Origin', '*')
    },
  })

export default defineConfig({
  plugins: [svelte(), serveArchive(), watchArchive()],
  server: {
    port: 5173,
    host: true, // browse from a phone on the LAN
    fs: { allow: ['..'] },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
