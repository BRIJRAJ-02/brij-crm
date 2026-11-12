#!/bin/sh
# Build just the named components into the local harness for screenshots: ./review.sh Name1,Name2
set -e
cd "$(dirname "$0")"
node build.mjs dist "$1"
node scripts/harness.mjs tokens.json dist
