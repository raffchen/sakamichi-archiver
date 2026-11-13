import { mount } from 'svelte'
import App from './App.svelte'
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

/** Track the loaded index generation and reload when the server rebuilds it.
    Polls /api/version (server only — vite dev 404s it and polling disables
    itself); only fetches while the tab is visible. */
function watchForReindex(archive: { generated_at?: string }) {
  if (!archive.generated_at) return
  const known = archive.generated_at
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
      if (v.generated_at && v.generated_at !== known) location.reload()
    } catch {
      /* server briefly unreachable — keep polling */
    }
  }
  setInterval(tick, 30_000)
  document.addEventListener('visibilitychange', tick)
}

loadArchive()
  .then((archive) => {
    watchForReindex(archive)
    mount(App, { target, props: { archive } })
  })
  .catch((err) => {
    target.innerHTML =
      `<div class="fatal"><h2>index.json が見つかりません</h2>` +
      `<p>${String(err?.message ?? err)}</p>` +
      `<p>Build it first: <code>cd viewer &amp;&amp; npm run index</code><br>` +
      `then <code>npm run dev</code> (the <code>predev</code> hook builds the index automatically).</p></div>`
  })
