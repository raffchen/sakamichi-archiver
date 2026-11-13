#!/usr/bin/env python
"""Keep the Message (Sony Music) session alive — no browser needed.

The web app's login sets a long-lived httpOnly `session` cookie on
.message.<site>.com. POST /v2/update_token with that cookie (the body's
refresh_token stays null — the server keys on the cookie) returns a fresh
1-hour access token, which grab-media.py uses.

Cookie files: logs/nogizaka-session-cookie.txt / logs/sakura-session-cookie.txt
Harvest/refresh them after any manual login: python tools/harvest-session.py

Usage:
  python tools/keep-alive.py                 # renew both sites once
  python tools/keep-alive.py nogizaka        # one site
  python tools/keep-alive.py --loop 45m      # renew forever
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# LOGS_DIR overrides the token/cookie directory (containers; docs/deployment.md)
ROOT = Path(__file__).resolve().parent.parent
LOGS = Path(os.environ.get("LOGS_DIR") or ROOT / "logs")

SITES = {
    "nogizaka": {
        "origin": "https://message.nogizaka46.com",
        "api": "https://api.message.nogizaka46.com/v2",
        "app_id": "jp.co.sonymusic.communication.nogizaka 2.5",
        "cookie_file": LOGS / "nogizaka-session-cookie.txt",
        "token_file": LOGS / "api-token.txt",
    },
    "sakura": {
        "origin": "https://message.sakurazaka46.com",
        "api": "https://api.message.sakurazaka46.com/v2",
        "app_id": "jp.co.sonymusic.communication.sakurazaka 2.5",
        "cookie_file": LOGS / "sakura-session-cookie.txt",
        "token_file": LOGS / "sakura-token.txt",
    },
}

UA = ("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36")


def _rotated_session(headers) -> str | None:
    """the session=<id> whose cookie path is /v2/update_token (the rotation)"""
    import re
    for sc in headers.get_all("Set-Cookie") or []:
        m = re.match(r"session=([^;\s]+); Path=/v2/update_token", sc)
        if m:
            return m.group(1)
    return None


def token_expiry(token: str):
    from datetime import datetime, timezone
    claims = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
    return datetime.fromtimestamp(claims["exp"], timezone.utc)


def renew(label: str) -> str | None:
    site = SITES[label]
    if not site["cookie_file"].exists() or not site["cookie_file"].read_text().strip():
        print(f"[keep-alive] {label}: no session cookie ({site['cookie_file'].name}) — "
              f"log in once in desktop Chrome and run tools/harvest-session.py")
        return None
    sess = site["cookie_file"].read_text().strip()
    req = urllib.request.Request(
        site["api"] + "/update_token",
        data=json.dumps({"refresh_token": None}).encode(),
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Cookie": f"session={sess}",
            "X-Talk-App-ID": site["app_id"],
            "X-Talk-App-Platform": "web",
            "User-Agent": UA,
            "Origin": site["origin"],
            "Referer": site["origin"] + "/",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read())
            # the renewal ROTATES the session cookie (Set-Cookie with
            # Path=/v2/update_token) — persist it or the next renewal 400s
            rotated = _rotated_session(r.headers)
            if rotated:
                site["cookie_file"].write_text(rotated)
    except urllib.error.HTTPError as e:
        print(f"[keep-alive] {label}: HTTP {e.code} — session cookie expired/revoked. "
              f"Re-login in desktop Chrome, then tools/harvest-session.py")
        return None
    tok = resp.get("access_token", "")
    if tok:
        site["token_file"].write_text(tok)
        exp = token_expiry(tok)
        print(f"[keep-alive] {label}: OK — new access token valid until "
              f"{exp:%Y-%m-%d %H:%M:%SZ} ({exp:%H:%M}Z)")
        return tok
    return None


def parse_interval(s: str) -> float:
    units = {"s": 1, "m": 60, "h": 3600, "d": 86400}
    if s[-1] not in units:
        raise ValueError(f"bad interval {s!r} (use e.g. 45m, 12h)")
    return int(s[:-1]) * units[s[-1]]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("site", nargs="*", choices=["nogizaka", "sakura"],
                    help="sites to renew (default: both)")
    ap.add_argument("--loop", metavar="INTERVAL", help="e.g. 45m — renew forever")
    args = ap.parse_args()

    sites = args.site or ["nogizaka", "sakura"]
    if not args.loop:
        results = [renew(s) for s in sites]
        sys.exit(0 if all(results) else 1)

    seconds = parse_interval(args.loop)
    print(f"[keep-alive] looping every {args.loop}")
    while True:
        for s in sites:
            try:
                renew(s)
            except Exception as e:
                print(f"[keep-alive] {s}: error {e}")
        time.sleep(seconds)
