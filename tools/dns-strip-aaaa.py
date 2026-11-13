"""Minimal DNS proxy that strips AAAA (IPv6) answers.

Why: the host has no working IPv6 route, but upstream DNS still returns AAAA
records. The Android guest then prefers those IPv6 addresses, and connections
fail (mitmproxy returns 502 for them). Point the emulator at this proxy with
`-dns-server 127.0.0.1` and the guest only ever gets IPv4 addresses.

Usage: python dns-strip-aaaa.py [upstream_ip]
       default upstream: 75.75.75.75 (Comcast), fallback 8.8.8.8
Listens on UDP 127.0.0.1:53.
"""
import socket
import struct
import sys
import threading

UPSTREAMS = [(sys.argv[1] if len(sys.argv) > 1 else "75.75.75.75", 53), ("8.8.8.8", 53)]
LISTEN = ("127.0.0.1", 53)


def is_aaaa_query(data: bytes) -> bool:
    if len(data) < 12:
        return False
    flags, qdcount = struct.unpack("!HH", data[2:6])
    if not (flags & 0x8000) and qdcount >= 1:  # query (not response)
        # walk the first question's name
        i = 12
        while i < len(data) and data[i] != 0:
            i += data[i] + 1
        i += 1  # null byte
        if i + 4 <= len(data):
            qtype, _ = struct.unpack("!HH", data[i:i + 4])
            return qtype == 28  # AAAA
    return False


def empty_aaaa_response(query: bytes) -> bytes:
    """NOERROR reply with zero answers, echoing the question section."""
    flags = struct.unpack("!H", query[2:4])[0]
    rcode = flags & 0x000F
    resp_flags = 0x8000 | (flags & 0x0100) | rcode  # QR + RD + rcode
    header = query[:2] + struct.pack("!HHHH", resp_flags, 1, 0, 0)
    i = 12
    while i < len(query) and query[i] != 0:
        i += query[i] + 1
    question = query[12:i + 5]  # name + null + qtype + qclass
    return header + question


def forward_upstream(query: bytes) -> bytes | None:
    for ip, port in UPSTREAMS:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.settimeout(3)
                s.sendto(query, (ip, port))
                while True:
                    resp, _ = s.recvfrom(4096)
                    # match transaction id
                    if resp[:2] == query[:2]:
                        return resp
        except OSError:
            continue
    return None


def handle(sock: socket.socket, data: bytes, addr) -> None:
    if is_aaaa_query(data):
        sock.sendto(empty_aaaa_response(data), addr)
        return
    resp = forward_upstream(data)
    if resp:
        sock.sendto(resp, addr)


def main() -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(LISTEN)
    print(f"[dns-strip] listening on udp://{LISTEN[0]}:{LISTEN[1]} upstream={UPSTREAMS}")
    while True:
        data, addr = sock.recvfrom(4096)
        threading.Thread(target=handle, args=(sock, data, addr), daemon=True).start()


if __name__ == "__main__":
    main()
