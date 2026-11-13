"""mitmdump addon: log every Set-Cookie for api.message.*.com responses
(and response codes for update_token calls) so the session cookie can be
harvested straight from the wire.
"""
import time
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "logs" / "session-cookies.txt"
SITES = ("nogizaka46", "sakurazaka46")


def response(flow):
    host = flow.request.pretty_host
    if not any(f"api.message.{s}.com" in host for s in SITES):
        return
    sc = flow.response.headers.get_all("set-cookie") if flow.response.headers else []
    line = (f"{time.strftime('%H:%M:%S')} {flow.request.method} {flow.request.path.split('?')[0]} "
            f"-> {flow.response.status_code}")
    if sc:
        line += "  Set-Cookie: " + " || ".join(sc)
    with OUT.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(f"[sess] {line[:160]}", flush=True)
