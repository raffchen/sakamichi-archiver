#!/usr/bin/env python
"""Bulk-download all media messages per member from the Message (Sony Music) apps.

Requirements (no emulator needed):
  - A stored refresh token (tools/capture-refresh.py, harvested once after a
    login) lets tokens be renewed with a plain API call — no browser required;
  - or: desktop Chrome running with --remote-debugging-port=9222 and a
    logged-in session (fallback: token grabbed from the app's own requests);
  - Signed CDN URLs expire (~10 min), so files are downloaded immediately after
    the API pages are fetched.

Usage:
  python tools/grab-media.py                                  # nogizaka46, all subscribed members
  python tools/grab-media.py --member-id 47                   # one member by id
  python tools/grab-media.py --member "Teresa"                # name substring match
  python tools/grab-media.py --site sakurazaka46              # sakurazaka46
  python tools/grab-media.py --site sakurazaka46 --member-id 82 --full-history
                                                              # walk ALL history (123 days etc.)
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Paths resolve from the script's location by default; in a container they are
# overridden by env (see docs/deployment.md): MEDIA_DIR + LOGS_DIR.
ROOT = Path(__file__).resolve().parent.parent
OUT = Path(os.environ.get("MEDIA_DIR") or ROOT / "media")
LOGS = Path(os.environ.get("LOGS_DIR") or ROOT / "logs")

SITES = {
    "nogizaka46": {
        "key": "nogizaka46",
        "base": "https://api.message.nogizaka46.com/v2",
        "web": "https://message.nogizaka46.com",
        "app_id": "jp.co.sonymusic.communication.nogizaka 2.5",
        "token_file": LOGS / "api-token.txt",
        "cookie_file": LOGS / "nogizaka-session-cookie.txt",
    },
    "sakurazaka46": {
        "key": "sakurazaka46",
        "base": "https://api.message.sakurazaka46.com/v2",
        "web": "https://message.sakurazaka46.com",
        "app_id": "jp.co.sonymusic.communication.sakurazaka 2.5",
        "token_file": LOGS / "sakura-token.txt",
        "cookie_file": LOGS / "sakura-session-cookie.txt",
    },
}

# tokens are fetched from desktop Chrome over CDP (see tools/capture-refresh.py
# for how the long-lived refresh token is harvested once after login)
sys.path.insert(0, str(Path(__file__).parent))
import cdp as cdp_mod

MEDIA_TYPES = {"picture", "video", "audio", "voice"}

# ---------------------------------------------------------------- status
# Session bookkeeping (docs/deployment.md §3.7): every run records whether the
# session cookie works into logs/<site>-session-status.json — the viewer's
# GET /api/secrets/status summarizes these and session-upload.py --check
# prints them. If NOTIFY_URL is set (ntfy / SMTP / webhook), a failure and the
# subsequent recovery are pushed; repeat-failures stay quiet (no spam).


def _atomic_write(path: Path, text: str) -> None:
    """tmp + rename so a reader never observes a half-written file"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def _notify(site_key: str, message: str) -> None:
    url = os.environ.get("NOTIFY_URL")
    if not url:
        return
    try:
        req = urllib.request.Request(
            url,
            data=f"[{site_key}] {message}".encode("utf-8"),
            method="POST",
            headers={"Title": "sakamichi syncer", "User-Agent": "grab-media"},
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:  # never let monitoring break syncing
        print(f"[status] notify failed: {e}")


def record_session_status(site: dict, ok: bool, error: str | None = None) -> None:
    key = site["key"]
    sf = LOGS / f"{key}-session-status.json"
    prev = None
    try:
        if sf.exists():
            prev = json.loads(sf.read_text(encoding="utf-8")).get("ok")
    except Exception:
        pass
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _atomic_write(sf, json.dumps(
        {"site": key, "ok": ok, "checked_at": now, "last_error": error},
        ensure_ascii=False,
    ))
    state = "OK" if ok else "EXPIRED"
    detail = f" ({error})" if error else ""
    print(f"[status] {key}: session {state}{detail}")
    if not ok and prev is not False:  # fresh failure (or first record) → push
        _notify(key, f"session EXPIRED — archive paused until a fresh cookie "
                     f"is uploaded{detail}")
    elif ok and prev is False:        # recovery → push
        _notify(key, "session recovered — sync resuming")


def api_headers(token: str, site: dict) -> dict:
    return {
        "Authorization": token if token.startswith("Bearer ") else "Bearer " + token,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Talk-App-ID": site["app_id"],
        "X-Talk-App-Platform": "web",
        "User-Agent": "Mozilla/5.0 (Linux; Android 14) Chrome/113",
        "Referer": site["web"] + "/",
    }


def refresh_token_via_cdp(site: dict) -> str:
    """Grab the app's current Bearer token by watching desktop Chrome's requests.

    Requires Chrome running with --remote-debugging-port=9222 and a logged-in
    session on the site (see README). Returns "" if Chrome isn't reachable —
    a missing fallback is a sync failure to record, never a crash.
    """
    try:
        c = cdp_mod.connect(site["web"].split("https://")[1].split(".")[0])
        tok = {}
        def on_req(p):
            h = p["request"].get("headers", {})
            a = h.get("Authorization") or h.get("authorization")
            if a and "authorization" not in tok:
                tok["authorization"] = a.split("Bearer ")[-1]
        c.on("Network.requestWillBeSent", on_req)
        c.send("Network.enable")
        c.send("Page.enable")
        c.navigate(site["web"] + "/organization/1/talk/timeline")
        c.pump(12)
        c.close()
    except Exception as e:
        print(f"    CDP fallback unavailable: {e}")
        return ""
    token = tok.get("authorization", "")
    if token:
        site["token_file"].write_text(token)
    return token


def token_expiry(token: str) -> "datetime":
    """Decode the exp claim of an access token (UTC)."""
    import base64 as _b64
    from datetime import datetime as _dt, timezone as _tz
    payload = token.removeprefix("Bearer ").split(".")[1]
    claims = json.loads(_b64.urlsafe_b64decode(payload + "=="))
    return _dt.fromtimestamp(claims["exp"], _tz.utc)


def refresh_token_via_api(site: dict) -> str:
    """Renew the access token with the stored server session cookie.

    POST /v2/update_token with `Cookie: session=<id>` (the body's refresh_token
    stays null — the server keys on the cookie; see tools/keep-alive.py).
    The cookie is harvested once per login by tools/harvest-session.py.
    Returns the new raw access token (no Bearer prefix), or "" on failure.
    """
    cf = site["cookie_file"]
    if not cf.exists() or not cf.read_text().strip():
        return ""
    sess = cf.read_text().strip()
    req = urllib.request.Request(
        site["base"] + "/update_token",
        data=json.dumps({"refresh_token": None}).encode(),
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Cookie": f"session={sess}",
            "X-Talk-App-ID": site["app_id"],
            "X-Talk-App-Platform": "web",
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36",
            "Origin": site["web"],
            "Referer": site["web"] + "/",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read())
            # persist the rotated session cookie (Set-Cookie, Path=/v2/update_token)
            import re
            for sc in r.headers.get_all("Set-Cookie") or []:
                m = re.match(r"session=([^;\s]+); Path=/v2/update_token", sc)
                if m:
                    _atomic_write(cf, m.group(1))
                    break
    except urllib.error.HTTPError as e:
        return ""
    tok = resp.get("access_token", "")
    if tok:
        site["token_file"].write_text(tok)
    return tok


def get_token(site: dict) -> str:
    tok = site["token_file"].read_text().strip() if site["token_file"].exists() else ""
    return tok.removeprefix("Bearer ")


def api_get(path: str, token: str, site: dict):
    req = urllib.request.Request(BASE_(site) + path, headers=api_headers(token, site))
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def BASE_(site: dict) -> str:
    return site["base"]


def download(url: str, dest: Path, retries: int = 3) -> bool:
    if dest.exists() and dest.stat().st_size > 0:
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
                while True:
                    chunk = r.read(1 << 16)
                    if not chunk:
                        break
                    f.write(chunk)
            return True
        except urllib.error.HTTPError as e:
            if e.code in (403, 410):  # signature expired -> caller should re-sync
                raise
            time.sleep(2 * (attempt + 1))
        except OSError:
            time.sleep(2 * (attempt + 1))
    return False


def slugify(name: str) -> str:
    return re.sub(r"[^\w.-]+", "_", name).strip("_")


def fetch_member_media(member_id: int, token: str, site: dict, full_history: bool,
                       from_date: str) -> tuple[list, list]:
    """Fetch all messages. Returns (all_messages, media_entries)."""
    entries = {}
    try:
        tl = api_get(f"/groups/{member_id}/timeline?count=200&order=desc", token, site)
        for m in tl.get("messages", []):
            entries[m["id"]] = m
    except urllib.error.HTTPError as e:
        print(f"    timeline HTTP {e.code}")

    if full_history:
        cursor = from_date
        for _ in range(500):
            try:
                q = urllib.parse.quote(cursor)
                r = api_get(f"/groups/{member_id}/timeline?count=200&order=asc&updated_from={q}",
                            token, site)
            except urllib.error.HTTPError as e:
                print(f"    history walk HTTP {e.code} at {cursor}")
                break
            msgs = r.get("messages", [])
            if not msgs:
                break
            for m in msgs:
                entries.setdefault(m["id"], m)
            ats = sorted(m["updated_at"] for m in msgs)
            cursor = ats[-1]
            newest = max(m["updated_at"] for m in entries.values())
            if ats[-1] >= newest and len(msgs) < 200:
                break
        # past_messages as a safety net for anything before from_date
        try:
            pm = api_get(f"/groups/{member_id}/past_messages", token, site)
            for m in (pm.get("messages", []) if isinstance(pm, dict) else pm):
                entries.setdefault(m["id"], m)
        except urllib.error.HTTPError:
            pass
    else:
        try:
            pm = api_get(f"/groups/{member_id}/past_messages", token, site)
            for m in (pm.get("messages", []) if isinstance(pm, dict) else pm):
                entries.setdefault(m["id"], m)
        except urllib.error.HTTPError as e:
            print(f"    past_messages HTTP {e.code}")

    all_msgs = sorted(entries.values(), key=lambda m: (m["published_at"], m["id"]))
    media = [m for m in all_msgs if m.get("type") in MEDIA_TYPES and m.get("file")]
    media.reverse()  # newest first, as before
    return all_msgs, media


def transcript_line(m: dict) -> str:
    """Render one message as markdown."""
    ts = m["published_at"].replace("T", " ")[:16]
    text = (m.get("text") or "").replace("%%%", "raff")
    if m["type"] in MEDIA_TYPES:
        fname = f"{m['id']}_{m['published_at'].replace(':', '-')}.{ext_of(m['file'])}"
        rel = f"{m['type']}/{fname}"
        head = f"**{m['type']}** · `{rel}` · {ts} · id {m['id']}"
        body = f"\n\n![]({rel})\n" if m["type"] != "audio" else ""
        caption = f"\n\n> {text}" if text else ""
        return head + body + caption + "\n"
    return f"**text** · {ts} · id {m['id']}\n\n{text or '_(no text)_'}\n"


def ext_of(url: str) -> str:
    m = re.search(r"\.([a-z0-9]{2,5})(?:\?|$)", url)
    return m.group(1) if m else "bin"


def process_member(member: dict, token: str, site: dict, full_history: bool,
                   from_date: str) -> tuple[int, int]:
    mid, name = member["id"], member["name"]
    slug = slugify(name)
    print(f"[{mid}] {name}")
    got = skipped = 0
    try:
        all_msgs, media = fetch_member_media(mid, token, site, full_history, from_date)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return got, skipped
        raise
    print(f"    {len(media)} media messages (of {len(all_msgs)} total)")
    for m in media:
        url = m["file"]
        fname = f"{m['id']}_{m['published_at'].replace(':', '-')}.{ext_of(url)}"
        dest = OUT / slug / m["type"] / fname
        try:
            if download(url, dest):
                got += 1
            else:
                skipped += 1
        except urllib.error.HTTPError:
            # signature expired mid-run: re-sync this member with a fresh token
            token = refresh_token_via_api(site) or refresh_token_via_cdp(site)
            if not token:
                record_session_status(site, False, "mid-run token refresh failed")
                break
            all_msgs, media = fetch_member_media(mid, token, site, full_history, from_date)
            for m2 in media:  # retry the member's media once with new signatures
                u2 = m2["file"]
                d2 = OUT / slug / m2["type"] / f"{m2['id']}_{m2['published_at'].replace(':', '-')}.{ext_of(u2)}"
                if download(u2, d2):
                    got += 1
            break
    print(f"    downloaded: {got}, already present: {skipped}")

    # current profile picture(s) — public CDN, not signed, no expiry
    try:
        members = api_get(f"/groups/{mid}/members", token, site)
        # the response may include the org's group account (e.g. 櫻坂46) whose
        # `groups` lists every chat group — real members are letter destinations
        # and always belong to the requested group
        members = [m for m in members
                   if m.get("is_letter_destination") and mid in m.get("groups", [])]
        prof_got = 0
        for mem in members:
            for key in ("thumbnail", "phone_image"):
                url = mem.get(key)
                if not url:
                    continue
                base = url.split("?")[0].rsplit("/", 1)[-1]
                if download(url, OUT / slug / "profile" / base):
                    prof_got += 1
        if prof_got:
            print(f"    profile pictures: {prof_got}")
        # _atomic_write mkdirs — the profile dir only exists when a thumbnail
        # was downloaded (e.g. the org accounts 乃木坂46/櫻坂46 have none)
        _atomic_write(OUT / slug / "profile" / "_profile.json",
                      json.dumps(members, ensure_ascii=False, indent=1))
    except urllib.error.HTTPError as e:
        print(f"    profile HTTP {e.code}")

    # "current single" artwork shown on the home/Talk page — comes from the
    # groups listing itself (public CDN, no signing); changes with every single
    try:
        single_got = 0
        for key in ("thumbnail", "phone_image"):
            url = member.get(key)
            if not url:
                continue
            base = url.split("?")[0].rsplit("/", 1)[-1]
            if download(url, OUT / slug / "single" / base):
                single_got += 1
        if single_got:
            print(f"    single artwork: {single_got}")
    except urllib.error.HTTPError as e:
        print(f"    single HTTP {e.code}")

    # manifest (media only) + full message archive + readable transcript —
    # atomic so the viewer's index builder never reads a half-written file
    _atomic_write(OUT / slug / "_manifest.json",
                  json.dumps(media, ensure_ascii=False, indent=1))
    _atomic_write(OUT / slug / "_messages.json",
                  json.dumps(all_msgs, ensure_ascii=False, indent=1))
    _atomic_write(OUT / slug / "_transcript.md",
                  f"# {name}\n\n" + "\n---\n\n".join(transcript_line(m) for m in all_msgs))
    # which site this folder belongs to — nothing else in media/ records it, and
    # the viewer needs it to put the member under the right site tab
    gid = member.get("group_id") or (all_msgs[0].get("group_id") if all_msgs else None)
    _atomic_write(
        OUT / slug / "_member.json",
        json.dumps(
            {
                "site": site.get("key", "?"),
                "name": name,
                "group_id": gid,
                "member_id": mid,
                "web": site["web"],
            },
            ensure_ascii=False,
            indent=1,
        ),
    )
    return got, skipped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", choices=sorted(SITES), default="nogizaka46")
    ap.add_argument("--member-id", type=int)
    ap.add_argument("--member", type=str, help="name substring")
    ap.add_argument("--subscribed", action="store_true",
                    help="only member chats with an active paid subscription "
                         "(excludes the free group accounts 乃木坂46/櫻坂46)")
    ap.add_argument("--full-history", action="store_true",
                    help="walk the full timeline via updated_from cursor")
    ap.add_argument("--from", dest="from_date", default="2024-01-01T00:00:00Z",
                    help="start date for full history walk")
    args = ap.parse_args()

    site = SITES[args.site]
    token = get_token(site) or refresh_token_via_api(site) or refresh_token_via_cdp(site)
    if not token:
        record_session_status(site, False,
                              "no working token: session cookie expired/revoked "
                              "and no CDP fallback")
        print("No token. Run `python tools/keep-alive.py` to renew via the "
              "session cookie, or re-login + `python tools/harvest-session.py`.")
        sys.exit(1)
    record_session_status(site, True)

    try:
        groups = api_get("/groups?organization_id=1", token, site)
    except urllib.error.HTTPError as e:
        print(f"listing failed (HTTP {e.code}); refreshing token")
        token = refresh_token_via_api(site) or refresh_token_via_cdp(site)
        if not token:
            sys.exit("token refresh failed")
        groups = api_get("/groups?organization_id=1", token, site)

    members = groups
    if args.subscribed:
        members = [m for m in members
                   if (m.get("subscription") or {}).get("state") == "active"
                   and m.get("subscription", {}).get("type") != "free"]
        for m in members:
            print(f"  subscribed: {m['name']} (id={m['id']})")
    if args.member_id:
        members = [m for m in members if m["id"] == args.member_id]
    elif args.member:
        s = args.member.lower()
        members = [m for m in members if s in m["name"].lower()]
    print(f"{len(members)} member(s) to process")

    total_got = total_skip = 0
    for m in members:
        got, skip = process_member(m, token, site, args.full_history, args.from_date)
        total_got += got
        total_skip += skip
    print(f"DONE. downloaded {total_got}, already present {total_skip}")


if __name__ == "__main__":
    main()
