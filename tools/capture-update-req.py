"""mitmdump addon: capture POST /v2/update_token REQUEST bodies + headers.

The api-capture.py addon only saves responses; the refresh_token lives in the
request body. Saves each update_token request (headers + body) to
logs/update-token-req/NNN_<site>.json
"""
import json
import time
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "logs" / "update-token-req"
OUT.mkdir(parents=True, exist_ok=True)
N = [0]
SITES = ("nogizaka46", "sakurazaka46")


def request(flow):
    host = flow.request.pretty_host
    if not any(f"api.message.{s}.com" in host for s in SITES):
        return
    if "/update_token" not in flow.request.path:
        return
    N[0] += 1
    site = next(s for s in SITES if s in host)
    data = {
        "captured_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "site": site,
        "headers": dict(flow.request.headers),
        "body": flow.request.get_text(strict=False),
    }
    fn = OUT / f"{N[0]:03d}_{site}.json"
    fn.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"[upd-req] saved {fn.name} (body {len(data['body'])} bytes)", flush=True)
