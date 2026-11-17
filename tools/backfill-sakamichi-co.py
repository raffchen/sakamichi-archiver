#!/usr/bin/env python3
"""Backfill graduated members' blogs from sakamichi.co's public archive.

The official sites delete a member's blog when they graduate (and the
Message APIs stop serving them at the same time). sakamichi.co keeps a
public mirror of most graduated members' diaries — this tool folds that
mirror into the standard media layout:

    <base>/<site>/blogs/<member_name>/blog/_blogs.json   entries, oldest first
    <base>/<site>/blogs/<member_name>/blog/files/*       images

Usage:
    python3 tools/backfill-sakamichi-co.py <members.json> [--into <base>]

<members.json> is a JSON array, one record per member:

    [["nogizaka46", "nogi",    "7639", "秋元真夏",   112, 113],
     ["sakurazaka46", "sakura", "08",   "齋藤冬優花", 274, 274], …]

    site        "nogizaka46" or "sakurazaka46" (the media tree key)
    slug        the sakamichi.co API group slug ("nogi" / "sakura")
    uid         the member's id (sakamichi.co uid == official blog member id)
    name        display name (spaced, e.g. "増本 綺良")
    archived    how many posts sakamichi.co has full bodies for
    posts       how many posts the list endpoint reports in total

Build the file by walking `GET https://api.sakamichi.co/groups/<slug>/blogs
?muid=<uid>&p=<n>` per member (20 posts per page, 0-indexed, newest first).
A post whose `use_archive` flag is false has no body — the detail endpoint
404s for it; keep it as a metadata-only entry (content "", thumbnails from
the list still work).

Members with `archived == 0` are handled too: entries are built from the
list alone (titles/dates/links preserved, empty bodies) without hitting the
per-post detail endpoint at all.

Where to put the output:
  * default `<MEDIA_DIR>/unlisted/…` — the unlisted tree. build-index only
    scans `<MEDIA_DIR>/<site>/blogs` one level deep, so anything under
    `unlisted/` never reaches the index, the search DB, thumbnails or the
    blog directory: archived on disk, absent from the UI.
  * `--into <base>` overrides the base (e.g. the standard tree, if the
    member is already meant to be visible).

Re-including a member later:
    mv media/unlisted/<site>/blogs/<name> media/<site>/blogs/
and add them to viewer/public/blog-generations.json (name/reading/roman/
generation) so the card gets its labels.

Robustness: single-instance flock, per-member atomic writes (_blogs.json is
written only when the member is complete), existing files skipped, retries
on transient errors — safe to kill and re-run; finished members are skipped.
Images are sniffed from magic bytes (sakamichi.co serves extensionless ULID
urls); non-image payloads are retried, never saved.

NOT part of the standard sync loop — run it by hand when a member graduates.
"""
import fcntl, json, os, re, sys, time, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MEDIA_ROOT = Path(os.environ.get("MEDIA_DIR") or ROOT / "media")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) sakamichi-archiver"}
API = "https://api.sakamichi.co"
SLEEP = 0.25
LINK = {"nogizaka46": "https://www.nogizaka46.com/s/n46/diary/detail/{uid}",
        "sakurazaka46": "https://sakurazaka46.com/s/s46/diary/detail/{uid}"}

args = sys.argv[1:]
base = str(MEDIA_ROOT / "unlisted")
if "--into" in args:
    i = args.index("--into")
    base = args[i + 1]
    args = args[:i] + args[i + 2:]
members_path = Path(args[0]) if args else None
if not members_path or not members_path.exists():
    sys.exit(__doc__)
MEMBERS = json.load(open(members_path))

LOCK = open("/tmp/backfill-sakamichi-co.lock", "w")
try:
    fcntl.flock(LOCK, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit("another backfill instance is running — exiting")

def ext_of(b):
    if b[:3] == b"\xff\xd8\xff": return ".jpg"
    if b[:8] == b"\x89PNG\r\n\x1a\n": return ".png"
    if b[:6] in (b"GIF87a", b"GIF89a"): return ".gif"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP": return ".webp"
    return ""

def get(url, binary=False, tries=5):
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read() if binary else json.loads(r.read().decode())
        except Exception as e:
            if a == tries - 1: raise
            print(f"    [retry {a+1}] {url[:90]}: {e}", flush=True)
            time.sleep(3 * (a + 1))

def fetch_img(url, files_dir):
    """download (or reuse) one image; returns the LOCAL path used in HTML.
    Non-image payloads (transient error pages) are retried, never saved."""
    base = url.split("?")[0].rstrip("/").rsplit("/", 1)[-1]
    base = re.sub(r"\.(jpe?g|png|gif|webp)$", "", base, flags=re.I)
    for cand in (base + ".jpg", base + ".png", base + ".gif", base + ".webp"):
        if os.path.exists(os.path.join(files_dir, cand)): return cand
    for a in range(5):
        data = get(url, binary=True)
        e = ext_of(data)
        if e:
            dest = base + e
            p = os.path.join(files_dir, dest)
            if not os.path.exists(p):
                with open(p, "wb") as f: f.write(data)
                time.sleep(SLEEP)
            return dest
        print(f"    [bad payload {a+1}] {base} ({len(data)} bytes) — retrying", flush=True)
        time.sleep(5 * (a + 1))
    raise RuntimeError(f"non-image payload for {url}")

def jst_at(iso):
    """sakamichi.co timestamps are UTC — format as JST for the `at` field"""
    iso = (iso or "").strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(iso, fmt).replace(tzinfo=timezone.utc) + timedelta(hours=9)
            return dt.strftime("%Y/%m/%d %H:%M:%S")
        except ValueError:
            pass
    return ""

def list_posts(slug, uid):
    posts, p = [], 0
    while True:
        d = get(f"{API}/groups/{slug}/blogs?muid={uid}&p={p}")
        posts.extend(d.get("blogs") or [])
        p += 1
        if p >= max(d.get("pages", 0), 1): return posts
        time.sleep(SLEEP)

def done_member(dirp, expected):
    f = os.path.join(dirp, "blog", "_blogs.json")
    if not os.path.exists(f): return False
    try:
        return len(json.load(open(f)).get("entries") or []) >= expected
    except Exception:
        return False

def write_member(dirp, site, uid, name, entries, now):
    entries.sort(key=lambda e: e["at"])
    os.makedirs(os.path.join(dirp, "blog"), exist_ok=True)
    state = {"site": site, "member": name, "member_uuid": uid,
             "updated": now, "entries": entries}
    tmp = os.path.join(dirp, "blog", "_blogs.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, os.path.join(dirp, "blog", "_blogs.json"))

now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
for idx, (site, slug, uid, name, expected, posts_total, *_) in enumerate(MEMBERS):
    key = name.replace(" ", "_")
    dirp = os.path.join(base, site, "blogs", key)
    print(f"[{idx+1}/{len(MEMBERS)}] {name} ({site} {uid}): {expected} archived", flush=True)
    if done_member(dirp, max(expected, 1)):
        print("  [skip] already archived", flush=True)
        continue
    posts = list_posts(slug, uid)
    if expected == 0:
        # metadata-only member: sakamichi.co has no archived bodies (the
        # detail endpoint 404s per post) — entries from the list alone
        entries = [{
            "id": str(b["uid"]), "title": b.get("title") or "",
            "creator": name, "at": jst_at(b.get("published_at")),
            "link": b.get("url") or LINK[site].format(uid=b["uid"]),
            "thumbnail": None, "content": "", "fetched": now,
        } for b in posts]
        write_member(dirp, site, uid, name, entries, now)
        print(f"[done] {name}: {len(entries)} entries (metadata-only)", flush=True)
        continue
    files_dir = os.path.join(dirp, "blog", "files")
    os.makedirs(files_dir, exist_ok=True)
    entries = []
    for i, b in enumerate(posts):
        detail = None
        try:
            detail = get(f"{API}/groups/{slug}/blogs/{b['uid']}")
        except Exception as e:
            print(f"    [detail fail {b['uid']}] {e}", flush=True)
        html = (detail or {}).get("html") or ""
        thumb = None
        images = b.get("images") or []
        if images and images[0].get("thumbnail_url"):
            try:
                thumb = "files/" + fetch_img(images[0]["thumbnail_url"], files_dir)
            except Exception as e:
                print(f"    [thumb fail] {e}", flush=True)
        for src in sorted(set(re.findall(r'src="([^"]+)"', html))):
            if "/images/" not in src and "/files/" not in src: continue
            try:
                local = fetch_img(src, files_dir)
                html = html.replace(f'src="{src}"', f'src="files/{local}"')
            except Exception as e:
                print(f"    [img fail {src[-40:]}] {e}", flush=True)
        entries.append({
            "id": str(b["uid"]), "title": b.get("title") or "",
            "creator": (detail or {}).get("member_name") or name,
            "at": jst_at(detail["published_at"]) if detail and detail.get("published_at") else (b.get("published_at") or ""),
            "link": b.get("url") or LINK[site].format(uid=b["uid"]),
            "thumbnail": thumb, "content": html, "fetched": now,
        })
        if (i + 1) % 50 == 0 or i + 1 == len(posts):
            print(f"  {i+1}/{len(posts)} {b.get('title','')[:30]}", flush=True)
        time.sleep(SLEEP)
    write_member(dirp, site, uid, name, entries, now)
    print(f"[done] {name}: {len(entries)} entries ({sum(1 for e in entries if e['content'])} with content)", flush=True)
print(f"[all done] {len(MEMBERS)} members", flush=True)
