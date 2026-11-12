#!/bin/sh
# Every walk, light and dark.
cd "$(dirname "$0")"
for w in smoke w11req w11more w12; do for th in light dark; do out=$(node $w.mjs $th 2>&1); echo "$w $th ok=$(echo "$out" | grep -c '^ok') $(echo "$out" | grep -E 'FAIL|errors \[.+\]|Error' | head -4 | tr '\n' ' ')"; done; done
