#!/usr/bin/env python3
"""tools/grab-blog.py — archive the members' official blogs (Blog tab).

The Message app's Blog tab mirrors the official sites' member diaries, which
expose a PUBLIC JSON API (no auth, no session — safe to run anywhere):

    GET /v2/blog-sources?organization_id=1   (message API; needs Bearer token)
      -> members_latest_url / update_url / member_url templates pointing at
         www.nogizaka46.com / sakurazaka46.com  .../api/json/diary?...

Per member we fetch pages (newest first) until we hit already-archived ids,
download thumbnails + inline images, and rewrite the HTML to local paths.

Storage:
    <BLOGS_DIR>/<member_name>/blog/_blogs.json   entries, oldest first
    <BLOGS_DIR>/<member_name>/blog/files/*       images
BLOGS_DIR defaults to <MEDIA_DIR>/blogs (a sibling tree, so members without a
message subscription get archive dirs too; the viewer serves it under /media).

Member identity: --all archives EVERY blog member (GET /v2/blog-members,
token required — cached under LOGS so later runs work without a token).
Default (no flags) archives the members configured in
viewer/archive.config.json, matched by `roman` name. Nogizaka display names
come from the official site's public JSONP (romaji -> kanji).

Usage:
    python3 tools/grab-blog.py                 # configured members only
    python3 tools/grab-blog.py --all           # every blog member, both sites
    python3 tools/grab-blog.py --all --site sakurazaka46
    python3 tools/grab-blog.py --member 山川_宇衣
    python3 tools/grab-blog.py --full          # refetch everything (no skip)
"""
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
MEDIA = Path(os.environ.get("MEDIA_DIR") or ROOT / "media")
BLOGS = Path(os.environ.get("BLOGS_DIR") or MEDIA / "blogs")
LOGS = Path(os.environ.get("LOGS_DIR") or ROOT / "logs")
CONFIG = Path(os.environ.get("BLOG_CONFIG") or ROOT / "viewer" / "archive.config.json")

PAGE = 50          # entries per diary page
SLEEP = 1.0        # polite gap between requests to the official sites

SITES = {
    "nogizaka46": {
        "api": "https://api.message.nogizaka46.com/v2",
        "app_id": "jp.co.sonymusic.communication.nogizaka 2.5",
        "token_file": LOGS / "api-token.txt",
        "members_cache": LOGS / "blog-members-nogizaka46.json",
        # fallback templates (refreshed from /v2/blog-sources when a token works)
        "member_url": ("https://www.nogizaka46.com/s/n46/api/json/diary"
                       "?cd=MEMBER&get=B&member_id=${member_id}&getnum=${count}&st=${start}"),
    },
    "sakurazaka46": {
        "api": "https://api.message.sakurazaka46.com/v2",
        "app_id": "jp.co.sonymusic.communication.sakurazaka 2.5",
        "token_file": LOGS / "sakura-token.txt",
        "members_cache": LOGS / "blog-members-sakurazaka46.json",
        "member_url": ("https://sakurazaka46.com/s/s46app/api/json/diary"
                       "?cd=blog&get=B&member_id=${member_id}&getnum=${count}&st=${start}"),
    },
}

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) sakamichi-archiver"}


def fetch(url: str, headers: dict | None = None, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers=headers or UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_json(url: str, headers: dict | None = None) -> dict | list:
    return json.loads(fetch(url, headers).decode("utf-8", "replace"))


def api_get(site: dict, path: str) -> object:
    token = site["token_file"].read_text().strip() if site["token_file"].exists() else ""
    hdrs = dict(UA)
    if token:
        hdrs |= {
            "Authorization": token if token.startswith("Bearer ") else "Bearer " + token,
            "X-Talk-App-ID": site["app_id"],
            "X-Talk-App-Platform": "web",
        }
    return fetch_json(site["api"] + path, hdrs)


def atomic_write(path: Path, data: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(data, encoding="utf-8")
    tmp.replace(path)


def norm_name(s: str) -> str:
    # sites mix romaji and kanji; also normalize the 﨑/崎 variant (川﨑/山﨑)
    return s.replace("_", " ").replace("﨑", "崎").replace(" ", "").casefold()


def nogi_official_names() -> dict[str, str]:
    """code (== member_uuid) -> kanji name, from the official site's public
    JSONP — blog-members returns romaji for nogizaka, and the archive dirs
    should be kanji like the messages tree"""
    try:
        raw = fetch("https://www.nogizaka46.com/s/n46/api/list/member?callback=res")
        data = json.loads(re.search(r"res\((.*)\)\s*;?\s*$", raw.decode("utf-8", "replace"), re.S).group(1))["data"]
        return {str(x["code"]): x["name"] for x in data if x.get("name")}
    except Exception as e:
        print(f"  [names] official JSONP unavailable ({e}) — romaji dirs will be used")
        return {}


def load_members(site_key: str, site: dict) -> dict[str, dict]:
    """name key (romaji or japanese, normalized) -> {member_uuid, group_id};
    cached so later runs work without a token"""
    cache = site["members_cache"]
    try:
        members = api_get(site, "/blog-members")
        atomic_write(cache, json.dumps(members, ensure_ascii=False))
        print(f"  [members] {len(members)} from API (cached to {cache.name})")
    except Exception as e:
        if not cache.exists():
            raise SystemExit(f"  [members] no token and no cache ({e}) — run once with a valid token")
        members = json.loads(cache.read_text())
        print(f"  [members] API unavailable ({e}) — using cached {len(members)}")
    jp_names = nogi_official_names() if site_key == "nogizaka46" else {}
    out = {}
    for m in members:
        if (m.get("name") or "").endswith("リレー"):
            continue  # relay accounts, not real members
        uuid = str(m["member_uuid"])
        display = jp_names.get(uuid) or m.get("name") or uuid
        out[norm_name(m.get("name") or "")] = {
            "uuid": uuid, "blog_id": m["id"], "group_id": m.get("group_id"),
            "name": m.get("name"), "display": display,
        }
    return out


def member_url(site: dict, uuid: str, count: int, start: int) -> str:
    try:
        src = api_get(site, "/blog-sources?organization_id=1")
        if isinstance(src, list) and src:
            site["member_url"] = src[0].get("member_url") or site["member_url"]
    except Exception:
        pass  # fall back to the known template
    return (site["member_url"].replace("${member_id}", uuid)
            .replace("${count}", str(count)).replace("${start}", str(start)))


def download_images(member_dir: Path, content: str, thumbnail: str) -> tuple[str, list[str]]:
    """download content <img> + thumbnail; rewrite HTML to local files/ paths"""
    files_dir = member_dir / "files"
    files_dir.mkdir(parents=True, exist_ok=True)
    saved = []

    def local_name(url: str) -> str | None:
        base = url.split("?")[0].rstrip("/").rsplit("/", 1)[-1]
        if not base or "." not in base:
            return None
        dest = files_dir / base
        for attempt in (1, 2, 3):  # WSL/office networks flake; retry a bit
            if dest.exists():
                return base
            try:
                dest.write_bytes(fetch(url, timeout=60))
                saved.append(base)
                return base
            except Exception as e:
                if attempt == 3:
                    print(f"    [img] skip {base}: {e}")
                    return None
                time.sleep(2 * attempt)

    if thumbnail:
        local_name(thumbnail)  # ensure the thumb is archived too
    mapping: dict[str, str] = {}

    def repl(m: re.Match) -> str:
        url = html.unescape(m.group(2))
        n = local_name(url)
        if n:
            mapping[m.group(2)] = f"files/{n}"
            return m.group(1) + f"files/{n}" + m.group(3)
        return m.group(0)

    content = re.sub(r'(src\s*=\s*["\'])([^"\']+)(["\'])', repl, content or "")
    return content, saved


def grab_member(site_key: str, site: dict, members: dict[str, dict],
                member_key: str, info: dict, only_new: bool = True) -> None:
    print(f"  {member_key}: blog member {info['name']} (uuid {info['uuid']})")
    member_dir = BLOGS / member_key / "blog"
    state_file = member_dir / "_blogs.json"
    state = {"site": site_key, "member": info.get("display") or member_key,
             "member_uuid": info["uuid"], "updated": None, "entries": []}
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text())
        except Exception:
            pass
    known = {str(e["id"]) for e in state["entries"]}
    if only_new and known:
        print(f"  {member_key}: {len(known)} archived, checking for new…")

    entries: dict[str, dict] = {str(e["id"]): e for e in state["entries"]}
    start, new_total = 0, 0
    while True:
        url = member_url(site, info["uuid"], PAGE, start)
        try:
            data = fetch_json(url)
        except Exception as e:
            print(f"  {member_key}: diary fetch failed ({e})")
            return
        items = data.get("blog") or []
        if not items:
            break
        new_here, saved = 0, []
        for it in items:
            eid = str(it.get("id"))
            if eid in known and only_new:
                continue
            content, saved = download_images(member_dir, it.get("content") or "", it.get("thumbnail") or "")
            entries[eid] = {
                "id": it.get("id"),
                "title": it.get("title"),
                "creator": it.get("creator"),
                "at": it.get("pubdate"),
                "link": it.get("link"),
                "thumbnail": (lambda b: f"files/{b}" if b and (member_dir / "files" / b).exists() else None)(Path(it.get("thumbnail") or "").name),
                "content": content,
                "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            known.add(eid)
            new_here += 1
        new_total += new_here
        print(f"    page st={start}: {len(items)} entries, {new_here} new, {len(saved)} images")
        # stop when a full page yields nothing new (we've reached the archive) —
        # or when the page is short (last page)
        if only_new and new_here == 0:
            break
        if len(items) < PAGE:
            break
        start += PAGE
        time.sleep(SLEEP)

    if new_total:
        ordered = sorted(entries.values(), key=lambda e: e.get("at") or "")
        state["entries"] = ordered
        state["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        atomic_write(state_file, json.dumps(state, ensure_ascii=False, indent=1))
        print(f"  {member_key}: +{new_total} -> {len(ordered)} total (blog/_blogs.json)")
    else:
        print(f"  {member_key}: up to date")


def main() -> None:
    only = None
    if "--member" in sys.argv:
        only = sys.argv[sys.argv.index("--member") + 1]
    full = "--full" in sys.argv
    grab_all = "--all" in sys.argv
    site_filter = None
    if "--site" in sys.argv:
        site_filter = sys.argv[sys.argv.index("--site") + 1]
        if site_filter not in SITES:
            raise SystemExit(f"--site must be one of: {', '.join(SITES)}")

    if grab_all:
        for site_key, site in SITES.items():
            if site_filter and site_key != site_filter:
                continue
            try:
                members = load_members(site_key, site)
            except SystemExit as e:
                print(e)
                continue
            print(f"=== {site_key}: {len(members)} blog member(s) ===")
            for info in members.values():
                key = info["display"].replace(" ", "_")
                try:
                    grab_member(site_key, site, members, key, info, only_new=not full)
                except Exception as e:
                    print(f"  {key}: FAILED ({e}) — continuing")
                time.sleep(SLEEP)
    else:
        cfg = json.loads(CONFIG.read_text())
        members_cfg = cfg.get("members", {})
        by_site: dict[str, list[str]] = {}
        for name, m in members_cfg.items():
            by_site.setdefault(m.get("site"), []).append(name)

        for site_key, names in by_site.items():
            if only:
                names = [n for n in names if n == only]
                if not names:
                    continue
            site = SITES[site_key]
            print(f"=== {site_key}: {len(names)} member(s) ===")
            try:
                members = load_members(site_key, site)
            except SystemExit as e:
                print(e)
                continue
            for name in names:
                info = members.get(norm_name(members_cfg[name]["roman"])) or members.get(norm_name(name))
                if info is None:
                    print(f"  {name}: no blog member match — skipped")
                    continue
                grab_member(site_key, site, members, name, info, only_new=not full)
                time.sleep(SLEEP)
    print("done.")


if __name__ == "__main__":
    main()
