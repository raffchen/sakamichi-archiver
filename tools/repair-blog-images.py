#!/usr/bin/env python3
"""tools/repair-blog-images.py — fix cross-post image collisions in blogs.

Historical bug: grab-blog.py cached downloaded images by URL basename in the
member's shared blog/files/ dir (dest.exists() -> reuse). Old nogizaka posts
use per-post CDN directories with generic basenames (0000.jpeg, 0001.jpeg, …),
so once one post's image landed as files/0000.jpeg, every other post
referencing 0000.jpeg silently displayed that first post's image. Thumbnails
collided the same way.

Repair strategy (per member with collisions):
  1. find basenames referenced by more than one entry (content or thumbnail)
  2. refetch those entries from the official diary JSON API (public, no auth —
     the same endpoint grab-blog.py uses), which still returns the ORIGINAL
     content with per-post image URLs
  3. re-download those images to <entry_id>_<basename> and rewrite the
     affected entries' content/thumbnail to the new local paths

Idempotent: after a repair no basename is referenced by 2+ entries, so a
second run is a no-op. Entries the API no longer serves (or whose images
404) are left untouched and reported — nothing is lost.

Usage:
    python3 tools/repair-blog-images.py                # both sites, all members
    python3 tools/repair-blog-images.py --site nogizaka46
    python3 tools/repair-blog-images.py --member 筒井_あやめ
    python3 tools/repair-blog-images.py --dry-run
"""
import argparse
import importlib.util
import json
import os
import re
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
MEDIA = Path(os.environ.get("MEDIA_DIR") or ROOT / "media")

# import grab-blog.py (hyphenated filename) for fetch/fetch_json/SITES/member_url
spec = importlib.util.spec_from_file_location("grab_blog", ROOT / "tools" / "grab-blog.py")
gb = importlib.util.module_from_spec(spec)
sys.modules["grab_blog"] = gb
spec.loader.exec_module(gb)

PAGE = 100          # entries per diary page when refetching
SLEEP = 0.4         # polite gap between image downloads
REF_RE = re.compile(r'files/([^"\'<>?\\]+)')


def refs_of(entry: dict) -> list[str]:
    """local basenames referenced by an entry (content srcs + thumbnail)"""
    out = REF_RE.findall(entry.get("content") or "")
    t = entry.get("thumbnail") or ""
    if t.startswith("files/"):
        out.append(t[len("files/"):])
    return out


def find_collisions(entries: list[dict]) -> dict[str, list[str]]:
    """basename -> [entry ids] for basenames referenced by 2+ entries"""
    seen: dict[str, list[str]] = {}
    for e in entries:
        for b in set(refs_of(e)):
            seen.setdefault(b, []).append(str(e["id"]))
    return {b: ids for b, ids in seen.items() if len(ids) > 1}


def fetch_diary(site: dict, uuid: str, want_ids: set[str], max_pages: int = 30) -> dict[str, dict]:
    """paginate the public diary API until all wanted entry ids are seen"""
    got: dict[str, dict] = {}
    for start in range(0, max_pages * PAGE, PAGE):
        url = gb.member_url(site, uuid, PAGE, start)
        try:
            data = gb.fetch_json(url)
        except Exception as e:
            print(f"    diary page st={start} failed: {e}")
            break
        items = data.get("blog") if isinstance(data, dict) else None
        if not items:
            break
        for it in items:
            eid = str(it.get("id"))
            if eid in want_ids:
                got[eid] = it
        if want_ids <= got.keys():
            break
        time.sleep(gb.SLEEP)
    return got


def basename(url: str) -> str:
    return url.split("?")[0].rstrip("/").rsplit("/", 1)[-1]


def repair_entry(member_dir: Path, eid: str, item: dict) -> tuple[bool, int, str, str | None]:
    """re-download one entry's images under <eid>_<base>; rewrite refs.
    Returns (changed, n_images, new_content, new_thumbnail).
    If nothing could be downloaded the entry should be left untouched."""
    files_dir = member_dir / "files"

    def local(url: str) -> str | None:
        base = basename(url)
        if not base or "." not in base:
            return None
        name = f"{eid}_{base}"
        dest = files_dir / name
        if dest.exists() and dest.stat().st_size > 0:
            return name
        for attempt in (1, 2, 3):
            try:
                dest.write_bytes(gb.fetch(url, timeout=60))
                return name
            except Exception as e:
                if attempt == 3:
                    print(f"    [img] {eid}/{base}: {e}")
                    return None
                time.sleep(2 * attempt)
        return None

    # map original basename -> local name, downloading as we go
    renames: dict[str, str] = {}
    thumb = item.get("thumbnail") or ""
    if thumb:
        n = local(thumb)
        if n:
            renames[basename(thumb)] = n
    content = item.get("content") or ""
    for url in re.findall(r'(?:src\s*=\s*["\'])([^"\']+)', content):
        url = gb.html.unescape(url)
        if not re.match(r"https?://", url):
            continue
        base = basename(url)
        if not base or "." not in base or base in renames:
            continue
        n = local(url)
        if n:
            renames[base] = n
        time.sleep(SLEEP)

    if not renames:
        return False, 0, content, None

    # rebuild content from the API's ORIGINAL html, pointing every downloaded
    # image at files/<eid>_<base> (undownloaded URLs are left as-is)
    mapping: dict[str, str] = {}

    def repl(m: re.Match) -> str:
        url = gb.html.unescape(m.group(2))
        n = renames.get(basename(url))
        if n:
            mapping[m.group(2)] = f"files/{n}"
            return m.group(1) + f"files/{n}" + m.group(3)
        return m.group(0)

    new_content = re.sub(r'(src\s*=\s*["\'])([^"\']+)(["\'])', repl, content)
    new_thumb = None
    if thumb and basename(thumb) in renames:
        new_thumb = f"files/{renames[basename(thumb)]}"
    return True, len(renames), new_content, new_thumb


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", choices=list(gb.SITES))
    ap.add_argument("--member", help="member dir name (e.g. 筒井_あやめ)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    tot_members = tot_entries = tot_imgs = tot_fail = 0
    for site_key, site in gb.SITES.items():
        if args.site and site_key != args.site:
            continue
        root = MEDIA / site_key / "blogs"
        if not root.exists():
            continue
        for jf in sorted(root.glob("*/blog/_blogs.json")):
            if args.member and jf.parent.parent.name != args.member:
                continue
            member_dir = jf.parent
            state = json.loads(jf.read_text())
            entries: dict[str, dict] = {str(e["id"]): e for e in state.get("entries", [])}
            collisions = find_collisions(list(entries.values()))
            if not collisions:
                continue
            want_ids = {eid for ids in collisions.values() for eid in ids}
            name = jf.parent.parent.name
            print(f"{site_key}/{name}: {len(entries)} entries, "
                  f"{len(collisions)} collided basenames -> {len(want_ids)} entries to repair")

            fresh = fetch_diary(site, str(state.get("member_uuid") or ""), want_ids)
            missing = want_ids - fresh.keys()
            if missing:
                print(f"    [warn] API no longer serves {len(missing)} entries: "
                      f"{sorted(missing)[:8]}{'…' if len(missing) > 8 else ''}")

            changed_n, img_n, fail_n = 0, 0, 0
            for eid in sorted(want_ids):
                item = fresh.get(eid)
                if item is None:
                    fail_n += 1
                    continue
                changed, n_img, new_content, new_thumb = repair_entry(member_dir, eid, item)
                if not changed:
                    fail_n += 1
                    continue
                if not args.dry_run:
                    entries[eid]["content"] = new_content
                    if new_thumb:
                        entries[eid]["thumbnail"] = new_thumb
                changed_n += 1
                img_n += n_img
            print(f"    repaired {changed_n}/{len(want_ids)} entries, {img_n} images"
                  + (f", {fail_n} FAILED" if fail_n else ""))

            if not args.dry_run and changed_n:
                state["entries"] = sorted(entries.values(), key=lambda e: str(e.get("id")))
                tmp = jf.with_name(jf.name + ".tmp")
                tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1))
                tmp.replace(jf)
            tot_members += 1
            tot_entries += changed_n
            tot_imgs += img_n
            tot_fail += fail_n
            time.sleep(gb.SLEEP)

    print(f"\ndone: {tot_members} member(s), {tot_entries} entries repaired, "
          f"{tot_imgs} images re-downloaded, {tot_fail} entries left as-is")


if __name__ == "__main__":
    main()
