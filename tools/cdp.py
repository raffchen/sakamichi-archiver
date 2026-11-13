"""Shared Chrome DevTools Protocol helper for automating the emulator's Chrome."""
import json
import time
import urllib.request

import websocket

DEVTOOLS_HOSTS = ("127.0.0.1", "[::1]")  # desktop Chrome may bind either loopback


def _targets() -> list:
    last_err = None
    for host in DEVTOOLS_HOSTS:
        try:
            with urllib.request.urlopen(
                f"http://{host}:9222/json", timeout=5
            ) as r:
                return json.load(r)
        except Exception as e:  # try the other loopback
            last_err = e
    raise RuntimeError(f"no DevTools endpoint on :9222 ({last_err})")


def find_target(substr: str) -> dict:
    for t in _targets():
        if substr in t.get("url", ""):
            return t
    raise RuntimeError(f"no chrome target matching {substr!r}")


def connect(url_substr: str) -> "CDP":
    page = next(
        (t for t in _targets() if url_substr in t.get("url", "") and t["type"] == "page"),
        None,
    )
    if page is None:
        raise RuntimeError(f"no chrome target matching {url_substr!r}")
    return CDP(page)


class CDP:
    def __init__(self, target: dict):
        self.ws = websocket.create_connection(
            target["webSocketDebuggerUrl"], timeout=20, suppress_origin=True
        )
        self._id = 0
        self.pending = {}
        self.events = []
        self.handlers = {}

    def send(self, method: str, params: dict | None = None, wait: bool = True):
        self._id += 1
        self.ws.send(json.dumps({"id": self._id, "method": method, "params": params or {}}))
        if not wait:
            return None
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self._id:
                return msg
            self._dispatch(msg)

    def _dispatch(self, msg: dict):
        h = self.handlers.get(msg.get("method"))
        if h:
            try:
                h(msg.get("params", {}))
            except Exception:
                pass
        else:
            self.events.append(msg)

    def pump(self, seconds: float):
        """Collect events (calling handlers) for a while."""
        end = time.time() + seconds
        self.ws.settimeout(0.5)
        while time.time() < end:
            try:
                msg = json.loads(self.ws.recv())
            except websocket.WebSocketTimeoutException:
                continue
            except Exception:
                break
            self._dispatch(msg)
        self.ws.settimeout(20)

    def on(self, method: str, handler):
        self.handlers[method] = handler

    def eval(self, expr: str):
        r = self.send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        res = r.get("result", {}).get("result", {})
        if res.get("subtype") == "error":
            raise RuntimeError(res.get("description", "eval failed"))
        return res.get("value")

    def navigate(self, url: str):
        self.send("Page.navigate", {"url": url})

    def close(self):
        self.ws.close()
