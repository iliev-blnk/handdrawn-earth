#!/usr/bin/env bash
# Deploys the API, builds the site against the URL it got, deploys the site to Pages, then checks both live.
# Run it in your own terminal: wrangler may want to open a browser or ask a question the first time.
# --force on create: wrangler 4.15x otherwise hands a new project to its Workers-assets flow, which wants a root config.
set -euo pipefail
cd "$(dirname "$0")/.."

out=$(mktemp)
pnpm exec wrangler deploy --config api/wrangler.jsonc | tee "$out"
api=$(grep -oE 'https://handdrawn-earth-api\.[a-z0-9-]+\.workers\.dev' "$out" | head -1 || true)
rm -f "$out"
[ -n "$api" ] || { echo "deploy: no workers.dev url in wrangler's output" >&2; exit 1; }

VITE_API=$api pnpm build
pnpm exec wrangler pages project list | grep -q 'handdrawn-earth\.pages\.dev' ||
  pnpm exec wrangler pages project create handdrawn-earth --production-branch main --force
pnpm exec wrangler pages project list | grep -q 'handdrawn-earth\.pages\.dev' || {
  echo "deploy: the Pages project got another subdomain; put it in ALLOW_ORIGINS (api/wrangler.jsonc) and E2E_BASE" >&2
  exit 1
}
pnpm exec wrangler pages deploy dist --project-name handdrawn-earth --branch main --commit-dirty=true

E2E_BASE=https://handdrawn-earth.pages.dev E2E_API=$api node e2e/live.mjs
