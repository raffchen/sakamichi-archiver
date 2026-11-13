#!/bin/sh
# Syncer loop (docs/deployment.md §3.3) — renew tokens is implicit: grab-media
# refreshes via the stored session cookie on each run and persists rotation.
#
# Env (set via docker-compose):
#   SYNC_INTERVAL  sleep between rounds ("6h", "30m", ...) — GNU sleep suffixes
#   SYNC_SITES     sites to sync, space-separated ("nogizaka46 sakurazaka46")
#   SYNC_FLAGS     extra grab-media flags, e.g. "--full-history" for the very
#                  first sync of a long archive (removed afterwards)
#
# A failing round (e.g. expired session cookie → HTTP 400 on update_token)
# never kills the container: it just logs loudly; recovery is the session
# upload flow (docs/deployment.md §3.7).
set -u
INTERVAL="${SYNC_INTERVAL:-6h}"
SITES="${SYNC_SITES:-nogizaka46}"
FLAGS="${SYNC_FLAGS:-}"

echo "[syncer] sites='$SITES' interval=$INTERVAL flags='$FLAGS'"
while :; do
  for site in $SITES; do
    echo "[syncer] === $site $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
    # shellcheck disable=SC2086  # FLAGS is intentionally word-split
    python grab-media.py --site "$site" --subscribed $FLAGS \
      || echo "[syncer] $site: sync FAILED (see log above)"
  done
  echo "[syncer] sleeping $INTERVAL"
  sleep "$INTERVAL"
done
