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

const SCHEMA_VERSION = 3
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
  PRIMARY KEY (slug, msg_id)
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

/**
 * Open (and migrate) the search DB. Returns null when the DB is disabled —
 * missing DB_PATH is fine (defaults to public/index.sqlite for local dev),
 * an unopenable/corrupt file degrades to no-DB instead of failing the build.
 * tokenize: optional (text) => hiragana-reading-string (build-index wires
 * kuromoji here). When present, new/changed/missing rows get readings; when
 * null the reading columns stay empty and search remains surface-only.
 */
export function openSearchDb(dbPath, log = () => {}, tokenize = null) {
  if (!dbPath) return null
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    const db = new DatabaseSync(dbPath)
    db.exec('PRAGMA journal_mode = WAL')
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
       * deleted. Returns the delta.
       */
      syncBlogPosts(rowsByMember) {
        const stat = { added: 0, updated: 0, removed: 0, unchanged: 0 }
        const run = db.transaction ?? null // (node:sqlite has no helper; exec BEGIN/COMMIT below)
        db.exec('BEGIN')
        try {
          const sel = db.prepare('SELECT post_id, body_md5, rowid FROM posts WHERE member_key = ?')
          const ins = db.prepare(
            'INSERT INTO posts (member_key, site, post_id, member_uuid, member_name, title, at, body, body_md5, src_mtime, reading) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          const upd = db.prepare(
            'UPDATE posts SET site = ?, member_uuid = ?, member_name = ?, title = ?, at = ?, body = ?, body_md5 = ?, src_mtime = ?, reading = ? WHERE member_key = ? AND post_id = ?',
          )
          const del = db.prepare('DELETE FROM posts WHERE member_key = ? AND post_id = ?')
          for (const [memberKey, m] of rowsByMember) {
            const existing = new Map(sel.all(memberKey).map((r) => [r.post_id, { md5: r.body_md5, rowid: r.rowid }]))
            const seen = new Set()
            for (const p of m.posts) {
              seen.add(String(p.id))
              const digest = md5(p.body)
              const prev = existing.get(String(p.id))
              if (!prev) {
                const reading = tokenize?.(`${p.title ?? ''} ${p.body ?? ''}`) ?? null
                const { lastInsertRowid } = ins.run(
                  memberKey, m.site, String(p.id), m.uuid, m.name, p.title, p.at, p.body, digest, m.src_mtime, reading,
                )
                fts.postsIns.run(lastInsertRowid, p.title, p.body, reading)
                stat.added++
              } else if (prev.md5 !== digest) {
                const reading = tokenize?.(`${p.title ?? ''} ${p.body ?? ''}`) ?? null
                upd.run(m.site, m.uuid, m.name, p.title, p.at, p.body, digest, m.src_mtime, reading, memberKey, String(p.id))
                fts.postsDel.run(prev.rowid)
                fts.postsIns.run(prev.rowid, p.title, p.body, reading)
                stat.updated++
              } else {
                stat.unchanged++
              }
            }
            for (const [gone, prev] of existing) {
              if (!seen.has(gone)) {
                fts.postsDel.run(prev.rowid)
                del.run(memberKey, gone)
                stat.removed++
              }
            }
          }
          // members whose blog directory vanished entirely
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
              for (const r of rowids.all(k)) fts.postsDel.run(r.rowid)
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
      /** Mirror messages. rowsBySlug: Map<slug, [{ id, at, type, text }]>. */
      syncMessages(rowsBySlug) {
        const stat = { added: 0, updated: 0, removed: 0, unchanged: 0 }
        db.exec('BEGIN')
        try {
          const sel = db.prepare('SELECT msg_id, body_md5, rowid FROM messages WHERE slug = ?')
          const ins = db.prepare(
            'INSERT INTO messages (slug, msg_id, at, type, text, body_md5, reading) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          const upd = db.prepare(
            'UPDATE messages SET at = ?, type = ?, text = ?, body_md5 = ?, reading = ? WHERE slug = ? AND msg_id = ?',
          )
          const del = db.prepare('DELETE FROM messages WHERE slug = ? AND msg_id = ?')
          for (const [slug, msgs] of rowsBySlug) {
            const existing = new Map(sel.all(slug).map((r) => [r.msg_id, { md5: r.body_md5, rowid: r.rowid }]))
            const seen = new Set()
            for (const msg of msgs) {
              seen.add(Number(msg.id))
              const digest = md5(msg.text)
              const prev = existing.get(Number(msg.id))
              if (!prev) {
                const reading = tokenize?.(msg.text ?? '') ?? null
                const { lastInsertRowid } = ins.run(slug, Number(msg.id), msg.at, msg.type, msg.text, digest, reading)
                fts.msgsIns.run(lastInsertRowid, msg.text, reading)
                stat.added++
              } else if (prev.md5 !== digest) {
                const reading = tokenize?.(msg.text ?? '') ?? null
                upd.run(msg.at, msg.type, msg.text, digest, reading, slug, Number(msg.id))
                fts.msgsDel.run(prev.rowid)
                fts.msgsIns.run(prev.rowid, msg.text, reading)
                stat.updated++
              } else {
                stat.unchanged++
              }
            }
            for (const [gone, prev] of existing) {
              if (!seen.has(gone)) {
                fts.msgsDel.run(prev.rowid)
                del.run(slug, gone)
                stat.removed++
              }
            }
          }
          const slugs = [...rowsBySlug.keys()]
          const stale = db
            .prepare('SELECT DISTINCT slug FROM messages')
            .all()
            .map((r) => r.slug)
            .filter((s) => !slugs.includes(s))
          if (stale.length) {
            const rowids = db.prepare('SELECT rowid FROM messages WHERE slug = ?')
            const delMember = db.prepare('DELETE FROM messages WHERE slug = ?')
            for (const s of stale) {
              for (const r of rowids.all(s)) fts.msgsDel.run(r.rowid)
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
