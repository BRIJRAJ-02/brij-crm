#!/bin/sh
# Build everything into dist/: the bundle, one preview per component (for the design system artifact) and a local harness.
set -e
cd "$(dirname "$0")"
node scripts/collisions.mjs
node scripts/registry.mjs
node build.mjs dist
node scripts/previews.mjs dist/artifact
node scripts/harness.mjs tokens.json dist
node scripts/standalone.mjs bookings "Timefix Bookings" dist/timefix-bookings.html
echo "Open dist/index.html through any static server, e.g. python3 -m http.server -d dist"
