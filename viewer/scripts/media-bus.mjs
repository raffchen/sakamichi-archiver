/* dev-only: verify only-one-media-playing (node scripts/media-bus.mjs) */
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9335
const { spawn } = await import('node:child_process')
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-first-run', '--window-size=440,940', 'about:blank'], { stdio: 'ignore' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let ws
for (let i = 0; i < 40; i++) {
  try {
    const l = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
    const p = l.find((t) => t.type === 'page')
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej))); break }
  } catch {}
  await wait(250)
}
let id = 0
const pend = new Map()
const send = (m, p = {}) => new Promise((res, rej) => { const n = ++id; pend.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p })) })
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) } }
await send('Page.enable'); await send('Runtime.enable')
// 山川_宇衣 thread focused on a voice message; a video message also exists in view
await send('Page.navigate', { url: 'http://localhost:5173/#/thread/%E5%B1%B1%E5%B7%9D_%E5%AE%87%E8%A1%A3/365682' })
await wait(2200)
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.value
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await wait(400)
}
const r = await ev(`(() => { const b = document.querySelector('.msg.voice .go').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] })()`)
await click(Math.round(r[0]), Math.round(r[1]))
await wait(1200)
console.log('1. voice playing:', await ev(`(() => { const a = document.querySelector('.msg.voice audio'); return !a.paused })()`))
// open the lightbox on the video message (opens in same thread view)
await ev(`(() => { const btn = document.querySelector('.msg.video .play'); btn?.click() })()`)
await wait(2000)
console.log('2. lightbox video playing:', await ev(`(() => { const v = document.querySelector('.lb video'); return v ? !v.paused : 'no video' })()`))
console.log('3. voice after video started:', await ev(`(() => { const a = document.querySelector('.msg.voice audio'); return a.paused ? 'paused' : 'STILL PLAYING' })()`))
// close the lightbox while the video is playing
await ev(`document.querySelector('.lb .x')?.click()`)
await wait(800)
console.log('4. video after lightbox closed:', await ev(`(() => { const v = document.querySelector('.lb video'); return v ? (!v.paused ? 'STILL PLAYING' : 'paused') : 'removed+paused' })()`))
chrome.kill(); process.exit(0)
