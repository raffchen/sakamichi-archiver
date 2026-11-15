#!/bin/sh
# Syncer loop (docs/deployment.md §3.3) — renew tokens is implicit: grab-media
# refreshes via the stored session cookie on each run and persists rotation.
#
# Env (set via docker-compose):
#   SYNC_INTERVAL  sleep between rounds ("6h", "30m", ...) — GNU sleep suffixes
#   SYNC_SITES     sites to sync, space-separated ("nogizaka46 sakurazaka46")
#   SYNC_FLAGS     extra grab-media flags, e.g. "--full-history" for the very
#                  first sync of a long archive (removed afterwards)
#   SYNC_BLOG      1 (default) = also grab blogs each round:
#                  grab-blog.py --all --site <site>, whose generation-map
#                  filter reduces that to current members (graduated members'
#                  blogs are erased upstream and unranked accounts like
#                  運営スタッフ/期生リレー are out of scope)
#   PUSH_URL       optional Uptime Kuma push monitor URL — one heartbeat per
#                  site round: status=up on success, status=down on failure;
#                  a dead container simply stops pushing (Kuma marks it down)
#
# A failing round (e.g. expired session cookie → HTTP 400 on update_token)
# never kills the container: it just logs loudly; recovery is the session
# upload flow (docs/deployment.md §3.7).
set -u
INTERVAL="${SYNC_INTERVAL:-6h}"
SITES="${SYNC_SITES:-nogizaka46}"
FLAGS="${SYNC_FLAGS:-}"
BLOG="${SYNC_BLOG:-1}"
PUSH_BASE="${PUSH_URL:-}"
PUSH_BASE="${PUSH_BASE%%\?*}"   # strip the sample query string from the URL

# $1=status(up|down) $2=msg $3=ping ms (optional). Heartbeat failures are
# logged, never fatal — monitoring must not break syncing.
kuma() {
  [ -n "$PUSH_BASE" ] || return 0
  python - "$PUSH_BASE" "$@" <<'PY'
import sys, urllib.parse, urllib.request
base, status, msg = sys.argv[1], sys.argv[2], sys.argv[3]
q = {"status": status, "msg": msg}
if len(sys.argv) > 4 and sys.argv[4]:
    q["ping"] = sys.argv[4]
try:
    urllib.request.urlopen(f"{base}?{urllib.parse.urlencode(q)}", timeout=10)
except Exception as e:
    print(f"[syncer] kuma push failed: {e}")
PY
}

echo "[syncer] sites='$SITES' interval=$INTERVAL flags='$FLAGS' push='${PUSH_BASE:+on}'"
while :; do
  for site in $SITES; do
    echo "[syncer] === $site $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
    t0=$(date +%s)
    if # shellcheck disable=SC2086  # FLAGS is intentionally word-split
      python grab-media.py --site "$site" --subscribed $FLAGS
    then
      kuma up "$site OK" $(( ($(date +%s) - t0) * 1000 ))
    else
      rc=$?
      echo "[syncer] $site: sync FAILED rc=$rc (see log above)"
      kuma down "$site sync failed (exit $rc)"
    fi
    # blogs ride along after the media round.grab-media refreshes the API
    # token as a side effect, so the blog grab inherits a fresh one; failures
    # are loud but do not flip the heartbeat (media is the paging signal)
    if [ "$BLOG" = "1" ]; then
      if python grab-blog.py --all --site "$site"; then
        echo "[syncer] $site: blogs OK"
      else
        echo "[syncer] $site: blog sync FAILED (non-fatal) — media heartbeat unaffected"
      fi
    fi
  done
  echo "[syncer] sleeping $INTERVAL"
  sleep "$INTERVAL"
done
