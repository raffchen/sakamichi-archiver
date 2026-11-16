/* Blog bodies are stored verbatim from the official app's API (grab-blog.py
   doesn't rewrite HTML) and come in three shapes — even within one member's
   archive, so this is detected per post:
     1. line-per-<div>                       (~44% of posts — already safe)
     2. one big <p>, lines split by <br>     (~34% — translation-hostile)
     3. raw text/images split by <br>        (~15% — translation-hostile)
   plus legacy captures wrapped in full <html> documents (~2%).

   Google Translate (page translation) translates per block-level element and
   drops inline <br>s, so shapes 2 and 3 collapse into one big paragraph.
   normalizeBlogContent() splits <br>-separated runs into their own <div>
   blocks before the HTML hits {@html} — every line then becomes an
   independently translatable block and the line structure survives. Blank
   lines become <div><br></div>, the same one-line spacer a bare <br> after a
   block element renders as. Shape 1 (and any subtree without <br>) passes
   through untouched, so the output is stable/idempotent. */

const INLINE = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'CODE', 'DATA', 'DFN', 'EM', 'FONT',
  'I', 'KBD', 'MARK', 'Q', 'RB', 'RP', 'RT', 'S', 'SAMP', 'SMALL', 'SPAN',
  'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'WBR',
])

const isElem = (n: Node): n is Element => n.nodeType === 1
const isBr = (n: Node) => isElem(n) && (n as Element).tagName === 'BR'
/** whitespace-only text — or an element carrying no visible content at all
    (upstream encodes blank lines as empty <span>s) — renders as nothing */
const isBlank = (n: Node): boolean => {
  if (n.nodeType === 3) return !(n.textContent ?? '').trim()
  if (!isElem(n)) return false
  const el = n as Element
  if (el.tagName === 'IMG' || el.querySelector('img, video, iframe, svg, canvas, picture')) return false
  return !(el.textContent ?? '').trim()
}

/** split a child-node stream into block elements at <br> boundaries */
function blocks(doc: Document, nodes: Node[]): Element[] {
  const out: Element[] = []
  let run: Node[] = []
  const flush = (byBr: boolean) => {
    const blank = run.every(isBlank)
    // a flush that isn't caused by a <br> separator (e.g. an <img> starting
    // its own block) must not invent a blank line out of an empty run
    if (!byBr && (blank || !run.length)) {
      run = []
      return
    }
    const div = doc.createElement('div')
    if (blank) div.appendChild(doc.createElement('br'))
    else for (const n of run) div.appendChild(n)
    out.push(div)
    run = []
  }
  for (const n of nodes) {
    if (isBr(n)) {
      flush(true)
    } else if (n.nodeType === 3 || (isElem(n) && INLINE.has((n as Element).tagName))) {
      // inline content accumulates into a run — unless it wraps a <br>, in
      // which case it dissolves so its lines split too
      if (isElem(n) && (n as Element).querySelector('br')) {
        flush(false)
        out.push(...blocks(doc, [...(n as Element).childNodes]))
      } else {
        run.push(n)
      }
    } else if (isElem(n)) {
      // block-level element: its own translation block
      flush(false)
      const el = n as Element
      if (el.querySelector('br')) out.push(...blocks(doc, [...el.childNodes]))
      else out.push(el) // untouched subtree — nothing here can collapse
    } else {
      run.push(n) // comments and the like ride along with the text
    }
  }
  flush(false) // skips empty/blank runs — drops a trailing <br> like the source rendered it
  return out
}

/** upstream mail-app markup full-bleeds some photos: `width:
    calc(100% + 48px); margin-left: -24px` (Apple edge-to-edge export) — in
    the viewer that pushes the image past the left edge. Our CSS already fits
    (max-width: 100%) and centers (margin: 10px auto) content images, so drop
    the margin declarations from images and pure image wrappers and render
    them as if the upstream style wasn't there. Text margins stay. */
function stripImageMargins(root: ParentNode) {
  const targets = new Set<Element>([...root.querySelectorAll('img')])
  for (const el of [...root.querySelectorAll('*')]) {
    if (el !== root && !(el.textContent ?? '').trim() && el.querySelector('img')) targets.add(el)
  }
  for (const el of targets) {
    const style = el.getAttribute('style')
    if (!style || !/margin/i.test(style)) continue
    const kept = style
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d && !/^margin/i.test(d))
      .join('; ')
    if (kept) el.setAttribute('style', kept)
    else el.removeAttribute('style')
  }
}

/** rewrite translation-hostile bodies into line-per-block HTML (no-op when
    there's no <br> anywhere, and for subtrees that are already block-per-line) */
export function normalizeBlogContent(html: string): string {
  if (!html) return html
  // fast path: nothing can collapse (no <br>, not a legacy <html> document)
  // and no inline margins to strip — leave the string untouched
  if (!/<br[\s/>]/i.test(html) && !/^<(!doctype|html)/i.test(html.trim()) && !/margin/i.test(html))
    return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  // parsing full <html> documents (legacy captures) drops head/meta for us
  const frag = doc.createElement('div')
  for (const el of blocks(doc, [...doc.body.childNodes])) frag.appendChild(el)
  stripImageMargins(frag)
  return frag.innerHTML
}
