#!/bin/sh
# Build the three standalone pages and the harness copies the walks load (app.html, bp.html, biz.html).
set -e
cd /private/tmp/claude-501/-Users-brijraj-Desktop-brijraj-crm/6d00fdda-415e-4de5-9bf6-b1c0f80cd086/scratchpad/proto/tfds && node scripts/collisions.mjs | tail -1
wrap() { { printf '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>'; cat "$1"; printf '</body></html>'; } > "$2"; }
node scripts/standalone.mjs timefix "Timefix" ../pages/timefix.html | tail -1 && wrap ../pages/timefix.html ../harness/app.html
node scripts/standalone.mjs bookings "Timefix Bookings" ../pages/timefix-bookings.html | tail -1 && wrap ../pages/timefix-bookings.html ../harness/bp.html
node scripts/standalone.mjs business "Timefix Business" ../pages/timefix-business.html | tail -1 && wrap ../pages/timefix-business.html ../harness/biz.html
