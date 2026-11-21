#!/bin/sh
# Deploy the game to the web server: the static site (index.html, style.css, src/, models/, music/) by rsync, and,
# when the server runs the multiplayer relay as a service, relay.mjs to its own directory outside the web root.
#
#   tools/deploy.sh [git ref]        (default: main; only committed files ever go out)
#
# Where it goes comes from the environment or from an untracked .deploy.env next to this repo's README:
#   DEPLOY_SSH="user@host"           required
#   DEPLOY_KEY="$HOME/.ssh/key.pem"  optional ssh identity
#   DEPLOY_DIR="/path/to/webroot/skywar/"   required: the directory the site is served from (trailing slash)
#   DEPLOY_RELAY_DIR="/path/outside/webroot/skywar-relay/"   optional: where relay.mjs lives on the server
#   DEPLOY_RELAY_RESTART="sudo systemctl restart skywar-relay"   optional: run on the server after relay.mjs changed
set -eu
cd "$(dirname "$0")/.."
[ -f .deploy.env ] && . ./.deploy.env
: "${DEPLOY_SSH:?set DEPLOY_SSH (user@host), e.g. in .deploy.env}"
: "${DEPLOY_DIR:?set DEPLOY_DIR (the served directory, with a trailing slash)}"
REF="${1:-main}"
SSH="ssh -o BatchMode=yes${DEPLOY_KEY:+ -i $DEPLOY_KEY}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git archive "$REF" | tar -x -C "$TMP"
echo "deploying $(git rev-parse --short "$REF") ($REF) to $DEPLOY_SSH:$DEPLOY_DIR"

# the site: only what the browser loads (no tests, tools, docs or server code; no Markdown)
rsync -az --delete --chmod=D755,F644 -e "$SSH" \
    --exclude='.DS_Store' --exclude='*.md' \
    --include='index.html' --include='style.css' --include='src/***' --include='models/***' --include='music/***' --exclude='*' \
    "$TMP/" "$DEPLOY_SSH:$DEPLOY_DIR"

# the multiplayer relay, if this server runs one
if [ -n "${DEPLOY_RELAY_DIR:-}" ] && [ -f "$TMP/relay.mjs" ]; then
    CHANGED="$(rsync -az --itemize-changes --chmod=F644 -e "$SSH" "$TMP/relay.mjs" "$DEPLOY_SSH:$DEPLOY_RELAY_DIR" | grep -c '^<' || true)"
    if [ "$CHANGED" != "0" ] && [ -n "${DEPLOY_RELAY_RESTART:-}" ]; then
        echo "relay.mjs changed: restarting the relay (connected players are dropped and reconnect)"
        $SSH "$DEPLOY_SSH" "$DEPLOY_RELAY_RESTART"
    fi
fi
echo "done"
