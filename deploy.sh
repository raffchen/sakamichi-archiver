#!/usr/bin/env bash
# Deploy to the OMV server: push code, rebuild images, restart the stack.
#
#   ./deploy.sh          # full deploy
#   ./deploy.sh --no-push  # rebuild/restart from what's already on the server
#
# Machine-specific targets (server, app dir, public URL) live in deploy.env —
# gitignored, this machine only; deploy.env.example is the tracked template.
#
# The server's appdata dir is a git remote (`omv`) with
# receive.denyCurrentBranch=updateInstead, so `git push` updates the working
# tree there directly — only changed files cross the wire.
set -euo pipefail

if [[ ! -f deploy.env ]]; then
    echo "ERROR: deploy.env not found — copy deploy.env.example and fill in this machine's targets" >&2
    exit 1
fi
# shellcheck source=deploy.env
source deploy.env
: "${SSH_TARGET:?set SSH_TARGET in deploy.env}"
: "${APP_DIR:?set APP_DIR in deploy.env}"
: "${HEALTH_URL:?set HEALTH_URL in deploy.env}"

if [[ "${1:-}" != "--no-push" ]]; then
    echo "==> pushing code"
    git push omv main
    git remote get-url github >/dev/null 2>&1 && git push github main   # keep the GitHub mirror in sync
fi

echo "==> building + restarting on server"
ssh "$SSH_TARGET" "cd '$APP_DIR' &&
    cp docker-compose.yml 'Sakamichi Archive.yml' &&  # keep OMV's copy in sync (OMV regenerates it from its DB)
    docker compose build &&
    docker compose up -d"

echo "==> waiting for viewer"
# health-check on the server itself via the docker bridge gateway — the
# viewer port is intentionally not reachable from outside (VIEWER_BIND_IP)
for _ in $(seq 1 24); do
    if ssh "$SSH_TARGET" "curl -fsS http://172.17.0.1:${VIEWER_PORT:-8484}/api/health" >/dev/null 2>&1; then
        echo "==> deployed: viewer healthy (public URL: $HEALTH_URL)"
        exit 0
    fi
    sleep 5
done
echo "ERROR: viewer not healthy after 2 min — check: ssh '$SSH_TARGET' docker compose -f '$APP_DIR/compose.yml' logs" >&2
exit 1
