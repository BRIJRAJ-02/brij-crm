# Verify: Port phase 1, library parity · spec 0072 · updated 2026-11-12
_Steps derived from spec 0072 AC-1 to AC-17. `/check verify` runs these per tier; `/test` locks the durable ones._

## UI / manual (per tier)
- [ ] Storybook beside the design system artifact (or the prototype harness, `dist/index.html?only=<Name>&w=650`), light and dark: each part of the tier at rest, hover, focus, pressed, selected, disabled and its README's other states → same geometry, colours, type and motion within the 0071 rounding → AC-1
- [ ] Tab through each interactive part → the outline ring shows 2px outside; press and hold → colour changes, size never does; turn on reduced motion → fades only → AC-6
- [ ] Open one screen per batch in the real app (Home, a records table, a record page, Bookings, a form editor) → nothing a person could do before is missing; menus, tooltips and popovers still sit on their triggers → AC-3
- [ ] Hover a RecordChipList and an AvatarStack with React DevTools' "highlight updates" on → nothing re-renders → AC-15

## Commands (per tier)
- [ ] `node packages/ui/scripts/part-cost.ts --tier <n> --against f81623f0c` → the tier's CSS plus JS total is at least 30% under the base → AC-8
- [ ] `pnpm size` on the tier's tip → no line above the base table in rationale.md; total `dist/assets` CSS and JS not above the base → AC-9
- [ ] `apps/web/.size-limit.js` → every budget this phase moved equals its new measurement rounded up to 0.1 kB, with a 0072 comment → AC-10
- [ ] `grep -rnE "dangerouslySetInnerHTML|innerHTML|outerHTML" packages/ui/src --include=*.tsx --include=*.ts | grep -v test` → nothing → AC-11
- [ ] `grep -rn "_blank" packages/ui/src --include=*.tsx` → every hit sits beside `noopener noreferrer`; the tier's link stories with `javascript:` hrefs pass → AC-12
- [ ] `grep -rnE "(sk|pk)_(live|test)_[A-Za-z0-9]{8,}|tfx_live_[A-Za-z0-9]{8,}" packages/ui/src` → nothing → AC-13
- [ ] `pnpm --filter @crm/ui exec vitest run --project perf` → green → AC-14
- [ ] `grep -rnE "key=\{(i|index|idx)\}" packages/ui/src/<tier folders>` → only static lists with a comment → AC-16
- [ ] `pnpm --filter @crm/ui exec vitest run --project unit src/index.test.ts` → green with no export removed → AC-3
- [ ] `pnpm --filter @crm/ui exec vitest run --project "stories (chromium)" <the tier's story files>` locally, then all three engines in CI → green → AC-2
- [ ] `git diff f81623f0c -- packages/tokens/legacy.json` and `grep` for each "Phase 1" legacy token in the tier's folders → none used there → AC-6
- [ ] `git log -- packages/ui/__screenshots__` on the lane → no commit; on the landing car → one commit per tier from CI's artifact, and `git status packages/ui/__screenshots__` explained → AC-17
- [ ] `design-system-guardian` on the tier → nothing open → AC-7
- [ ] `pnpm check` → green → AC-1, AC-6
