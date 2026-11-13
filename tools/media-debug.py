"""Print response details for media/CDN flows to diagnose rendering failures."""
import mitmproxy.http


def response(flow: mitmproxy.http.HTTPFlow) -> None:
    host = flow.request.pretty_host
    url = flow.request.pretty_url
    r = flow.response
    if not r:
        return
    ct = r.headers.get("content-type", "?")
    if "/private/messages" in url or "thumbnail" in url.lower() or "image" in ct or "video" in ct:
        body = r.raw_content or b""
        magic = body[:12].hex()
        print(f"[media] {r.status_code} ct={ct} len={len(body)} magic={magic} url={url[:110]}")
        with open(r"C:/Users/raffe/Desktop/projects/emulator/logs/media-urls.txt", "a") as f:
            f.write(url + "\n")
