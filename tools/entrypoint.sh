#!/bin/sh
# Syncer loop (docs/deployment.md §3.3) — renew tokens is implicit: grab-media
# refreshes via the stored session cookie on each run and persists rotation.
#
# Env (set via docker-compose):
#   SYNC_INTERVAL  cadence of full rounds ("6h", "24h", ...) — GNU sleep suffixes
#   SYNC_PROBE_INTERVAL  cadence of probe rounds between full rounds (e.g.
#                  "3m"); unset = probe disabled (behaviour as before). A
#                  probe fetches only the newest message per member (count=1)
#                  and runs the full sync just for members whose newest
#                  message is new or edited — near-instant pickup at ~1 KB
#                  per member instead of a full timeline refetch
#   SYNC_SITES     sites to sync, space-separated ("nogizaka46 sakurazaka46")
#   SYNC_FLAGS     extra grab-media flags for FULL rounds only, e.g.
#                  "--full-history" for the very first sync of a long
#                  archive (removed afterwards)
#   SYNC_BLOG      1 (default) = also grab blogs on their own schedule:
#                  grab-blog.py --all --site <site>, whose generation-map
#                  filter reduces that to current members (graduated members'
#                  blogs are erased upstream and unranked accounts like
#                  運営スタッフ/期生リレー are out of scope)
#   SYNC_BLOG_INTERVAL  how often the blog phase runs (default "1h"; blogs
#                  are far less frequent than messages) — independent of
#                  SYNC_INTERVAL; the phase piggybacks on whichever round is
#                  next due and runs for all sites in that pass
#   PUSH_URL       optional Uptime Kuma push monitor URL — one heartbeat per
#                  site round: status=up on success, status=down on failure;
#                  a dead container simply stops pushing (Kuma marks it down)
#
# A failing round (e.g. expired session cookie → HTTP 400 on update_token)
# never kills the container: it just logs loudly; recovery is the session
# upload flow (docs/deployment.md §3.7).
set -u
INTERVAL="${SYNC_INTERVAL:-6h}"
PROBE_INTERVAL="${SYNC_PROBE_INTERVAL:-}"
SITES="${SYNC_SITES:-nogizaka46}"
FLAGS="${SYNC_FLAGS:-}"
BLOG="${SYNC_BLOG:-1}"
BLOG_INTERVAL="${SYNC_BLOG_INTERVAL:-1h}"
# <n>s|m|h|d → seconds; anything unparseable falls back to 1h rather than
# breaking the loop (GNU date -d accepts no bare "+1h", hence this)
to_secs() {
  case "$1" in *[!0-9smhd]*|"") echo 3600; return ;; esac
  n=${1%%[smhd]*}
  case "$n" in ""|*[!0-9]*) echo 3600; return ;; esac
  case "${1#"$n"}" in
    s) echo "$n" ;; m) echo $((n * 60)) ;; h) echo $((n * 3600)) ;; d) echo $((n * 86400)) ;;
    *) echo 3600 ;;
  esac
}
BLOG_SECS=$(to_secs "$BLOG_INTERVAL")
FULL_SECS=$(to_secs "$INTERVAL")
PROBE_SECS=0
[ -n "$PROBE_INTERVAL" ] && PROBE_SECS=$(to_secs "$PROBE_INTERVAL")
last_blog=0   # epoch of the last blog pass; 0 = due immediately on start
last_full=0   # epoch of the last full round; 0 = due immediately on start
last_probe=0  # epoch of the last probe round (only meaningful when PROBE_SECS > 0)
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

echo "[syncer] sites='$SITES' full=$INTERVAL probe='$PROBE_INTERVAL' flags='$FLAGS' push='${PUSH_BASE:+on}'"
while :; do
  now=$(date +%s)
  if [ $(( now - last_full )) -ge "$FULL_SECS" ]; then
    # --- full round: roster refresh, profile/single artwork, edit +
    # deletion healing, partial-archive repair. SYNC_FLAGS applies here only.
    do_blog=0
    if [ "$BLOG" = "1" ] && [ $(( now - last_blog )) -ge "$BLOG_SECS" ]; then
      do_blog=1
    fi
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
      # blogs ride along only when their interval is due. grab-media refreshes
      # the API token as a side effect, so the blog grab inherits a fresh one;
      # failures are loud but do not flip the heartbeat (media is the paging
      # signal)
      if [ "$do_blog" = "1" ]; then
        if python grab-blog.py --all --site "$site"; then
          echo "[syncer] $site: blogs OK"
        else
          echo "[syncer] $site: blog sync FAILED (non-fatal) — media heartbeat unaffected"
        fi
      fi
    done
    if [ "$do_blog" = "1" ]; then
      last_blog=$(date +%s)
    fi
    last_full=$now
  elif [ "$PROBE_SECS" -gt 0 ] && [ $(( now - last_probe )) -ge "$PROBE_SECS" ]; then
    # --- probe round: count=1 timeline per member, full sync only for hot
    # members (new/edited newest message). Probes carry the heartbeat so a
    # dead container pages within PROBE_INTERVAL, not FULL_INTERVAL.
    for site in $SITES; do
      echo "[syncer] --- probe $site $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
      t0=$(date +%s)
      if python grab-media.py --site "$site" --subscribed --probe; then
        kuma up "$site probe OK" $(( ($(date +%s) - t0) * 1000 ))
      else
        rc=$?
        echo "[syncer] $site: probe FAILED rc=$rc (see log above)"
        kuma down "$site probe failed (exit $rc)"
      fi
    done
    last_probe=$now
  fi
  # sleep until the next due event (probe or full, whichever comes first)
  now=$(date +%s)
  wait=$FULL_SECS
  if [ "$PROBE_SECS" -gt 0 ]; then
    p_wait=$(( PROBE_SECS - ( now - last_probe ) ))
    [ "$p_wait" -lt "$wait" ] && wait=$p_wait
  fi
  [ "$wait" -lt 1 ] && wait=1
  echo "[syncer] sleeping ${wait}s"
  sleep "$wait"
done
