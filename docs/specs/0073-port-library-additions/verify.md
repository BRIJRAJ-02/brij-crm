# Verify: Port phase 2, library additions · spec 0073 · updated 2026-11-12
_Steps derived from spec 0073 AC-7301 to AC-7324. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Storybook, `SearchField`: type, press Esc → empty, focus stays; type again, press the clear button → empty, focus in the field; press ⌘K (Ctrl+K) from the page body → focused and selected; the keycap hides while focused or holding text → AC-7304
- [ ] `NumberField` in `currency` USD: type `1,234.5`, Tab away → `1,234.50` with `$` in front; ↑ → `1,235.50`; End → the maximum; type `abc`, Tab → the last good value comes back; the minus button turns off at the minimum → AC-7305
- [ ] `TimeSelect` on a 12 hour clock, `from` 9:00 → the list starts at 9:15 AM, 15 minutes apart; Enter picks, the value is `HH:MM` → AC-7306
- [ ] A drawer Modal with `isDirty`: type in it, press Esc → "Discard your unsaved changes?"; Keep editing → focus back in the form; × then Discard changes → it closes; with nothing typed, Esc closes at once → AC-7307
- [ ] `PresenceGroup` with 1,000 people → four avatars and "+996"; Tab reaches each avatar, its Tooltip names the person and activity; a screen reader names four people and "996 others" → AC-7308, AC-7324
- [ ] RemoteCursor `pointer`: move it every 120 ms → it glides; set `isIdle` → the pill folds away and the arrow dims; reduced motion → it jumps without gliding → AC-7309
- [ ] TextSwap `soft` with a figure aligned to the end: change it → both cross fade in place, the right edge stays → AC-7310
- [ ] A list with Reveal `drop` rows: add a row → it opens from no height and rises; rows there on load do not move; no blur at any frame → AC-7311
- [ ] Each of the above in light and dark, keyboard only → focus visible, contrast holds → AC-7312
- [ ] Storybook, `ShareSheet` `Default`: focus opens on Done; the QR code, Copy link (primary), Email, WhatsApp, Download; Esc closes. `Everything`: the invite before the link in Email and WhatsApp, Put it on your site closes the sheet, the footer beside Done. `Refused*`: one line, Done, nothing else → batch 2, AC-7318
- [ ] `AIAssist` inside a Panel: ask with Enter, Shift+Enter breaks the line; the status line swaps every two seconds; the answer arrives, Copy, Save as note, New question; Stop mid answer keeps the words with "Stopped."; a screen reader hears "Working on an answer" then "Answer ready"; reduced motion stills the sweep → batch 3
- [ ] Tag `tone="ai"` in light and dark: the sparkle alone is violet, "(filled by AI)" for screen readers → batch 3

## Commands
- [ ] `pnpm --filter @crm/ui test:unit` → `parseNumber`, `timeOptions`, `formatTime` and the export list pass → AC-7305, AC-7306, AC-7312
- [ ] `pnpm --filter @crm/ui exec vitest run --project "stories (chromium)" <the changed story files>` → every play assertion passes, axe clean in both themes → AC-7304 to AC-7312
- [ ] `pnpm --filter @crm/config test` → the HTML injection cases are refused in the client and screens presets → AC-7317
- [ ] `grep -rn "dangerouslySetInnerHTML\|innerHTML =" apps packages --include=*.tsx --include=*.ts` → only test files, each with a disable naming why → AC-7317
- [ ] `pnpm size` → every line within budget, and the first load lines no larger than on the base (296.64 kB JavaScript, 7.86 kB CSS) → AC-7313
- [ ] The per chunk gzip comparison (base against batch) → no chunk grew by more than 1 kB without a reason in the commit → AC-7315
- [ ] `pnpm --filter @crm/web test build.test.ts` after batches 2 and 3 → ShareSheet and AIAssist are not reachable from `index.html`, `book.html` or `form.html` → AC-7314
- [ ] Batch 2: `safeHref` refuses `javascript:`, `data:` and `vbscript:` in ShareSheet's URL, copy and QR paths → AC-7318 (`share-url.test.ts`, and the `Refused*` stories)
- [ ] Batch 3: `pnpm --filter @crm/ui exec vitest run --project unit src/ai.test.ts src/modules/AIAssist` → the main and public entries never reach `@crm/ui/ai`; the stream's blocks never change once closed → AC-7314, gate 3
- [ ] Batch 3: the `AIAssist` stories `TextOnly` (markup drawn as characters) and `LongStream` (2,000 pieces end as at most about a hundred text nodes and no elements) → AC-7317, gate 3
- [ ] `pnpm test:visual --update` in the pinned image for ShareSheet, AIAssist and Tag `Ai` (and batch 1's parts), the baseline folder diffed → AC-7312
- [ ] Phase 6: a BookingList story with 10,000 meetings → at most 50 rows in the DOM → AC-7323
- [ ] `pnpm check` → green
