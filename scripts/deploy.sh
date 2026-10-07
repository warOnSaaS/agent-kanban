#!/bin/bash
# Deploy this template to one instance's Vercel project: scripts/deploy.sh <instance>
# instances/<instance>.env holds VERCEL_ORG_ID and VERCEL_PROJECT_ID. The instance's settings and
# secrets live in that Vercel project's environment, not here.
set -e
NAME="$1"
[ -n "$NAME" ] && [ -f "instances/$NAME.env" ] || { echo "usage: scripts/deploy.sh <instance>  (needs instances/<instance>.env)"; exit 1; }
npm test >/dev/null && npm run -s check:clean
set -a; . "instances/$NAME.env"; set +a
# VERCEL_CONFIG in the instance env picks another config, e.g. vercel.demo.json for the demo board.
vercel deploy --prod --yes ${VERCEL_CONFIG:+--local-config "$VERCEL_CONFIG"}
