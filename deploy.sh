#!/usr/bin/env bash
# Deploy to the OMV server: push code, rebuild images, restart the stack.
#
#   ./deploy.sh          # full deploy
#   ./deploy.sh --no-push  # rebuild/restart from what's already on the server
#
# The server's appdata dir is a git remote (`omv`) with
# receive.denyCurrentBranch=updateInstead, so `git push` updates the working
# tree there directly — only changed files cross the wire.
set -euo pipefail

SSH_TARGET="SERVER-REDACTED"
APP_DIR="/srv/DISK-UUID-REDACTED/appdata/Sakamichi Archive"
HEALTH_URL="http://SERVER-REDACTED:8484"

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
for _ in $(seq 1 24); do
    if curl -fsS "$HEALTH_URL/api/health" >/dev/null 2>&1; then
        echo "==> deployed: viewer healthy at $HEALTH_URL"
        exit 0
    fi
    sleep 5
done
echo "ERROR: viewer not healthy after 2 min — check: ssh '$SSH_TARGET' docker compose -f '$APP_DIR/compose.yml' logs" >&2
exit 1
