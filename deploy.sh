#!/usr/bin/env bash
# Stamps the current short commit hash into version.js (gitignored,
# regenerated fresh every deploy) so the deployed page can show which
# version is live, then deploys to Cloudflare Pages.
set -euo pipefail
cd "$(dirname "$0")"

echo "window.__SPINFETTI_COMMIT__ = \"$(git rev-parse --short HEAD)\";" > version.js
npx wrangler pages deploy .
