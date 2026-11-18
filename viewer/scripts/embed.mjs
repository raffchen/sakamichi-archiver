/* stage 5: local ONNX embeddings for the semantic (related) search section.
   Runs fully local (fan content never leaves the box). The model is chosen by
   EMBED_MODEL (a registry key or an HF id); the three we evaluated live here:

     granite (default) yuiseki/granite-embedding-278m-multilingual-ONNX
                       768d, CLS pooling, ~279 MB, no prefixes
     e5                 Xenova/multilingual-e5-small
                       384d, mean pooling, ~120 MB, "query: "/"passage: "
     bge                Xenova/bge-m3
                       1024d, CLS pooling, ~570 MB, no prefixes

   Pooling/prefixes are part of the model contract — feeding bge/granite e5's
   prefixes (or mean pooling) silently degrades ranking. q8 ≈ fp32 for ranking.

   Everything degrades: no model download / no volume / load failure ⇒ the
   embedder is null and search stays exact-only. The client bundle never sees
   transformers.js — indexer + server only. */
import { pipeline, env } from '@huggingface/transformers'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const VIEWER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/* id → { pooling, dims, query, passage }. dims must match the vec tables. */
const MODELS = {
  'Xenova/multilingual-e5-small': { pooling: 'mean', dims: 384, query: 'query: ', passage: 'passage: ' },
  'yuiseki/granite-embedding-278m-multilingual-ONNX': { pooling: 'cls', dims: 768, query: '', passage: '' },
  'Xenova/bge-m3': { pooling: 'cls', dims: 1024, query: '', passage: '' },
}
const ALIASES = {
  e5: 'Xenova/multilingual-e5-small',
  granite: 'yuiseki/granite-embedding-278m-multilingual-ONNX',
  bge: 'Xenova/bge-m3',
}
const requested = process.env.EMBED_MODEL || 'granite'
const MODEL_ID = ALIASES[requested] ?? requested
const SPEC = MODELS[MODEL_ID]
if (!SPEC) throw new Error(`unknown EMBED_MODEL "${requested}" — known: ${Object.keys(ALIASES).join(', ')}`)

export const EMBED_MODEL = MODEL_ID
export const EMBED_DIM = SPEC.dims
const MAX_CHARS = 4000 // pipeline truncates at 512 tokens; this is the belt

export async function buildEmbedder(log = () => {}) {
  try {
    env.cacheDir = process.env.MODEL_DIR || path.join(VIEWER, 'model-cache')
    const t0 = Date.now()
    const ex = await pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8' })
    log(`embedder: ${EMBED_MODEL} (q8, ${SPEC.pooling} pool, ${EMBED_DIM}d) ready — ${Date.now() - t0}ms`)
    const run = async (text, kind) => {
      const out = await ex(`${SPEC[kind]}${String(text ?? '').slice(0, MAX_CHARS)}`, {
        pooling: SPEC.pooling,
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
