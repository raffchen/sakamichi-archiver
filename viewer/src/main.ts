import { mount } from 'svelte'
import App from './App.svelte'
import { getArchive, setArchive } from './lib/store.svelte'
import './app.css'
// Font Awesome for the header buttons — served locally by Vite, no CDN
import '@fortawesome/fontawesome-free/css/fontawesome.min.css'
import '@fortawesome/fontawesome-free/css/solid.min.css'

const target = document.getElementById('app')
if (!target) throw new Error('#app missing')

/**
 * Load the archive. The production server exposes it at /api/index (rebuilt
 * live as the syncer lands files); in `vite dev`/`preview` the generated
 * public/index.json is served at /index.json. Try both.
 */
async function loadArchive(): Promise<ReturnType<typeof JSON.parse>> {
  let lastErr: unknown = null
  for (const url of ['/api/index', '/index.json']) {
    try {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
      return await r.json()
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

/** Track the loaded index generation and swap in a fresh archive when the
    server rebuilds it — no page reload (docs/inplace-reindex.md): playback,
    volume, scroll and the open thread all survive; setArchive drops stale
    full-text caches. Polls /api/version (server only — vite dev 404s it and
    polling disables itself); only fetches while the tab is visible. */
function watchForReindex() {
  let known = getArchive()?.generated_at ?? null
  let disabled = false
  const tick = async () => {
    if (disabled || document.visibilityState !== 'visible') return
    try {
      const r = await fetch('/api/version')
      if (r.status === 404) {
        disabled = true // not running behind server.mjs (vite dev) — stop
        return
      }
      if (!r.ok) return
      const v = await r.json()
      if (!v.generated_at || v.generated_at === known) return
      if (localStorage.getItem('sakamichi-viewer:no-swap')) {
        location.reload() // kill switch — the old hard-reload behavior
        return
      }
      try {
        setArchive(await loadArchive())
        known = getArchive()?.generated_at ?? null
      } catch {
        /* swap fetch failed — keep the current archive, the next poll retries */
      }
    } catch {
      /* server briefly unreachable — keep polling */
    }
  }
  setInterval(tick, 30_000)
  document.addEventListener('visibilitychange', tick)
}

loadArchive()
  .then((loaded) => {
    setArchive(loaded)
    watchForReindex()
    mount(App, { target })
  })
  .catch((err) => {
    target.innerHTML =
      `<div class="fatal"><h2>index が見つかりません</h2>` +
      `<p>${String(err?.message ?? err)}</p>` +
      `<p>The index is generated when the server starts and refreshed as new media arrives.</p></div>`
  })
