/* dev-only: verify lightbox nav + backdrop close at desktop size (node scripts/wide-lb.mjs) */
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9328
const { spawn } = await import('node:child_process')
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-first-run', 'about:blank'], { stdio: 'ignore' })
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
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'http://localhost:5173/#/thread/%E6%B1%A0%E7%94%B0_%E7%91%9B%E7%B4%97' })
await wait(2000)
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true })).result?.value
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await wait(400)
}
console.log('thread ready:', await ev(`!!document.querySelector('.shot-btn')`), '| msgs:', await ev(`document.querySelectorAll('.msg').length`))
await ev(`document.querySelector('.shot-btn')?.click()`)
await wait(1200)
console.log('lb open after shot-btn:', await ev(`!!document.querySelector('.lb')`), '| counter:', await ev(`document.querySelector('.lb-top span')?.textContent`))
// step left until the first item
while (await ev(`!!document.querySelector('.lb-glyph.l')`)) await click(365, 540)
console.log('at first item, left chip gone?', await ev(`document.querySelector('.lb-top span')?.textContent`))
// step right until the last item
while (await ev(`!!document.querySelector('.lb-glyph.r')`)) await click(1555, 540)
console.log('at last item, right chip gone?', await ev(`document.querySelector('.lb-top span')?.textContent`))
const xpos = await ev(`(() => { const r = document.querySelector('.lb-top .x').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`)
await click(Math.round(xpos[0]), Math.round(xpos[1]))
console.log('after X click, lightbox still open?', await ev(`!!document.querySelector('.lb')`))
// reopen and test backdrop click
await ev(`document.querySelector('.shot-btn')?.click()`)
await wait(1000)
console.log('reopened:', await ev(`!!document.querySelector('.lb')`))
await click(60, 540)
console.log('backdrop click closed lb?', await ev(`!document.querySelector('.lb')`), '| back on thread:', await ev(`!!document.querySelector('.msg')`))
const { data } = await send('Page.captureScreenshot', { format: 'png' })
;(await import('node:fs')).writeFileSync('shot-14-lb-full.png', Buffer.from(data, 'base64'))
console.log('wrote shot-14-lb-full.png')
chrome.kill(); process.exit(0)
