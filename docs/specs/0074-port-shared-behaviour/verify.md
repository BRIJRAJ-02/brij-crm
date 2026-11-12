# Verify: Port phase 3, shared behaviour · spec 0074 · updated 2026-11-12
_Steps derived from spec 0074 AC-7401 to AC-7426. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

Batch 1
- [ ] Publish a form for the first time → "<form> is live": Done focused, Copy link the one primary, Email, WhatsApp, More, Download (PNG, SVG), Put it on your site goes to the Share tab and closes; the footer "Answers go to People · Change" on one line → AC-7401
- [ ] Forms › Share tab → the same link row, no dialog; Download saves `<form>-qr.png` → AC-7402
- [ ] Link page, Live → Share: the code in the saved style (colour, centre picture, frame label), "Your link page in <workspace>.", Copy link, Download (the saved file keeps the style), Open page, Share links, Style the code, Add to Wallet; Share links and Style the code close Share first → AC-7403, AC-7404
- [ ] Link page: turn it Private from another tab while Share is open → "Private. Only you can open it. · Turn on Live" at the foot; the other ways but Open page hide → AC-7404
- [ ] Menus: Publish & go live → "Your menu is live" ShareSheet with Open guest menu; the split's ⌄ → Share → "Share your menu" → AC-7405
- [ ] Each of the above in light and dark, keyboard only → focus visible, Esc closes, focus returns to the opener → AC-7401

Later batches
- [ ] A booking page card and editor: Share opens ShareSheet with Offer specific times, One time link, Add to link page; Copy link still copies in one press → AC-7406
- [ ] Forms, menus, business page: PublishBar at the head; a first publish opens "<name> is live"; Discard draft and Unpublish ask in a Modal → AC-7407, AC-7408
- [ ] Hosted form in Dark with square corners: open a Select and the phone country picker → dark, square → AC-7409
- [ ] Link page in a template with a pinned font: open the gated link notice and a Tooltip → the page's font and theme → AC-7409
- [ ] Menu page: open an item's sheet → its header is the height of the page's own bar (46px, `size-bar`), not the app's `size-topbar` → AC-7426
- [ ] Records: open a row's panel → it sits under the top bar, full height of the list area, the table does not move; J and K step; "3 of 120" → AC-7411, AC-7412
- [ ] Board: lift a card, cross a column → the gap shows where it lands; drop → it settles → AC-7414, AC-7415

## Commands
- [ ] `pnpm --filter @crm/web exec vitest run --project browser src/features/forms/PublishDialog.browser.test.tsx src/features/forms/ShareTab.browser.test.tsx src/features/link-page/LinkPage.browser.test.tsx src/features/menus/Menus.browser.test.tsx` → pass → AC-7401 to AC-7405
- [ ] `pnpm --filter @crm/ui exec vitest run --project "stories (chromium)" src/modules/ShareSheet src/modules/ReadyPanel` → pass, axe clean in both themes → AC-7403
- [ ] `test ! -e apps/web/src/features/link-page/qr-png.ts && test ! -e apps/web/src/features/forms/ShareBlock.tsx && test ! -e apps/web/src/features/link-page/ShareLinkPageModal.tsx` → AC-7402, AC-7418
- [ ] `pnpm size` → no line more than 20 B above the base (296.61 kB, 7.86 kB, 205.9 kB, 18.57 kB, 188.89 kB, 19.37 kB) → AC-7417
- [ ] The share code before and after (gzip -9) → at least 30% less → AC-7418
- [ ] Each touched route's static closure past the first load, before and after → reported in the batch → AC-7419
- [ ] `pnpm --filter @crm/web exec vitest run build.test.ts` → ShareSheet not in `index.html`, `book.html` or `form.html` → AC-7419
- [ ] `pnpm --filter @crm/ui exec vitest run --project unit src/modules/ShareSheet` → `javascript:`, `data:`, `vbscript:` refused → AC-7420
- [ ] `grep -rn "dangerouslySetInnerHTML\|innerHTML\s*=\|insertAdjacentHTML" apps/web/src packages/ui/src` → only the lines 0073 allowed → AC-7423
- [ ] Batch 5: a browser test counting the data layer's reads on opening a panel for a held record → no read for the record → AC-7425
- [ ] Batch 6: a story with 10,000 sortable rows, lift and move 50 steps → rows drawn stay bounded, no long task → AC-7424
- [ ] `pnpm check` → green
