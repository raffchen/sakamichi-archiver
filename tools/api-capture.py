"""Save all JSON API responses from the Message apps (nogizaka + sakurazaka)."""
import json
import os
import re
from pathlib import Path

OUT = Path(r"C:/Users/raffe/Desktop/projects/emulator/logs/api")
OUT.mkdir(parents=True, exist_ok=True)
N = [0]
SITES = ("nogizaka46", "sakurazaka46")


def response(flow):
    host = flow.request.pretty_host
    if not any(f"api.message.{s}.com" in host for s in SITES):
        return
    ct = flow.response.headers.get("content-type", "")
    if "javascript" in ct:
        return
    N[0] += 1
    site = next(s for s in SITES if s in flow.request.pretty_host)
    path = site + "_" + flow.request.path.split("?")[0].strip("/").replace("/", "_")
    qs = flow.request.query.fields
    suffix = ("__" + "_".join(f"{k}={v}" for k, v in qs)) if qs else ""
    suffix = re.sub(r"[^\w=-]", "_", suffix)[:80]
    body = flow.response.get_text(strict=False)
    try:
        data = json.loads(body)
        pretty = json.dumps(data, ensure_ascii=False, indent=1)
    except Exception:
        pretty = body
    fn = OUT / f"{N[0]:04d}_{path}{suffix}.json"
    fn.write_text(pretty, encoding="utf-8")
    print(f"[api] saved {fn.name} ({len(body)} bytes)")
