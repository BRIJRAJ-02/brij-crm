# Verify: Port phase 0, type scale and tokens · spec 0071 · updated 2026-11-12
_Steps derived from spec 0071 AC-1 to AC-15. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Build the web app and serve `dist` with `vercel.json`'s headers. Sign in, open Home → `<html data-scale="app">` already set when the document becomes interactive; `getComputedStyle(document.documentElement).getPropertyValue('--text-body')` is `400 12.5px/18px …`, `--size-control` is `32px`, `--space-16` is `14px` → AC-5
- [ ] Open a booking page (`/b/<key>`), a form (`/f/<key>`), a partner embed (`/embed/tfp_…`) and the email preferences page from the same build → no `data-scale`; `--text-body` is `400 14px/20px …`, `--space-16` is `16px` → AC-5
- [ ] Embed a form in a test page (the embed script) → still full size inside the frame → AC-5
- [ ] Open a form editor → its preview iframe draws at full size → AC-5
- [ ] Open a records table, scroll fast to the bottom and back → rows stay aligned with no drift; the row element's height equals `sizeToken('size-row')` (38) → AC-16
- [ ] Tab onto a primary blue button and a secondary button, light and dark → the two ring focus shadow is clearly visible on both → AC-12
- [ ] Side by side at 1440 wide, light and dark: Home, a records table and a record page against the Timefix artifact's same pages → text sizes, control heights and row heights match within 1px → AC-3
- [ ] Open a menu, a select and a dialog → they sit on their triggers exactly (no zoom patch exists) → AC-7
- [ ] Network panel → `Geist-Variable-latin-*.woff2` from `/assets/`, preloaded; no Inter or JetBrains file; 0 CSP violations → AC-9
- [ ] Press and hold a button, a checkbox and a radio → colour changes, size never does → AC-11
- [ ] Read the contrast move list in rationale.md next to the screenshot sheet → the owner approves it before landing → AC-12

## Commands
- [ ] `pnpm tokens:check` passes; change one byte of `packages/tokens/tokens.json` → `TOKENS_SOURCE_DRIFT`, exit 1 → AC-1
- [ ] `pnpm --filter @crm/tokens test` → the scale table test, numeric font weight, the legacy clash, the unclassed size, the drift case and the `values.ts` staleness check pass → AC-1, AC-3, AC-4, AC-13, AC-16
- [ ] Run `rename-0071.ts` on a branch that already has phase 0 names → it refuses and lists the files; on a copy of main before phase 0 → one pass, and `grep -rn "'title'"` shows role strings untouched → AC-8
- [ ] `grep -rnE "^const [A-Z_]+ = (size|space|radius|type|breakpoint)Token\(" packages apps` finds nothing (no module level token constants) → AC-16
- [ ] `grep -rn "blur" design/timefix-design-system/tokens.json packages/tokens/tokens.css` finds no `--blur-` token → AC-11
- [ ] Same run → the contrast suite passes in both themes, including the new pairs → AC-12
- [ ] `grep -rn "zoom" apps packages --include=*.css` finds nothing; Stylelint refuses `zoom: 0.9` in a fixture → AC-7
- [ ] `grep -rnE "var\(--(text|tracking)-(note-title|title-regular|label-strong)\)|var\(--duration-(hover|press|popover|move|modal|exit|public-[a-z]+)\)|var\(--ease-(hover|drawer)\)|var\(--scale-press" apps packages tools` finds nothing → AC-8, AC-10, AC-11
- [ ] `grep -rn "Inter\b\|JetBrains" apps packages --include=*.ts --include=*.tsx --include=*.css --include=*.mjs` finds nothing outside licences → AC-9
- [ ] `node design/timefix-design-system/scripts/standalone.mjs` builds, and its CSS reads `zoom: 0.88` from `density-app` → AC-2
- [ ] `pnpm test:visual` in the pinned image passes against the reshot baselines; a public form story's shot shows 14px body text → AC-14
- [ ] `pnpm check && pnpm test && pnpm size && pnpm build` → green → AC-15
- [ ] `pnpm --filter @crm/emails test` → green, and a rendered email's body text is 14px (full size, never the app's 12.5px) → AC-15
