/* Semantic-search evaluation harness (dev-only, not part of the build).

   Scores embedding-model + blog-chunking configurations for the `related`
   section against three query sets:
     - title    : a post's cleaned title must retrieve that post (title signal)
     - excerpt  : a 40-char window from the middle of the body must retrieve
                  that post (body localization / chunking granularity)
     - labeled  : hand-written paraphrase + cross-lingual queries with recorded
                  targets — scripts/eval-queries.json (see its `note`)
   Also reports the cosine scale of title-only vectors vs body chunks (the
   calibration risk when both share one threshold/rank list).

   Model variants (pooling/prefixes handled per model):
     --model=e5       Xenova/multilingual-e5-small          (384d, mean, q:/p:)
     --model=granite  yuiseki/granite-embedding-278m-multilingual-ONNX (768d, cls)
     --model=bge      Xenova/bge-m3                          (1024d, cls)

   Run from viewer/:
     node --no-warnings scripts/eval-semantic.mjs --model=e5 [--limit=N]
   Vectors are computed in memory with the real q8 ONNX models; nothing is
   written to the search DB. Findings are summarised in ../README.md
   ("Semantic model evaluation"). */
import { DatabaseSync } from 'node:sqlite'
import { pipeline, env } from '@huggingface/transformers'

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? Number(hit.split('=')[1]) : dflt
}
const strArg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}

/* Model registry. Pooling/prefixes matter for validity:
   - e5-* : mean pooling, "query: "/"passage: " prefixes
   - bge-m3, granite-embedding-*: CLS pooling + L2 norm, no prefixes */
const MODELS = {
  e5: { id: 'Xenova/multilingual-e5-small', pooling: 'mean', q: 'query: ', p: 'passage: ' },
  bge: { id: 'Xenova/bge-m3', pooling: 'cls', q: '', p: '' },
  granite: { id: 'yuiseki/granite-embedding-278m-multilingual-ONNX', pooling: 'cls', q: '', p: '' },
}
const MODEL_KEY = strArg('model', 'e5')
const SPEC = MODELS[MODEL_KEY]
if (!SPEC) throw new Error(`unknown model ${MODEL_KEY} (have: ${Object.keys(MODELS).join(', ')})`)

/* ---------------- chunking (mirrors db.mjs chunkText, configurable) ------- */
function chunkText(text, size, overlap, sep) {
  const body = String(text ?? '').trim()
  if (!body) return []
  const sentences = body.split(/(?<=[。！？!?\n])/)
  const out = []
  let cur = ''
  for (const s of sentences) {
    if (s.length > size) {
      if (cur) { out.push(cur.trim()); cur = '' }
      for (let i = 0; i < s.length; i += size - overlap) out.push(s.slice(i, i + size).trim())
      continue
    }
    if ((cur + sep + s).trim().length > size) {
      if (cur) out.push(cur.trim())
      cur = s
    } else cur = (cur + sep + s).trim()
    if (cur.length >= size - overlap) { out.push(cur); cur = '' }
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(Boolean)
}

/* ---------------- load posts --------------------------------------------- */
const db = new DatabaseSync(new URL('../public/index.sqlite', import.meta.url).pathname, { readOnly: true })
const all = db
  .prepare('SELECT member_key AS mk, post_id AS id, member_name AS mn, title, body FROM posts')
  .all()
const limit = arg('limit', 0)
const posts = (limit ? all.slice(0, limit) : all).map((r) => ({
  key: `${r.mk}\u0000${r.id}`,
  title: (r.title ?? '').trim(),
  body: (r.body ?? '').trim(),
  mn: (r.mn ?? '').replace(/\s+/g, ''),
}))
console.log(`posts: ${posts.length}`)

/* cleaned title query: drop hashtags + the member name (whose spacing is
   inconsistent), collapse whitespace. Empty/too-short titles are skipped. */
function cleanTitle(p) {
  let t = p.title.replace(/#\S+/g, ' ')
  const tc = t.replace(/\s+/g, '')
  const i = p.mn ? tc.indexOf(p.mn) : -1
  if (i >= 0) t = tc.slice(0, i)
  return t.replace(/\s+/g, ' ').trim()
}

/* ---------------- queries ------------------------------------------------- */
const titleQ = []
const excerptQ = []
for (const p of posts) {
  const t = cleanTitle(p)
  if (t.length >= 3) titleQ.push({ q: t, rels: [p.key] })
  if (p.body.length >= 400) {
    const start = Math.min(Math.floor(p.body.length * 0.45), p.body.length - 40)
    const ex = p.body.slice(start, start + 40).trim()
    if (ex.length >= 20) excerptQ.push({ q: ex, rels: [p.key] })
  }
}

/* hand-labeled paraphrase / cross-lingual set (scripts/eval-queries.json).
   JSON keys are 'member_key/post_id'; post keys here use \0 as the separator. */
const labeledFile = JSON.parse(
  await (await import('node:fs/promises')).readFile(new URL('./eval-queries.json', import.meta.url), 'utf8'),
)
const toKey = (s) => s.replace('/', '\u0000')
const known = new Set(posts.map((p) => p.key))
const labeledQ = labeledFile.queries
  .map((x) => ({ q: x.q, lang: x.lang, rels: x.keys.map(toKey).filter((k) => known.has(k)) }))
  .filter((x) => x.rels.length > 0)
console.log(`queries: title=${titleQ.length} excerpt=${excerptQ.length} labeled=${labeledQ.length}`)

/* ---------------- variants ------------------------------------------------ */
/* Each variant returns [{ key, text, kind }] — kind distinguishes a body
   chunk from a standalone title vector (for the calibration report). */
const baseChunks = (p) => chunkText(p.body, 480, 80, ' ')
const smallChunks = (p) => chunkText(p.body, 280, 60, ' ')
const smallNoSpace = (p) => chunkText(p.body, 280, 60, '')

const variants = {
  'base 480 (current)': (p) => baseChunks(p).map((c) => ({ key: p.key, text: c, kind: 'body' })),
  'base 480 nospace': (p) => chunkText(p.body, 480, 80, '').map((c) => ({ key: p.key, text: c, kind: 'body' })),
  'prepend-all': (p) => baseChunks(p).map((c) => ({ key: p.key, text: `${p.title}\n${c}`, kind: 'body' })),
  'prepend-first': (p) =>
    baseChunks(p).map((c, i) => ({ key: p.key, text: i === 0 ? `${p.title}\n${c}` : c, kind: 'body' })),
  'title-vector': (p) => [
    { key: p.key, text: p.title, kind: 'title' },
    ...baseChunks(p).map((c) => ({ key: p.key, text: c, kind: 'body' })),
  ],
  'small 280': (p) => smallChunks(p).map((c) => ({ key: p.key, text: c, kind: 'body' })),
  'small 280 nospace': (p) => smallNoSpace(p).map((c) => ({ key: p.key, text: c, kind: 'body' })),
  'small 280 + title-vector': (p) => [
    { key: p.key, text: p.title, kind: 'title' },
    ...smallChunks(p).map((c) => ({ key: p.key, text: c, kind: 'body' })),
  ],
  'small 280 prepend-all': (p) => smallChunks(p).map((c) => ({ key: p.key, text: `${p.title}\n${c}`, kind: 'body' })),
  'small 280 prepend-first': (p) =>
    smallChunks(p).map((c, i) => ({ key: p.key, text: i === 0 ? `${p.title}\n${c}` : c, kind: 'body' })),
  'small nospace + title-vec': (p) => [
    { key: p.key, text: p.title, kind: 'title' },
    ...smallNoSpace(p).map((c) => ({ key: p.key, text: c, kind: 'body' })),
  ],
  'small nospace + clean-title': (p) => [
    { key: p.key, text: cleanTitle(p).length >= 3 ? cleanTitle(p) : p.title, kind: 'title' },
    ...smallNoSpace(p).map((c) => ({ key: p.key, text: c, kind: 'body' })),
  ],
}

/* ---------------- embed with a text-keyed memo ---------------------------- */
env.cacheDir = process.env.MODEL_DIR || new URL('../model-cache', import.meta.url).pathname
const MAX_CHARS = 4000
console.log(`model: ${MODEL_KEY} → ${SPEC.id} (pooling=${SPEC.pooling})`)
const t0load = Date.now()
const pipe = await pipeline('feature-extraction', SPEC.id, { dtype: strArg('dtype', 'q8') })
console.log(`loaded in ${((Date.now() - t0load) / 1000).toFixed(1)}s`)
const cache = new Map()
let computed = 0
// sanity probe: dims + unit-norm check (catches ignored pooling/normalize)
{
  const probe = (await pipe('passage: sanity check', { pooling: SPEC.pooling, normalize: true })).data
  let n = 0
  for (let i = 0; i < probe.length; i++) n += probe[i] * probe[i]
  console.log(`probe: dims=${probe.length} norm=${Math.sqrt(n).toFixed(4)}`)
}
async function vec(text, kind) {
  const k = `${kind}\u0000${text}`
  let v = cache.get(k)
  if (!v) {
    const prefix = kind === 'query' ? SPEC.q : SPEC.p
    // pooling/normalize are per-call options for feature-extraction (not
    // constructor options — passing them above is silently ignored)
    const out = await pipe(`${prefix}${String(text ?? '').slice(0, MAX_CHARS)}`, {
      pooling: SPEC.pooling,
      normalize: true,
    })
    v = out.data // Float32Array(dims), unit length thanks to normalize:true
    cache.set(k, v)
    computed++
    if (computed % 500 === 0) console.log(`  embedded ${computed}…`)
  }
  return v
}
const dot = (a, b) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}
/* deterministic stride sample — keeps the calibration pass cheap */
const sample = (arr, n) => {
  if (arr.length <= n) return arr
  const out = []
  for (let i = 0; i < n; i++) out.push(arr[Math.floor((i * arr.length) / n)])
  return out
}

/* ---------------- per-query metrics --------------------------------------- */
function evaluate(vectors, queries) {
  // group vectors by post key
  const byPost = new Map()
  for (const v of vectors) {
    const arr = byPost.get(v.key) ?? []
    arr.push(v.vec)
    byPost.set(v.key, arr)
  }
  let mrr = 0, r1 = 0, r5 = 0, r10 = 0, n = 0, rankSum = 0, relRecovered = 0, relTotal = 0
  const srcScores = []
  for (const item of queries) {
    const qv = item.__vec
    const rels = item.rels ?? [item.rel]
    relTotal += rels.length
    const scored = []
    for (const [key, vecs] of byPost) {
      let best = -Infinity
      for (const v of vecs) { const d = dot(qv, v); if (d > best) best = d }
      scored.push({ key, score: best })
    }
    scored.sort((a, b) => b.score - a.score)
    const rank = scored.findIndex((s) => rels.includes(s.key)) + 1
    if (rank === 0) continue
    n++
    rankSum += rank
    if (rank <= 1) r1++
    if (rank <= 5) r5++
    if (rank <= 10) r10++
    mrr += 1 / rank
    srcScores.push(scored[rank - 1].score)
    for (const s of scored.slice(0, 10)) if (rels.includes(s.key)) relRecovered++
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
  return {
    n,
    'R@1': r1 / n,
    'R@5': r5 / n,
    'R@10': r10 / n,
    'MRR@10': mrr / n,
    meanRank: rankSum / n,
    relRecall10: relTotal ? relRecovered / relTotal : 0,
    meanSrcCos: mean(srcScores),
  }
}

/* ---------------- run ----------------------------------------------------- */
const queryTypes = [
  ['title', titleQ],
  ['excerpt', excerptQ],
  ['labeled', labeledQ],
]
const rows = []
const calib = {}
for (const [name, build] of Object.entries(variants)) {
  const t0 = Date.now()
  const vectors = []
  for (const p of posts) for (const t of build(p)) vectors.push({ ...t, vec: await vec(t.text, 'passage') })
  // embed queries with the query-side prefix (none for granite/bge)
  for (const qt of queryTypes)
    for (const q of qt[1]) if (!q.__vec) q.__vec = await vec(q.q, 'query')
  const res = {}
  for (const [qt, queries] of queryTypes) res[qt] = evaluate(vectors, queries)
  rows.push({ variant: name, vecs: vectors.length, ms: Date.now() - t0, ...res })
  // calibration: score distribution of title-kind vectors vs body-kind
  // (stride-sampled — the full cross product is needlessly expensive here)
  const titleSc = [], bodySc = []
  const calQ = sample(titleQ, 80)
  const calV = sample(vectors, 1200)
  for (const q of calQ) {
    for (const v of calV) {
      const s = dot(q.__vec, v.vec)
      ;(v.kind === 'title' ? titleSc : bodySc).push(s)
    }
  }
  const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) * p)] }
  calib[name] = {
    titleKind: vectors.some((v) => v.kind === 'title') ? { p50: pct(titleSc, 0.5), p90: pct(titleSc, 0.9) } : null,
    bodyKind: { p50: pct(bodySc, 0.5), p90: pct(bodySc, 0.9) },
  }
  console.log(`done ${name} (${vectors.length} vecs, ${((Date.now() - t0) / 1000).toFixed(1)}s)`)
}

const f = (x) => x.toFixed(3)
console.log(`\n${'variant'.padEnd(26)} ${'vecs'.padStart(5)} | ${'title R@1'.padStart(9)} ${'titleMRR'.padStart(8)} | ${'exc R@1'.padStart(7)} ${'excMRR'.padStart(6)} ${'excRank'.padStart(7)} | ${'lab R@1'.padStart(7)} ${'lab R@5'.padStart(7)} ${'labMRR'.padStart(6)} ${'labRank'.padStart(7)} ${'labRec10'.padStart(8)}`)
for (const r of rows) {
  console.log(
    `${r.variant.padEnd(26)} ${String(r.vecs).padStart(5)} | ` +
      `${f(r.title['R@1']).padStart(9)} ${f(r.title['MRR@10']).padStart(8)} | ` +
      `${f(r.excerpt['R@1']).padStart(7)} ${f(r.excerpt['MRR@10']).padStart(6)} ${r.excerpt.meanRank.toFixed(1).padStart(7)} | ` +
      `${f(r.labeled['R@1']).padStart(7)} ${f(r.labeled['R@5']).padStart(7)} ${f(r.labeled['MRR@10']).padStart(6)} ${r.labeled.meanRank.toFixed(1).padStart(7)} ${f(r.labeled.relRecall10).padStart(8)}`,
  )
}

console.log('\ncosine calibration (title queries):')
for (const [name, c] of Object.entries(calib)) {
  console.log(
    `  ${name.padEnd(26)} title-kind=${c.titleKind ? `p50 ${f(c.titleKind.p50)} p90 ${f(c.titleKind.p90)}` : '—'}  body-kind=p50 ${f(c.bodyKind.p50)} p90 ${f(c.bodyKind.p90)}`,
  )
}
console.log(`\ntotal embeddings computed: ${computed} (model: ${MODEL_KEY})`)
