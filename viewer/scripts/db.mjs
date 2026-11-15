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

const SCHEMA_VERSION = 1
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
  body        TEXT,              -- archived HTML (FTS arrives in stage 2)
  body_md5    TEXT NOT NULL,     -- skip rework of unchanged posts
  src_mtime   INTEGER,           -- _blogs.json mtime at index time
  PRIMARY KEY (member_key, post_id)
);
CREATE TABLE IF NOT EXISTS messages (
  slug       TEXT NOT NULL,      -- member slug (thread routing)
  msg_id     INTEGER NOT NULL,
  at         TEXT,
  type       TEXT,
  text       TEXT,
  body_md5   TEXT NOT NULL,
  PRIMARY KEY (slug, msg_id)
);`

/**
 * Open (and migrate) the search DB. Returns null when the DB is disabled —
 * missing DB_PATH is fine (defaults to public/index.sqlite for local dev),
 * an unopenable/corrupt file degrades to no-DB instead of failing the build.
 */
export function openSearchDb(dbPath, log = () => {}) {
  if (!dbPath) return null
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    const db = new DatabaseSync(dbPath)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec(SCHEMA)
    const ver = db.prepare('PRAGMA user_version').get().user_version
    if (ver < SCHEMA_VERSION) {
      // future migrations go here (stage 2 adds the FTS tables, stage 3 the
      // reading columns, stage 5 the vec table) — bump SCHEMA_VERSION per step
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    }
    const counts = {
      posts: db.prepare('SELECT COUNT(*) c FROM posts').get().c,
      messages: db.prepare('SELECT COUNT(*) c FROM messages').get().c,
    }
    log(`db open: ${dbPath} (v${SCHEMA_VERSION}, ${counts.posts} posts, ${counts.messages} messages)`)
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
          const sel = db.prepare('SELECT post_id, body_md5 FROM posts WHERE member_key = ?')
          const ins = db.prepare(
            'INSERT INTO posts (member_key, site, post_id, member_uuid, member_name, title, at, body, body_md5, src_mtime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          const upd = db.prepare(
            'UPDATE posts SET site = ?, member_uuid = ?, member_name = ?, title = ?, at = ?, body = ?, body_md5 = ?, src_mtime = ? WHERE member_key = ? AND post_id = ?',
          )
          const del = db.prepare('DELETE FROM posts WHERE member_key = ? AND post_id = ?')
          for (const [memberKey, m] of rowsByMember) {
            const existing = new Map(sel.all(memberKey).map((r) => [r.post_id, r.body_md5]))
            const seen = new Set()
            for (const p of m.posts) {
              seen.add(String(p.id))
              const digest = md5(p.body)
              if (!existing.has(String(p.id))) {
                ins.run(memberKey, m.site, String(p.id), m.uuid, m.name, p.title, p.at, p.body, digest, m.src_mtime)
                stat.added++
              } else if (existing.get(String(p.id)) !== digest) {
                upd.run(m.site, m.uuid, m.name, p.title, p.at, p.body, digest, m.src_mtime, memberKey, String(p.id))
                stat.updated++
              } else {
                stat.unchanged++
              }
            }
            for (const gone of existing.keys()) {
              if (!seen.has(gone)) {
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
            const delMember = db.prepare('DELETE FROM posts WHERE member_key = ?')
            for (const k of stale) {
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
          const sel = db.prepare('SELECT msg_id, body_md5 FROM messages WHERE slug = ?')
          const ins = db.prepare(
            'INSERT INTO messages (slug, msg_id, at, type, text, body_md5) VALUES (?, ?, ?, ?, ?, ?)',
          )
          const upd = db.prepare(
            'UPDATE messages SET at = ?, type = ?, text = ?, body_md5 = ? WHERE slug = ? AND msg_id = ?',
          )
          const del = db.prepare('DELETE FROM messages WHERE slug = ? AND msg_id = ?')
          for (const [slug, msgs] of rowsBySlug) {
            const existing = new Map(sel.all(slug).map((r) => [r.msg_id, r.body_md5]))
            const seen = new Set()
            for (const msg of msgs) {
              seen.add(Number(msg.id))
              const digest = md5(msg.text)
              if (!existing.has(Number(msg.id))) {
                ins.run(slug, Number(msg.id), msg.at, msg.type, msg.text, digest)
                stat.added++
              } else if (existing.get(Number(msg.id)) !== digest) {
                upd.run(msg.at, msg.type, msg.text, digest, slug, Number(msg.id))
                stat.updated++
              } else {
                stat.unchanged++
              }
            }
            for (const gone of existing.keys()) {
              if (!seen.has(gone)) {
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
            const delMember = db.prepare('DELETE FROM messages WHERE slug = ?')
            for (const s of stale) {
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
