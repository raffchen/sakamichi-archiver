/* stage 5: local ONNX embeddings for the semantic (related) search section.
   Model: Xenova/multilingual-e5-small, q8-quantized — 384 dims, ~120 MB
   download (cached in MODEL_DIR), ~30-100 ms/embed on CPU, runs fully local
   (fan content never leaves the box). e5 needs the "query: "/"passage: "
   prefixes; q8 ≈ fp32 for ranking (evaluated 2026-11-15).

   Everything degrades: no model download / no volume / load failure ⇒ the
   embedder is null and search stays exact-only. The client bundle never
   sees transformers.js — indexer + server only. */
import { pipeline, env } from '@huggingface/transformers'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const VIEWER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const EMBED_MODEL = process.env.EMBED_MODEL || 'Xenova/multilingual-e5-small'
export const EMBED_DIM = 384
const MAX_CHARS = 4000 // pipeline truncates at 512 tokens; this is the belt

export async function buildEmbedder(log = () => {}) {
  try {
    env.cacheDir = process.env.MODEL_DIR || path.join(VIEWER, 'model-cache')
    const t0 = Date.now()
    const ex = await pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8' })
    log(`embedder: ${EMBED_MODEL} (q8, ${EMBED_DIM}d) ready — ${Date.now() - t0}ms`)
    const run = async (text, kind) => {
      const out = await ex(`${kind}: ${String(text ?? '').slice(0, MAX_CHARS)}`, {
        pooling: 'mean',
        normalize: true,
      })
      return out.data // Float32Array(EMBED_DIM), unit length
    }
    return {
      model: EMBED_MODEL,
      dims: EMBED_DIM,
      passage: (text) => run(text, 'passage'),
      query: (text) => run(text, 'query'),
    }
  } catch (e) {
    log(`! embedder unavailable (${e.message}) — the related section stays empty`)
    return null
  }
}
