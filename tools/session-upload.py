#!/usr/bin/env python
"""Recover an expired Message session (docs/deployment.md §3.7).

Reads the fresh session cookies from a logged-in desktop Chrome
(--remote-debugging-port=9222, dedicated profile — see README) via the
browser-level Storage.getCookies — the cookie is httpOnly + lives on
.message.<site>.com, invisible to per-page CDP queries — then either saves
them locally (like harvest-session.py) or uploads them to the running viewer.

Usage:
  python tools/session-upload.py --check                # print session status (local logs/)
  python tools/session-upload.py --check --server URL   # status as the server sees it
  python tools/session-upload.py --server http://nas:8080
      # harvest every site found in Chrome, save locally AND upload;
      # log in to the expired site(s) in desktop Chrome first
  python tools/session-upload.py --server URL --site nogizaka46

The upload needs the server's UPLOAD_TOKEN: set it as an env var or pass
--token (prompted for if missing and a token is required).
"""
import argparse
import getpass
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import websocket  # pip install websocket-client

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
LOGS = Path(os.environ.get("LOGS_DIR") or ROOT / "logs")

HOSTS = ("http://127.0.0.1:{port}", "http://[::1]:{port}")
SITES = {
    "nogizaka46": ".message.nogizaka46.com",
    "sakurazaka46": ".message.sakurazaka46.com",
}
COOKIE_FILES = {
    "nogizaka46": "nogizaka-session-cookie.txt",
    "sakurazaka46": "sakura-session-cookie.txt",
}


def browser_ws_url(port: int = 9222) -> str:
    last_err = None
    for host in (h.format(port=port) for h in HOSTS):
        try:
            ver = json.load(urllib.request.urlopen(host + "/json/version", timeout=5))
            return ver["webSocketDebuggerUrl"]
        except Exception as e:
            last_err = e
    raise SystemExit(
        f"no DevTools endpoint on :{port} ({last_err}) — start desktop Chrome with "
        f"--remote-debugging-port={port} and log in to the expired site(s), "
        "or use --from-files"
    )


def read_files_session_cookies() -> dict[str, str]:
    """site → cookie value, from the local logs/ files (as written by
    harvest-session.py or a previous upload from another browser)"""
    out = {}
    for site, fname in COOKIE_FILES.items():
        f = LOGS / fname
        if f.exists() and f.read_text().strip():
            out[site] = f.read_text().strip()
    return out


def read_browser_session_cookies(port: int = 9222) -> dict[str, str]:
    """domain → cookie value, for every `session` cookie in the browser jar"""
    ws = websocket.create_connection(browser_ws_url(port), timeout=15, suppress_origin=True)
    ws.send(json.dumps({"id": 1, "method": "Storage.getCookies", "params": {}}))
    res = None
    deadline = time.time() + 20
    while time.time() < deadline:
        msg = json.loads(ws.recv())
        if msg.get("id") == 1:
            res = msg.get("result", {})
            break
    ws.close()
    out = {}
    for x in res.get("cookies", []):
        if x["name"] == "session" and x.get("domain") in SITES.values():
            site = next(k for k, d in SITES.items() if d == x["domain"])
            out[site] = x["value"]
    return out


def save_local(site: str, cookie: str) -> None:
    file = LOGS / COOKIE_FILES[site]
    file.parent.mkdir(parents=True, exist_ok=True)
    tmp = file.with_suffix(".txt.tmp")
    tmp.write_text(cookie, encoding="utf-8")
    tmp.replace(file)


def http_json(method: str, url: str, token: str, body: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def print_status(sites: dict) -> bool:
    all_ok = True
    for site, s in sorted(sites.items()):
        if s["ok"] is False:
            all_ok = False
            state = "EXPIRED"
        elif s["ok"] is None:
            state = "no data"
        else:
            state = "OK"
        age = f", cookie rotated {s['cookie_age_days']:.1f}d ago" if s["cookie_age_days"] is not None else ""
        err = f" — {s['last_error']}" if s["last_error"] else ""
        print(f"  {site:<13} {state:<8} checked {s['checked_at'] or '—'}{age}{err}")
    return all_ok


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--server", metavar="URL", help="viewer base URL, e.g. http://nas:8080")
    ap.add_argument("--site", choices=sorted(SITES), help="upload only this site (default: all found in Chrome)")
    ap.add_argument("--check", action="store_true", help="print session status and exit")
    ap.add_argument("--from-files", action="store_true",
                    help="upload cookies from local logs/ files instead of a live browser")
    ap.add_argument("--port", type=int, default=9222,
                    help="browser DevTools port (e.g. 9339 for the local recorder profile)")
    ap.add_argument("--token", help="UPLOAD_TOKEN (default: $UPLOAD_TOKEN or prompt)")
    args = ap.parse_args()

    if args.check:
        if args.server:
            code, res = http_json("GET", args.server.rstrip("/") + "/api/secrets/status",
                                  args.token or os.environ.get("UPLOAD_TOKEN", ""))
            if code == 404:
                raise SystemExit("server has no upload endpoint (UPLOAD_TOKEN not set there)")
            if code == 401:
                token = args.token or os.environ.get("UPLOAD_TOKEN") or getpass.getpass("UPLOAD_TOKEN: ")
                code, res = http_json("GET", args.server.rstrip("/") + "/api/secrets/status", token)
            if code != 200:
                raise SystemExit(f"status check failed: HTTP {code}")
            sys.exit(0 if print_status(res["sites"]) else 2)
        # no server: read local logs/ directly
        sites = {}
        for site in SITES:
            sf = LOGS / f"{site}-session-status.json"
            entry = {"ok": None, "checked_at": None, "last_error": None, "cookie_age_days": None}
            try:
                data = json.loads(sf.read_text(encoding="utf-8"))
                entry.update({k: data.get(k) for k in ("ok", "checked_at", "last_error")})
            except Exception:
                pass
            cf = LOGS / COOKIE_FILES[site]
            if cf.exists():
                entry["cookie_age_days"] = round((time.time() - cf.stat().st_mtime) / 86400, 3)
            sites[site] = entry
        sys.exit(0 if print_status(sites) else 2)

    cookies = read_files_session_cookies() if args.from_files else read_browser_session_cookies(args.port)
    if not cookies:
        raise SystemExit("no session cookies found — log in to the site(s) in desktop Chrome first")
    if args.site:
        cookies = {args.site: cookies[args.site]} if args.site in cookies else {}
        if not cookies:
            raise SystemExit(f"no session cookie for {args.site} in Chrome — log that site in first")

    for site, cookie in sorted(cookies.items()):
        save_local(site, cookie)
        print(f"{site}: cookie saved locally to {COOKIE_FILES[site]}")
        if not args.server:
            continue
        token = args.token or os.environ.get("UPLOAD_TOKEN")
        if not token:
            token = getpass.getpass("UPLOAD_TOKEN: ")
        code, res = http_json("POST", args.server.rstrip("/") + "/api/secrets/session",
                              token, {"site": site, "cookie": cookie})
        if code == 200:
            print(f"{site}: uploaded ✓ — the syncer picks it up on its next cycle")
        elif code == 401:
            raise SystemExit("upload rejected: bad UPLOAD_TOKEN")
        elif code == 404:
            raise SystemExit("upload rejected: endpoint disabled on the server (UPLOAD_TOKEN not set there)")
        else:
            raise SystemExit(f"upload failed: HTTP {code} {res.get('error', '')}")

    if not args.server:
        print("(no --server given — cookies saved locally only; copy them into the "
              "container's /data/logs or re-run with --server)")


if __name__ == "__main__":
    main()
