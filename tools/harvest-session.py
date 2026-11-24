#!/usr/bin/env python
"""Harvest the Message session cookies from a logged-in desktop Chrome
(--remote-debugging-port=9222, dedicated profile — see README).

Reads ALL browser cookies via the browser-level Storage.getCookies (the
session cookie is httpOnly + lives on .message.<site>.com, invisible to
per-page queries), and saves them where keep-alive.py / grab-media.py expect:

  logs/nogizaka-session-cookie.txt
  logs/sakura-session-cookie.txt

Run after any manual login:  python tools/harvest-session.py
"""
import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

import websocket

# default :9222 (dedicated-profile desktop Chrome); the local API recorder
# (tools/record-api.py, local-only) uses :9339 — pass --port to match it
SITES = {
    ".message.nogizaka46.com": ("nogizaka", "logs/nogizaka-session-cookie.txt"),
    ".message.sakurazaka46.com": ("sakura", "logs/sakura-session-cookie.txt"),
}
ROOT = Path(__file__).resolve().parent.parent


def browser_ws_url(port: int) -> str:
    last_err = None
    for host in (f"http://127.0.0.1:{port}", f"http://[::1]:{port}"):
        try:
            ver = json.load(urllib.request.urlopen(host + "/json/version", timeout=5))
            return ver["webSocketDebuggerUrl"]
        except Exception as e:
            last_err = e
    raise SystemExit(f"no DevTools endpoint on :{port} ({last_err}) — start the "
                     "browser with --remote-debugging-port=<port> first")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=9222,
                    help="browser DevTools port (9339 = tools/record-api.py)")
    args = ap.parse_args()
    ws = websocket.create_connection(browser_ws_url(args.port), timeout=15, suppress_origin=True)
    ws.send(json.dumps({"id": 1, "method": "Storage.getCookies", "params": {}}))
    res = None
    deadline = time.time() + 20
    while time.time() < deadline:
        msg = json.loads(ws.recv())
        if msg.get("id") == 1:
            res = msg.get("result", {})
            break
    ws.close()

    cookies = [x for x in res.get("cookies", []) if x["name"] == "session"]
    if not cookies:
        raise SystemExit("no session cookies found — log in to both sites first")
    saved = []
    for x in cookies:
        hit = SITES.get(x.get("domain", ""))
        if hit:
            label, rel = hit
            dest = ROOT / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(x["value"])
            saved.append(label)
            print(f"{label}: session cookie saved to {rel} ({x['value'][:10]}...)")
    missing = sorted(set(l for l, _ in SITES.values()) - set(saved))
    if missing:
        print(f"still missing: {missing} — log those sites in and re-run")
