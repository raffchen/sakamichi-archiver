/* kuromoji wrapper for the search index (stage 3) — reading-aware matching.
   Produces a hiragana reading string for a text so that ひかり finds 光莉,
   さくら finds 桜, and ルビー/るびー hit the same rows.

   Strict normalization only (decided against vowel-collapse tricks):
     - katakana → hiragana (including the long-vowel mark ー as-is)
     - latin kept as-is (lowercased), everything else dropped
   The tokenizer is loaded once per build (~0.5 s) and only pays per *changed*
   row (body_md5 skip in db.mjs) — never on warm restarts. ~190 chars/ms, so a
   full-corpus rebuild tokenizes in seconds; the client bundle never sees
   kuromoji or its dictionary. */
import kuromoji from 'kuromoji'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DICT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'kuromoji', 'dict')
const MAX_CHARS = 32768 // safety valve for pathological bodies

const kataToHira = (s) =>
  s
    .replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase()

/**
 * Build the tokenizer. Returns tokenize(text) => "みつり さくら …" (hiragana,
 * space-joined readings) or null when kuromoji/dictionary can't load — the
 * search then simply stays reading-blind (stage-2 behaviour), never fails.
 */
export async function buildTokenizer(log = () => {}) {
  let tokenizer = null
  try {
    await new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: DICT }).build((err, tok) => (err ? reject(err) : ((tokenizer = tok), resolve())))
    })
  } catch (e) {
    log(`! kuromoji unavailable (${e.message}) — search will be surface-only`)
    return null
  }
  log(`kuromoji: dictionary loaded (${DICT})`)
  const fn = (text) => {
    if (!tokenizer || !text) return null
    const t = String(text).slice(0, MAX_CHARS)
    const out = []
    for (const token of tokenizer.tokenize(t)) {
      // readings are most useful for kanji-bearing words; bare kana/latin
      // surface text is already searchable via the trigram surface columns
      const reading = token.reading ? kataToHira(token.reading) : null
      if (reading && reading !== kataToHira(token.surface_form)) out.push(reading)
    }
    return out.length ? out.join(' ') : null
  }
  /* raw token stream — lets the server map a reading-only match back to the
     kanji surface word it came from (ひかり hit via reading → mark 光) */
  fn.tokens = (text) => (tokenizer ? tokenizer.tokenize(String(text).slice(0, MAX_CHARS)) : [])
  return fn
}
