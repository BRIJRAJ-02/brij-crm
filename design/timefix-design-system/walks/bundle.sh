#!/bin/sh
# The design system artifact's bundle and component READMEs, into ds/project/components.
set -e
cd /private/tmp/claude-501/-Users-brijraj-Desktop-brijraj-crm/6d00fdda-415e-4de5-9bf6-b1c0f80cd086/scratchpad/proto/tfds && node build.mjs ../ds/project/components && node scripts/previews.mjs ../ds/project
