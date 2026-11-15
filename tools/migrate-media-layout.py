#!/usr/bin/env python3
"""Reorganize the media tree into the group-first layout:

    media/<site>/messages/<member>/...   (was media/<member>/...)
    media/<site>/blogs/<member>/...      (was media/blogs/<member>/...)

Each message member dir carries its site in _member.json (written by
grab-media.py); each blog member dir carries it in blog/_blogs.json
(written by grab-blog.py). Dirs without a readable site attribution are
left in place and reported.

Dry-run by default — pass --apply to actually move. Moves are plain
renames (same filesystem), so nothing is copied or re-downloaded. The
viewer's index builder and server understand both layouts, so this can run
before or after a code deploy; the index simply rebuilds off the new tree
afterwards (the viewer's fs-watch picks the moves up on its own).
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MEDIA = Path(__import__("os").environ.get("MEDIA_DIR") or ROOT / "media")

# top-level names that are part of the layout itself, not member dirs
RESERVED = {"blogs"}
SITES = {"nogizaka46", "sakurazaka46"}


def read_json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def plan_moves(overrides: dict[str, str]):
    moves = []  # (src, dest, site, kind)
    unknown = []
    if not MEDIA.exists():
        sys.exit(f"no media dir at {MEDIA}")
    for d in sorted(MEDIA.iterdir()):
        if not d.is_dir() or d.name.startswith("."):
            continue
        if d.name in SITES:
            continue  # already migrated
        if d.name in RESERVED:
            # legacy flat blogs tree: one move per member
            for m in sorted(d.iterdir()):
                if not m.is_dir() or m.name.startswith("."):
                    continue
                state = read_json(m / "blog" / "_blogs.json") or {}
                site = overrides.get(m.name) or state.get("site")
                if site in SITES:
                    moves.append((m, MEDIA / site / "blogs" / m.name, site, "blog"))
                else:
                    unknown.append((m, f"_blogs.json site={site!r}"))
            continue
        # legacy flat message member dir
        meta = read_json(d / "_member.json") or {}
        site = overrides.get(d.name) or meta.get("site")
        if site in SITES:
            moves.append((d, MEDIA / site / "messages" / d.name, site, "messages"))
        else:
            unknown.append((d, f"_member.json site={site!r}"))
    return moves, unknown


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="actually move (default: dry run)")
    ap.add_argument(
        "--site",
        action="append",
        default=[],
        metavar="MEMBER=SITE",
        help="site override for members whose metadata predates the site field "
        "(e.g. --site 池田_瑛紗=nogizaka46); repeatable",
    )
    args = ap.parse_args()
    overrides = dict(a.split("=", 1) for a in args.site)

    moves, unknown = plan_moves(overrides)
    for src, dest, site, kind in moves:
        print(f"{kind:9} {src.relative_to(MEDIA)} -> {dest.relative_to(MEDIA)}  [{site}]")
    if unknown:
        print("\nleft in place (no reliable site attribution — pass --site MEMBER=SITE):")
        for p, why in unknown:
            print(f"  {p.relative_to(MEDIA)}  ({why})")
    if not moves:
        print("nothing to move — already migrated")
        return

    clashes = [(s, t) for s, t, *_ in moves if t.exists()]
    if clashes:
        sys.exit("\ndestination exists for:\n" + "\n".join(f"  {s} -> {t}" for s, t in clashes))
    if not args.apply:
        print(f"\ndry run: {len(moves)} move(s) — pass --apply to execute")
        return

    done = 0
    for src, dest, _, _ in moves:
        dest.parent.mkdir(parents=True, exist_ok=True)
        src.rename(dest)
        done += 1
        if done % 25 == 0:
            print(f"  …{done}/{len(moves)}")
    print(f"moved {done} member dir(s)")
    # prune now-empty legacy parents
    for p in (MEDIA / "blogs",):
        try:
            p.rmdir()  # only succeeds when empty
            print(f"removed empty {p.relative_to(MEDIA)}")
        except OSError:
            pass


if __name__ == "__main__":
    main()
