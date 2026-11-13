import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
// Font Awesome for the header buttons — served locally by Vite, no CDN
import '@fortawesome/fontawesome-free/css/fontawesome.min.css'
import '@fortawesome/fontawesome-free/css/solid.min.css'

const target = document.getElementById('app')
if (!target) throw new Error('#app missing')

fetch('/index.json')
  .then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })
  .then((archive) => mount(App, { target, props: { archive } }))
  .catch((err) => {
    target.innerHTML =
      `<div class="fatal"><h2>index.json が見つかりません</h2>` +
      `<p>${String(err?.message ?? err)}</p>` +
      `<p>Build it first: <code>cd viewer &amp;&amp; npm run index</code><br>` +
      `then <code>npm run dev</code> (the <code>predev</code> hook builds the index automatically).</p></div>`
  })
