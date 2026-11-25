#!/usr/bin/env bash
# Publish the built site in dist/ to Cloudflare, as the Worker named in wrangler.jsonc.
#
# It builds nothing and checks nothing about the pages: run every check and the build first.
# The deploy tool is pinned and locked in deploy/ and installed from that lock file.
#
# Needs, from the host's secret store (never from a file in this repository):
#   CLOUDFLARE_API_TOKEN    a token that may edit Workers on the account
#   CLOUDFLARE_ACCOUNT_ID   the account's id
# Optional:
#   DRY_RUN=true            pack the site and read the configuration, publish nothing
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

for needed in index.html 404.html _headers; do
  if [[ ! -s "$ROOT/dist/$needed" ]]; then
    echo "publish: dist/$needed is missing. Build the site first." >&2
    exit 2
  fi
done

if [[ "${DRY_RUN:-false}" != "true" ]]; then
  : "${CLOUDFLARE_API_TOKEN:?publish: CLOUDFLARE_API_TOKEN is not set}"
  : "${CLOUDFLARE_ACCOUNT_ID:?publish: CLOUDFLARE_ACCOUNT_ID is not set}"
fi

npm ci --prefix "$ROOT/deploy" --ignore-scripts --no-audit --no-fund

cd "$ROOT"
# Before publishing: list the pages that are new since the live site (scripts/indexnow.mjs). Never stops a publish.
node scripts/indexnow.mjs plan || echo "publish: the IndexNow plan failed; publishing anyway." >&2

if [[ "${DRY_RUN:-false}" == "true" ]]; then
  WRANGLER_SEND_METRICS=false deploy/node_modules/.bin/wrangler deploy --config wrangler.jsonc --dry-run
  node scripts/indexnow.mjs send --dry-run || true
else
  WRANGLER_SEND_METRICS=false deploy/node_modules/.bin/wrangler deploy --config wrangler.jsonc
  # After publishing: tell IndexNow (Bing and others) about the new pages. A failure is reported, not fatal.
  node scripts/indexnow.mjs send || echo "publish: the IndexNow ping failed; the site is published." >&2
fi
