#!/usr/bin/env python
"""Catch POST /v2/update_token request bodies by explicitly fetching the
post data (Network.getRequestPostData — postData is often absent from the
requestWillBeSent event), then poke the app's Blog tab to trigger the
expired-token renewal path.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import cdp as cdp_mod

ROOT = Path(__file__).resolve().parent.parent
SITES = {"nogizaka": "nogizaka46", "sakura": "sakurazaka46"}
FX, FY = 0.386, 0.987  # Blog icon


class Cap:
    def __init__(self, label, c):
        self.label, self.c = label, c
        self.done = False

    def on_req(self, p):
        if self.done:
            return
        if "/update_token" not in p["request"].get("url", ""):
            return
        rid = p["requestId"]
        try:
            r = self.c.send("Network.getRequestPostData", {"requestId": rid})
            body = r.get("result", {}).get("postData", "")
        except Exception as e:
            body = ""
            print(f"[now] {self.label}: postdata fetch failed: {e}", flush=True)
        print(f"[now] {self.label}: update_token body len={len(body)}", flush=True)
        if len(body) > 30:
            (ROOT / "logs" / f"{self.label}-refresh-token.txt").write_text(body, encoding="utf-8")
            self.done = True
            print(f"[now] {self.label}: SAVED {len(body)} bytes", flush=True)


if __name__ == "__main__":
    conns, caps = {}, {}
    for label, sub in SITES.items():
        c = cdp_mod.connect(f"message.{sub}.com")
        cap = Cap(label, c)
        c.send("Page.enable")
        c.send("Network.enable")
        c.on("Network.requestWillBeSent", cap.on_req)
        conns[label], caps[label] = c, cap

    deadline = time.time() + 150
    poked = set()
    rnd = 0
    while time.time() < deadline and not all(x.done for x in caps.values()):
        rnd += 1
        for label, c in conns.items():
            if caps[label].done:
                continue
            if rnd % 3 == 1:  # poke every ~15 s
                try:
                    targets = [x for x in json.load(
                        urllib.request.urlopen("http://[::1]:9222/json", timeout=5))
                        if x["type"] == "page"]
                    page = next(x for x in targets if f"message.{SITES[label]}.com" in x["url"])
                    urllib.request.urlopen(
                        f"http://[::1]:9222/json/activate/{page['id']}", timeout=5)
                    w, h = c.eval("window.innerWidth"), c.eval("window.innerHeight")
                    for tp in ("mousePressed", "mouseReleased"):
                        c.send("Input.dispatchMouseEvent", {
                            "type": tp, "x": round(w * FX), "y": round(h * FY),
                            "button": "left", "clickCount": 1,
                        })
                    poked.add(label)
                    print(f"[now] {label}: poked Blog", flush=True)
                except Exception as e:
                    print(f"[now] {label}: poke failed: {e}", flush=True)
            try:
                c.pump(4)
            except Exception as e:
                print(f"[now] {label}: {e}", flush=True)
    print("[now] done:", {k: v.done for k, v in caps.items()}, flush=True)
