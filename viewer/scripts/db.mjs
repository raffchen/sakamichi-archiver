/* SQLite search index — a derived, rebuildable cache. The media files
   (_messages.json, _blogs.json) stay the source of truth; this module only
   ever mirrors them for stage-2+ search. Everything here is skippable: if
   the DB can't be opened, built, or written, the viewer still serves the
   JSON index exactly as before.

   Written by build-index.mjs only (single writer). node:sqlite keeps this
   native-dependency-free; WAL so a future server-side reader never blocks
   the indexer. */
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { EMBED_DIM, EMBED_MODEL } from './embed.mjs'

export const SCHEMA_VERSION = 6

/* identifies the *derived* search-DB shape: a change here (schema step, model,
   dim) means every vector must be rebuilt even when the media is unchanged —
   build-index compares this against the DB's stored build_sig to decide. */
export const dbSignature = () => `v${SCHEMA_VERSION}:${EMBED_MODEL}:${EMBED_DIM}`
const md5 = (s) => createHash('md5').update(s ?? '').digest('hex')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS posts (
  member_key  TEXT NOT NULL,     -- directory name under media/blogs/
  site        TEXT NOT NULL,
  post_id     TEXT NOT NULL,
  member_uuid TEXT,
  member_name TEXT,
  title       TEXT,
  at          TEXT,              -- "YYYY/MM/DD HH:mm:ss" (sorts as-is)
  body        TEXT,              -- HTML-stripped plain text (stage 2)
  body_md5    TEXT NOT NULL,     -- skip re-tokenizing unchanged posts
  src_mtime   INTEGER,           -- _blogs.json mtime at index time
  reading     TEXT,              -- kuromoji readings, hiragana (stage 3)
  chunks_md5  TEXT,              -- stage 5: set once the body's chunks are embedded
  thumb       TEXT,              -- thumbnail filename (stage 6: /api/blog feed from DB)
  PRIMARY KEY (member_key, post_id)
);
CREATE TABLE IF NOT EXISTS messages (
  slug       TEXT NOT NULL,      -- member slug (thread routing)
  msg_id     INTEGER NOT NULL,
  at         TEXT,
  type       TEXT,
  text       TEXT,
  body_md5   TEXT NOT NULL,
  reading    TEXT,               -- kuromoji readings, hiragana (stage 3)
  vec_rowid  INTEGER,            -- stage 6: rowid in vec_messages (whole-message embed)
  embed_md5  TEXT,               -- stage 6: md5(text) when the vector was stored
  PRIMARY KEY (slug, msg_id)
);
CREATE TABLE IF NOT EXISTS meta (   -- build bookkeeping (content hash of the last completed sync)
  key   TEXT PRIMARY KEY,
  value TEXT
);`

/* v2: FTS for stage-2 search. Tokenizer decision (bake-off on the real
   archive, 2026-11-15): unicode61 treats a whole CJK run as ONE token, so
   歌合戦 finds zero hits inside 紅白歌合戦 — useless for Japanese. trigram
   gives real substring search (歌合戦への出 → 3 hits) but cannot match
   2-code-point words (卒業, 桜); those go through an instr() path in
   server.mjs instead. Content is duplicated into the FTS tables (external
   content was rejected: node:sqlite's delete path for it is fiddly and the
   corpus is only a few MB). FTS rowid mirrors the base-table rowid.

   v3 (stage 3): `reading` columns — kuromoji readings (hiragana) in both the
   base tables (for the instr() short-query path) and the FTS tables (for
   MATCH). MATCH without a column filter searches surface OR reading, and
   bm25 column weights rank surface matches above reading matches. */
const SCHEMA_FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts    USING fts5(title, body, reading, tokenize='trigram');
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, reading, tokenize='trigram');`
const BACKFILL_FTS = `
INSERT INTO posts_fts (rowid, title, body, reading)
  SELECT rowid, title, body, reading FROM posts WHERE rowid NOT IN (SELECT rowid FROM posts_fts);
INSERT INTO messages_fts (rowid, text, reading)
  SELECT rowid, text, reading FROM messages WHERE rowid NOT IN (SELECT rowid FROM messages_fts);`

/* stage 5: semantic layer. Per post: one standalone cleaned-title vector
   (idx -1) plus ≈280-char sentence-boundary body chunks, embedded by a local
   ONNX model (scripts/embed.mjs); the vec0 table is sqlite-vec (cosine
   distance). chunk id == vec rowid. The vec table is only created when an
   embedder is wired in; without one the search stays exact-only. Both tables
   are derived from posts and dropped on migration — the next build re-embeds
   everything (chunks_md5 gate makes it one-time). */
const SCHEMA_VEC = `
CREATE TABLE IF NOT EXISTS post_chunks (
  id         INTEGER PRIMARY KEY,
  vec_rowid  INTEGER NOT NULL,     -- vec_posts rowid (vec0 only accepts autoassigned rowids)
  post_rowid INTEGER NOT NULL,
  idx        INTEGER NOT NULL,
  md5        TEXT NOT NULL,
  UNIQUE (post_rowid, idx)
);
CREATE VIRTUAL TABLE IF NOT EXISTS vec_posts USING vec0(embedding float[${EMBED_DIM}] distance_metric=cosine);
CREATE VIRTUAL TABLE IF NOT EXISTS vec_messages USING vec0(embedding float[${EMBED_DIM}] distance_metric=cosine);`

/* sentence-boundary chunking for the embedding model's context. ~280 chars is
   ~160 tokens for XLM-R on Japanese — comfortably inside the 512-token window,
   while small enough that one chunk ≈ one topic (the eval in
   scripts/eval-semantic.mjs found 480-char chunks blur subtopics; halving the
   size roughly halved the excerpt mean rank). Hard-splits pathological
   sentences. Sentences join with NO space after CJK text (the tokenizer else
   injects a standalone '▁' token per join — measured noise), but keep a space
   after ASCII so English doesn't glue. */
export function chunkText(text, size = 280, overlap = 60) {
  const body = String(text ?? '').trim()
  if (!body) return []
  const sentences = body.split(/(?<=[。！？!?\n])/)
  // CJK ideographs / kana / fullwidth forms (incl. long-vowel ー) → no space
  const sepAfter = (s) =>
    /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/.test(s.replace(/\s+$/, '').slice(-1)) ? '' : ' '
  const out = []
  let cur = ''
  for (const s of sentences) {
    if (s.length > size) {
      if (cur) { out.push(cur.trim()); cur = '' }
      for (let i = 0; i < s.length; i += size - overlap) out.push(s.slice(i, i + size).trim())
      continue
    }
    const joined = cur + (cur && !/\s$/.test(cur) ? sepAfter(cur) : '') + s
    if (joined.trim().length > size) {
      if (cur) out.push(cur.trim())
      cur = s
    } else cur = joined
    if (cur.length >= size - overlap) { out.push(cur); cur = '' }
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(Boolean)
}

/* The stored title repeats the member name and hashtag (e.g.
   "はじまるよ五百城 茉央 #きっきのにっき") across a member's posts, which turns
   their title vectors into near-duplicates. The title VECTOR embeds this
   cleaned form (the eval's clean-title variant lifted title R@1 0.87→0.99);
   the stored/displayed title is unchanged. */
export function cleanTitle(title, memberName) {
  let t = String(title ?? '').replace(/#\S+/g, ' ')
  const tc = t.replace(/\s+/g, '')
  const mn = String(memberName ?? '').replace(/\s+/g, '')
  const i = mn ? tc.indexOf(mn) : -1
  if (i >= 0) t = tc.slice(0, i)
  return t.replace(/\s+/g, ' ').trim()
}

/* The per-post vector set: a standalone cleaned-title vector (idx -1) plus the
   body chunks (idx 0..n-1). The digest gates re-embedding and covers both. */
export function postVectors(body, title, memberName) {
  const clean = cleanTitle(title, memberName)
  const work = []
  if (clean) work.push({ idx: -1, text: clean })
  for (const [i, c] of chunkText(body).entries()) work.push({ idx: i, text: c })
  return { work, digest: md5(work.map((w) => w.text).join('\u0000')) }
}

/**
 * Open (and migrate) the search DB. Async: loads the vec extension when an
 * embedder is wired in. Returns null when the DB is disabled — missing
 * DB_PATH is fine (defaults to public/index.sqlite for local dev), an
 * unopenable/corrupt file degrades to no-DB instead of failing the build.
 * tokenize: optional (text) => hiragana-reading-string (build-index wires
 * kuromoji here). embed: optional { passage(text) => Float32Array } from
 * scripts/embed.mjs. Either missing ⇒ that feature degrades, never fails.
 */
export async function openSearchDb(dbPath, log = () => {}, tokenize = null, embed = null) {
  if (!dbPath) return null
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    const db = new DatabaseSync(dbPath, { allowExtension: true })
    db.exec('PRAGMA journal_mode = WAL')
    if (embed) {
      try {
        const vec = await import('sqlite-vec')
        vec.load(db)
      } catch (e) {
        log(`! sqlite-vec unavailable (${e.message}) — related section stays empty`)
        embed = null
      }
    }
    db.exec(SCHEMA)
    const ver = db.prepare('PRAGMA user_version').get().user_version
    if (ver > 0 && ver < 3) {
      // v1/v2 base tables lack the reading columns — add them, then drop FTS
      // (the backfill below rebuilds it, now with readings)
      const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name)
      if (!cols('posts').includes('reading')) db.exec('ALTER TABLE posts ADD COLUMN reading TEXT')
      if (!cols('messages').includes('reading')) db.exec('ALTER TABLE messages ADD COLUMN reading TEXT')
      db.exec('DROP TABLE IF EXISTS posts_fts; DROP TABLE IF EXISTS messages_fts')
      log('search schema v2 → v3: reading columns added, FTS will be rebuilt')
    }
    if (ver > 0 && ver < 4) {
      // stage 5: chunks_md5 gate + fresh vector tables (derived — re-embedded
      // lazily; chunks_md5 is NULL after the ALTER so the next build embeds all)
      const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name)
      if (!cols('posts').includes('chunks_md5')) db.exec('ALTER TABLE posts ADD COLUMN chunks_md5 TEXT')
      db.exec('DROP TABLE IF EXISTS post_chunks; DROP TABLE IF EXISTS vec_posts')
      log('search schema v3 → v4: chunk + vector tables reset (will re-embed)')
    }
    if (ver > 0 && ver < 5) {
      // stage 6: message vectors + per-post thumb for the DB-backed /api/blog
      // feed; derived vector table reset (messages re-embed lazily via
      // embed_md5, posts via chunks_md5)
      const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name)
      if (!cols('messages').includes('vec_rowid')) {
        db.exec('ALTER TABLE messages ADD COLUMN vec_rowid INTEGER')
        db.exec('ALTER TABLE messages ADD COLUMN embed_md5 TEXT')
      }
      if (!cols('posts').includes('thumb')) db.exec('ALTER TABLE posts ADD COLUMN thumb TEXT')
      db.exec('DROP TABLE IF EXISTS vec_messages')
      log('search schema v4 → v5: message vectors + post thumbs')
    }
    if (ver > 0 && ver < 6) {
      // v6: embedding model switched (384→768 dims) + a per-post cleaned-title
      // vector. Everything here is derived → drop the vector tables (they carry
      // the float[N] dim) and NULL the gates so the next build re-embeds all.
      const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name)
      db.exec('DROP TABLE IF EXISTS post_chunks; DROP TABLE IF EXISTS vec_posts; DROP TABLE IF EXISTS vec_messages')
      if (cols('posts').includes('chunks_md5')) db.exec('UPDATE posts SET chunks_md5 = NULL')
      if (cols('messages').includes('embed_md5')) db.exec('UPDATE messages SET embed_md5 = NULL, vec_rowid = NULL')
      log('search schema v5 → v6: model change (dim bump + title vectors) — vectors reset, will re-embed')
    }
    // Robust model/dim switch: the vec tables bake in float[EMBED_DIM], so a
    // different EMBED_MODEL must recreate them even when SCHEMA_VERSION didn't
    // move (the v6 step only covers the first e5→granite transition). Derived
    // data, so a reset is always safe — the gates make the build re-embed it.
    const embedSig = `${EMBED_MODEL}:${EMBED_DIM}`
    const prevEmbedSig = db.prepare('SELECT value FROM meta WHERE key = ?').get('embed_sig')?.value ?? null
    if (embed && ver > 0 && prevEmbedSig && prevEmbedSig !== embedSig) {
      db.exec('DROP TABLE IF EXISTS post_chunks; DROP TABLE IF EXISTS vec_posts; DROP TABLE IF EXISTS vec_messages')
      db.exec('UPDATE posts SET chunks_md5 = NULL')
      db.exec('UPDATE messages SET embed_md5 = NULL, vec_rowid = NULL')
      log(`embedding model changed (${prevEmbedSig} → ${embedSig}) — vectors reset, will re-embed`)
    }
    if (embed) {
      db.exec(SCHEMA_VEC)
      db.prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      ).run('embed_sig', embedSig)
    }
    db.exec(SCHEMA_FTS)
    // readings for any base row that lacks one (the v3 migration lands here;
    // idempotent — only NULL rows are tokenized, so warm restarts are free).
    // The FTS backfill below then indexes everything incl. the new readings.
    if (tokenize) {
      const missPosts = db.prepare('SELECT rowid, title, body FROM posts WHERE reading IS NULL').all()
      const missMsgs = db.prepare('SELECT rowid, text FROM messages WHERE reading IS NULL').all()
      if (missPosts.length || missMsgs.length) {
        const t0 = Date.now()
        const setP = db.prepare('UPDATE posts SET reading = ? WHERE rowid = ?')
        for (const r of missPosts) {
          const reading = tokenize(`${r.title ?? ''} ${r.body ?? ''}`)
          if (reading) setP.run(reading, r.rowid)
        }
        const setM = db.prepare('UPDATE messages SET reading = ? WHERE rowid = ?')
        for (const r of missMsgs) {
          // '' for empty texts (pure media messages) so they don't re-attempt forever
          const reading = tokenize(r.text ?? '') ?? ''
          if (reading !== null) setM.run(reading, r.rowid)
        }
        log(`readings: ${missPosts.length} posts + ${missMsgs.length} messages tokenized — ${Date.now() - t0}ms`)
      }
    }
    db.exec(BACKFILL_FTS)
    if (ver < SCHEMA_VERSION) {
      // future migrations go here (stage 3 the reading columns, stage 5 the
      // vec table) — bump SCHEMA_VERSION per step
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    }
    const counts = {
      posts: db.prepare('SELECT COUNT(*) c FROM posts').get().c,
      messages: db.prepare('SELECT COUNT(*) c FROM messages').get().c,
    }
    log(`db open: ${dbPath} (v${SCHEMA_VERSION}, ${counts.posts} posts, ${counts.messages} messages)`)
    const fts = {
      postsIns: db.prepare('INSERT INTO posts_fts (rowid, title, body, reading) VALUES (?, ?, ?, ?)'),
      postsDel: db.prepare('DELETE FROM posts_fts WHERE rowid = ?'),
      msgsIns: db.prepare('INSERT INTO messages_fts (rowid, text, reading) VALUES (?, ?, ?)'),
      msgsDel: db.prepare('DELETE FROM messages_fts WHERE rowid = ?'),
    }
    return {
      path: dbPath,
      /**
       * Mirror blog posts. rowsByMember: Map<member_key, { site, uuid, name,
       * src_mtime, posts: [{ id, title, at, body }] }>. Unchanged posts
       * (same body_md5) are skipped; posts missing from the source are
       * deleted. Async only because embedding is; returns the delta
       * (+ stat.embedded = chunks vectorized this run). One transaction per
       * member — a killed sync loses at most the current member's work.
       */
      async syncBlogPosts(rowsByMember) {
        const stat = { added: 0, updated: 0, removed: 0, unchanged: 0, embedded: 0 }
        // safety net: an empty input while the DB holds posts means the index
        // walk failed to see the archive (transient mount problem) — wiping
        // everything would be unrecoverable, so refuse and let the next
        // build retry
        if (!rowsByMember.size) {
          const have = db.prepare('SELECT COUNT(*) c FROM posts').get().c
          if (have)
            throw new Error(`empty blog input but ${have} posts in the DB — refusing to wipe (transient mount issue?)`)
        }
        const sel = db.prepare('SELECT post_id, body_md5, rowid, chunks_md5 FROM posts WHERE member_key = ?')
        const ins = db.prepare(
          'INSERT INTO posts (member_key, site, post_id, member_uuid, member_name, title, at, body, body_md5, src_mtime, reading, thumb) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        const upd = db.prepare(
          'UPDATE posts SET site = ?, member_uuid = ?, member_name = ?, title = ?, at = ?, body = ?, body_md5 = ?, src_mtime = ?, reading = ?, thumb = ? WHERE member_key = ? AND post_id = ?',
        )
        const del = db.prepare('DELETE FROM posts WHERE member_key = ? AND post_id = ?')
        /* chunk/vector maintenance (stage 5) — no-op without an embedder.
           vec0 only accepts autoassigned rowids, so the vec rowid is stored
           back into post_chunks.vec_rowid for deletes and KNN joins. The
           vector tables only exist when the vec extension loaded (SCHEMA_VEC),
           so these statements are prepared only when embedding is active. */
        let selChunkIds, insChunk, delChunks, vecDel, vecIns, setChunksMd5
        if (embed) {
          selChunkIds = db.prepare('SELECT vec_rowid FROM post_chunks WHERE post_rowid = ?')
          insChunk = db.prepare('INSERT INTO post_chunks (vec_rowid, post_rowid, idx, md5) VALUES (?, ?, ?, ?)')
          delChunks = db.prepare('DELETE FROM post_chunks WHERE post_rowid = ?')
          vecDel = db.prepare('DELETE FROM vec_posts WHERE rowid = ?')
          vecIns = db.prepare('INSERT INTO vec_posts (embedding) VALUES (?)')
          setChunksMd5 = db.prepare('UPDATE posts SET chunks_md5 = ? WHERE rowid = ?')
        }
        const embedBody = async (rowid, body, title, memberName) => {
          const { work, digest } = postVectors(body, title, memberName)
          for (const r of selChunkIds.all(rowid)) vecDel.run(r.vec_rowid)
          delChunks.run(rowid)
          let ok = true
          for (const { idx, text } of work) {
            const v = await embed.passage(text).catch(() => null)
            if (!v) {
              ok = false
              continue
            }
            const { lastInsertRowid } = vecIns.run(Buffer.from(v.buffer, v.byteOffset, v.byteLength))
            insChunk.run(lastInsertRowid, rowid, idx, md5(text))
            stat.embedded++
          }
          // only mark clean when every vector embedded — partial failures retry
          if (ok) setChunksMd5.run(digest, rowid)
        }
        const dropChunks = (rowid) => {
          if (!embed) return
          for (const r of selChunkIds.all(rowid)) vecDel.run(r.vec_rowid)
          delChunks.run(rowid)
        }
        // one transaction per member: a kill mid-embed loses at most the
        // current member's work, and the WAL can checkpoint along the way
        // instead of growing for the whole run
        const total = rowsByMember.size
        let done = 0
        for (const [memberKey, m] of rowsByMember) {
          db.exec('BEGIN')
          try {
            const existing = new Map(
              sel.all(memberKey).map((r) => [r.post_id, { md5: r.body_md5, rowid: r.rowid, chunks: r.chunks_md5 }]),
            )
            const seen = new Set()
            for (const p of m.posts) {
              seen.add(String(p.id))
              // digest covers title + thumb too (they feed /api/blog + the UI)
              const digest = md5(`${p.body}\u0000${p.title ?? ''}\u0000${p.thumb ?? ''}`)
              // the vector digest additionally covers the cleaned-title vector, so
              // a title edit re-embeds even when the body is untouched
              const wantChunks = postVectors(p.body, p.title, m.name).digest
              const prev = existing.get(String(p.id))
              let rowid
              // vector work needed only when the vector set (title + body) changed
              const dirty = !!embed && (!prev || prev.chunks !== wantChunks)
              if (!prev) {
                const reading = tokenize?.(`${p.title ?? ''} ${p.body ?? ''}`) ?? null
                rowid = ins.run(
                  memberKey, m.site, String(p.id), m.uuid, m.name, p.title, p.at, p.body, digest, m.src_mtime, reading, p.thumb ?? null,
                ).lastInsertRowid
                fts.postsIns.run(rowid, p.title, p.body, reading)
                stat.added++
              } else if (prev.md5 !== digest) {
                const reading = tokenize?.(`${p.title ?? ''} ${p.body ?? ''}`) ?? null
                upd.run(m.site, m.uuid, m.name, p.title, p.at, p.body, digest, m.src_mtime, reading, p.thumb ?? null, memberKey, String(p.id))
                fts.postsDel.run(prev.rowid)
                fts.postsIns.run(prev.rowid, p.title, p.body, reading)
                rowid = prev.rowid
                stat.updated++
              } else {
                rowid = prev.rowid
                stat.unchanged++
              }
              if (dirty) await embedBody(rowid, p.body, p.title, m.name)
            }
            for (const [gone, prev] of existing) {
              if (!seen.has(gone)) {
                dropChunks(prev.rowid)
                fts.postsDel.run(prev.rowid)
                del.run(memberKey, gone)
                stat.removed++
              }
            }
            db.exec('COMMIT')
          } catch (e) {
            db.exec('ROLLBACK')
            throw e
          }
          done++
          if (done % 10 === 0 || done === total)
            log(
              `db: ${done}/${total} blog members, +${stat.added}/~${stat.updated}/-${stat.removed}` +
                (stat.embedded ? `, ${stat.embedded} chunks embedded` : ''),
            )
        }
        // members whose blog directory vanished entirely — own transaction
        db.exec('BEGIN')
        try {
          const keys = [...rowsByMember.keys()]
          const stale = db
            .prepare('SELECT DISTINCT member_key FROM posts')
            .all()
            .map((r) => r.member_key)
            .filter((k) => !keys.includes(k))
          if (stale.length) {
            const rowids = db.prepare('SELECT rowid FROM posts WHERE member_key = ?')
            const delMember = db.prepare('DELETE FROM posts WHERE member_key = ?')
            for (const k of stale) {
              for (const r of rowids.all(k)) {
                dropChunks(r.rowid)
                fts.postsDel.run(r.rowid)
              }
              stat.removed += Number(db.prepare('SELECT COUNT(*) c FROM posts WHERE member_key = ?').get(k).c)
              delMember.run(k)
            }
          }
          db.exec('COMMIT')
        } catch (e) {
          db.exec('ROLLBACK')
          throw e
        }
        return stat
      },
      /** Mirror messages. rowsBySlug: Map<slug, [{ id, at, type, text }]>.
       *  One transaction per member, like syncBlogPosts. */
      async syncMessages(rowsBySlug) {
        const stat = { added: 0, updated: 0, removed: 0, unchanged: 0, embedded: 0 }
        // same safety net as syncBlogPosts
        if (!rowsBySlug.size) {
          const have = db.prepare('SELECT COUNT(*) c FROM messages').get().c
          if (have)
            throw new Error(`empty message input but ${have} messages in the DB — refusing to wipe (transient mount issue?)`)
        }
        const sel = db.prepare('SELECT msg_id, body_md5, rowid, embed_md5, vec_rowid FROM messages WHERE slug = ?')
        const ins = db.prepare(
          'INSERT INTO messages (slug, msg_id, at, type, text, body_md5, reading) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        const upd = db.prepare(
          'UPDATE messages SET at = ?, type = ?, text = ?, body_md5 = ?, reading = ? WHERE slug = ? AND msg_id = ?',
        )
        const del = db.prepare('DELETE FROM messages WHERE slug = ? AND msg_id = ?')
        /* whole-message vectors (stage 6): messages are short — one embedding
           each, no chunking; empty texts (pure media) get none. vec_messages
           only exists when the vec extension loaded, so these are prepared
           only when embedding is active. */
        let vecDel, vecIns, setVec
        if (embed) {
          vecDel = db.prepare('DELETE FROM vec_messages WHERE rowid = ?')
          vecIns = db.prepare('INSERT INTO vec_messages (embedding) VALUES (?)')
          setVec = db.prepare('UPDATE messages SET vec_rowid = ?, embed_md5 = ? WHERE rowid = ?')
        }
        const embedMsg = async (rowid, text, prevVec) => {
          if (!text || !text.trim()) return
          const v = await embed.passage(text).catch(() => null)
          if (!v) return
          if (prevVec) vecDel.run(prevVec) // clear the previous vector
          const { lastInsertRowid } = vecIns.run(Buffer.from(v.buffer, v.byteOffset, v.byteLength))
          setVec.run(lastInsertRowid, md5(text), rowid)
          stat.embedded++
        }
        for (const [slug, msgs] of rowsBySlug) {
          db.exec('BEGIN')
          try {
            const existing = new Map(
              sel.all(slug).map((r) => [r.msg_id, { md5: r.body_md5, rowid: r.rowid, embed: r.embed_md5, vec: r.vec_rowid }]),
            )
            const seen = new Set()
            for (const msg of msgs) {
              seen.add(Number(msg.id))
              const digest = md5(msg.text)
              const prev = existing.get(Number(msg.id))
              let rowid
              let vecDirty = true
              if (!prev) {
                const reading = tokenize?.(msg.text ?? '') ?? null
                rowid = ins.run(slug, Number(msg.id), msg.at, msg.type, msg.text, digest, reading).lastInsertRowid
                fts.msgsIns.run(rowid, msg.text, reading)
                stat.added++
              } else if (prev.md5 !== digest) {
                const reading = tokenize?.(msg.text ?? '') ?? null
                upd.run(msg.at, msg.type, msg.text, digest, reading, slug, Number(msg.id))
                fts.msgsDel.run(prev.rowid)
                fts.msgsIns.run(prev.rowid, msg.text, reading)
                rowid = prev.rowid
                stat.updated++
              } else {
                rowid = prev.rowid
                stat.unchanged++
                vecDirty = prev.embed !== digest
              }
              if (embed && vecDirty && msg.text) await embedMsg(rowid, msg.text, prev?.vec ?? null)
            }
            for (const [gone, prev] of existing) {
              if (!seen.has(gone)) {
                if (embed && prev.vec) vecDel.run(prev.vec)
                fts.msgsDel.run(prev.rowid)
                del.run(slug, gone)
                stat.removed++
              }
            }
            db.exec('COMMIT')
          } catch (e) {
            db.exec('ROLLBACK')
            throw e
          }
        }
        // slugs whose member vanished entirely — own transaction
        db.exec('BEGIN')
        try {
          const slugs = [...rowsBySlug.keys()]
          const stale = db
            .prepare('SELECT DISTINCT slug FROM messages')
            .all()
            .map((r) => r.slug)
            .filter((s) => !slugs.includes(s))
          if (stale.length) {
            const rows = db.prepare('SELECT rowid, vec_rowid FROM messages WHERE slug = ?')
            const delMember = db.prepare('DELETE FROM messages WHERE slug = ?')
            for (const s of stale) {
              for (const r of rows.all(s)) {
                if (embed && r.vec_rowid) vecDel.run(r.vec_rowid)
                fts.msgsDel.run(r.rowid)
              }
              stat.removed += Number(db.prepare('SELECT COUNT(*) c FROM messages WHERE slug = ?').get(s).c)
              delMember.run(s)
            }
          }
          db.exec('COMMIT')
        } catch (e) {
          db.exec('ROLLBACK')
          throw e
        }
        return stat
      },
      getMeta(key) {
        return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null
      },
      setMeta(key, value) {
        db.prepare(
          'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ).run(key, value)
      },
      close() {
        try {
          db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
          db.close()
        } catch {
          /* closing is best-effort; the OS cleans up WAL anyway */
        }
      },
    }
  } catch (e) {
    log(`! search DB unavailable (${e.message}) — continuing without it`)
    return null
  }
}

/** Cheap meta read without loading the tokenizer/embedder: used by the
 *  index build's no-op path to check whether the DB already mirrors a given
 *  content hash. Returns null when the DB is missing/corrupt/has no entry. */
export function readDbMeta(dbPath, key) {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const v = db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null
    db.close()
    return v
  } catch {
    return null
  }
}
