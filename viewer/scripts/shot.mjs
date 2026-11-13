/* dev-only: drive the viewer in headless Chrome and screenshot each screen
   (node scripts/shot.mjs). Uses the CDP HTTP+WS endpoints directly. */
const CHROME =
  process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9323
const BASE = `http://localhost:5173`
const args = [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--disable-gpu',
  '--no-first-run',
  '--window-size=440,940',
  '--user-data-dir=' + process.env.TEMP + '\\cdp-shot-profile',
  'about:blank',
]
const { spawn } = await import('node:child_process')
const chrome = spawn(CHROME, args, { stdio: 'ignore' })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let ws
async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      const page = list.find((t) => t.type === 'page')
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)))
        return
      }
    } catch {}
    await wait(250)
  }
  throw new Error('chrome devtools not reachable')
}
let id = 0
const pend = new Map()
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const n = ++id
    pend.set(n, { resolve, reject })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
}
ws = null
await connect()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pend.has(m.id)) {
    const { resolve, reject } = pend.get(m.id)
    pend.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
}
await send('Page.enable')
await send('Runtime.enable')

async function nav(url, sel, ms = 900) {
  await send('Page.navigate', { url: 'about:blank' })
  await wait(250)
  await send('Page.navigate', { url })
  for (let i = 0; i < 40; i++) {
    const { result } = await send('Runtime.evaluate', {
      expression: `!!document.querySelector(${JSON.stringify(sel)})`,
      returnByValue: true,
    })
    if (result.value) break
    await wait(150)
  }
  await wait(ms)
}
async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  const fs = await import('node:fs')
  fs.writeFileSync(`shot-${name}.png`, Buffer.from(data, 'base64'))
  console.log('wrote shot-' + name + '.png')
}
async function js(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) console.log('JS error:', r.exceptionDetails.text)
  return r.result?.value
}

const slug = encodeURIComponent(process.argv[2] ?? '山川_宇衣')
const slugI = encodeURIComponent(process.argv[3] ?? '池田_瑛紗')

// fresh "seen" state every run — otherwise unread pills depend on prior runs
// (must run on the app's origin; localStorage is per-origin)
await nav(`${BASE}/#/`, '.grid', 400)
await js(`localStorage.clear()`)
await send('Page.navigate', { url: 'about:blank' })
await wait(250)
await nav(`${BASE}/#/`, '.grid', 700)
await shot('1-home-nogizaka')

await nav(`${BASE}/#/site/sakurazaka46`, '.grid', 700)
await shot('2-home-sakurazaka')

await nav(`${BASE}/#/thread/${slug}`, '.msg', 1200)
await shot('3-thread-sakurazaka')

console.log('scroll top:', await js(`(()=>{const s=document.querySelector('.screen');s.scrollTop=0;return s.scrollTop})()`))
await wait(1200)
await shot('4-thread-top')

await nav(`${BASE}/#/gallery/${slug}`, '.masonry', 900)
await shot('5-gallery')

await nav(`${BASE}/#/thread/${slugI}`, '.msg', 900)
await js(`document.querySelector('.shot-btn').click()`)
await wait(900)
await shot('6-lightbox')
console.log('lightbox count:', await js(`document.querySelector('.lb-top span')?.textContent`))

await js(`document.querySelector('.lb .x').click()`)
await nav(`${BASE}/#/search`, 'input', 500)
await js(`(()=>{const i=document.querySelector('input');i.value='おやすみ';i.dispatchEvent(new Event('input',{bubbles:true}))})()`)
await wait(700)
await shot('7-search')

// voice message player, deep-linked
const voice = process.argv[4] ?? '365682'
await nav(`${BASE}/#/thread/${slug}/${voice}`, '.msg.voice', 1000)
await js(`document.querySelector('.msg.voice .go')?.click()`)
await js(`(() => { const v = document.querySelector('.msg.voice .vol-slider'); v.value = 0.3; v.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
await js(`document.querySelector('.msg.voice .vol-toggle')?.click()`)
await wait(1500)
await shot('8-voice')

// video in the lightbox: deep-link onto a video message so it is definitely rendered
const vid = process.argv[5] ?? '365521'
await nav(`${BASE}/#/thread/${slug}/${vid}`, '.msg.video', 1000)
console.log('video msgs:', await js(`document.querySelectorAll('.msg.video').length`),
  'play btns:', await js(`document.querySelectorAll('.msg.video .play').length`),
  'wrap html:', await js(`document.querySelector('.video-wrap')?.innerHTML.slice(0,120)`))
await js(`document.querySelector('.msg.video .play')?.click()`)
await wait(2000)
console.log('lb open:', await js(`!!document.querySelector('.lb')`), await js(`document.querySelector('.lb-top span')?.textContent`))
await shot('9-video-lightbox')
await js(`document.querySelector('.lb .x')?.click()`)

// archive info sheet
await nav(`${BASE}/#/`, '.grid', 600)
await js(`document.querySelectorAll('.tabs button')[document.querySelectorAll('.tabs button').length-1].click()`)
await wait(700)
await shot('10-infosheet')

console.log('console/page errors:', await js(`window.__err ?? 'none'`))
chrome.kill()
process.exit(0)
