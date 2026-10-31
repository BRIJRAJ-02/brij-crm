# /check verify 0058, lanes B and C, final · FAIL

**Spec**: [0058 Visual and short](../specs/0058-visual-and-short/index.md), lanes B (forms) and C (link page and first run) only.
**Branch**: `wip/visual-land1` at `a2fea6b5f` (CI green, run 41166330803).
**Earlier reviews**: [0058-verify-lanes-b-c.md](0058-verify-lanes-b-c.md) (first verify, fixes, re-check).
**Date**: 31 October 2026.

**FAIL on two items. Every finding from the earlier verify still holds as fixed, and five of the seven polish fixes hold in full. Two things block landing:**

1. **Phone width, link page bar (AC-1).** At 390 px wide, the Link page bar runs off the screen while the page is Live. The page scrolls sideways (`scrollWidth` 485 on the overview, 564 under Edit page, against a 390 viewport). Share and Done sit past the right edge, and the address pill is cut. While Private it fits (390). Shots: `ph-lp-{light,dark}.png`, `ph-lp-edit-{light,dark}.png`.
2. **Polish fix 4, Private hides the address and Share (AC-23), holds only in the bar.** The bar is right: while Private it shows only the switch with "Private" beside it, with no address pill and no Share. But the overview you land on first (the "Your page" card, before Edit page) still offers everything for sharing: Share online with the address and copy, Open, "Paste it in your bio, an email signature or a message.", then Share in person with the QR, the address and Download. Its line does say "Private. Only you can open it.", yet anyone you hand that link gets "Page not found". Shot: `lp-overview-private-{light,dark}.png`.

Next: you may want to run `/debug` (or `/develop`) on these two, then rerun this check on the phone pass and the Private overview only.

## How it ran

- The real app came from this worktree: api :3320, worker :3321, Vite :5320 (`API_DEV_ORIGIN=http://localhost:3320`), its own database `crm_vlfin` on the compose Postgres with every migration applied (136, to `0135_link_page_switch`). `CALENDAR_SYNC=on` with dummy Google credentials. Outlook was checked both ways: first with `CALENDAR_OUTLOOK` unset, then with the api restarted under `CALENDAR_OUTLOOK=on` and dummy Microsoft credentials.
- One headless Chromium, driven by Playwright scripts. Desktop at 1440 × 900, phone at 390 × 844. Every screen was shot in light and dark inside the real layout, with its popup or modal open where one applies, and every shot was looked at. The alignment probe (`@crm/ui/alignment-probe`) ran on each popup and screen, axe (WCAG 2.2 AA tags) on the forms and link page screens, and reduced motion (`reducedMotion: 'reduce'`) against normal motion.
- Two fresh sign ups went through Mailpit and the whole first run, one at desktop width and one at phone width. Then the link page, a form's first publish, two visitor submissions on `/f/verify-form`, Sync and the confirms, a second form published at phone width, and a booking page deleted to reach the empty Links state.
- Story probes: the ReadyPanel, EmptyState and TileGrid stories that call `probeAlignment` passed in CI run 41166330803. They were not rerun here (Storybook would be a second server). In the app, the probe passed on Ready, Add block, Publish, Sync, Import, Share and the empty Links state.
- Shots: `/private/tmp/claude-501/-Users-brijraj-Desktop-brijraj-crm/2259bda6-8fc1-4ef4-a83d-b6fba62f0413/scratchpad/vlfin/shots/`. The servers and the browser are stopped, and the database is dropped.

## The seven polish fixes

| # | Fix | Verdict | Evidence |
|---|---|---|---|
| 1 | AC-1: For developers is a quiet fold, its cards on the same left edge | holds | Open, the cards under it start at x 276, the same as Share and "Put it on your site". Every card heading starts at 293 ("Put it on your site", "Your own HTML", "Allowed sites", "Signed posts"). The trigger is a quiet ghost button. Phone: every card heading at 81 (`form-install-dev-{light,dark}`, `ph-form-install-dev-{light,dark}`). |
| 2 | Sync counts only what would change, "All N already match." with Done when nothing would | holds | Only unfiled (the default): "Nothing to sync. Every earlier submission already follows the form." with Done. All: "All 2 already match." with only Done, no Sync button (`form-sync`, `form-sync-all`). The case where some would change was blocked: the only remap I tried (Your name to Job title) was rightly refused on publish ("Name is required on Person…"), so no submission could differ. `SyncDialog.browser.test.tsx` covers that count. |
| 3 | Empty Forms and Links have one primary | holds | Forms: the bar's New is the one primary, New form is secondary (`forms-empty`, `ph-forms`). Links: New is the one primary, New booking page is secondary (`links-empty`). |
| 4 | A Private link page hides its address and Share | **fails on the overview** | Bar while Private: Share 0, address 0, "Live" with "Private" beside it (`lp-private`). Bar while Live: the address pill and Share come back (`lp-live`). Overview while Private: still shows the address, copy, Open, the bio hint, the QR and Download (`lp-overview-private`). |
| 5 | Outlook connects, or says "Outlook coming soon" where it's off | holds | Off: a disabled secondary "Outlook coming soon" under Connect Google Calendar (`fr-calendar`). On: "Connect Outlook" is enabled, and pressing it went to `/api/calendar/microsoft/start?workspace=…&then=welcome`, then on to `login.microsoftonline.com` (`fr-calendar-outlook-on`, `ph-fr-calendar`). |
| 6 | In dark mode the form preview fills the phone | holds | The light form's ground runs to the phone's foot under Ready and Sync in dark (`form-ready-dark`, `form-sync-all-dark`). The link page preview does too (`lp-live-dark`). |
| 7 | Reduced motion shows the link page blocks at once | holds | Reduced: no animation on the editor at load, on Edit page, or on the public `/ada-lovelace` page (`an=none`, opacity 1). Normal: `ws-link-page-rise` 180 ms runs in each place. The Add modal under reduced motion ran only 120 ms colour transitions, and Escape closed it in 32 ms. |

## The earlier findings

- **Arrow keys across the Add block grid: still fixed.** From Link, ArrowRight eight times landed on each radio in turn (Booking page to Section), and focus never left the grid. Enter on Testimonial moved focus to "What they said" (`lp-add-focus`).
- **Focus ring apart from the selected state: still fixed.** The focused chosen tile has a 2 px accent outline, offset 1 px, plus the halo. The others have none. The tooltip shows on focus (`lp-add-focus-{light,dark}`).
- **Reduced motion on the Modal, Ready panel and tiles: still fixed**, and now the link page blocks too (fix 7).
- **Popup head padding: still fixed.** 16 px on both sides in Add, Publish, Import, Share and Sync.
- **Embed tiles fill the row: still fixed.** Ready: the link row, the last tile and the grid all end at 984 px. Install: tiles end at 1407 px.
- **For developers indent: fixed** (fix 1).
- **Live switch, Skip, Ready panel, tinted kind tiles, Done preview: still hold.** The switch is named "Live" in both states, with "Private" as its description. Both Skips are ghost buttons. Ready has one primary (Done). Each kind's tile is tinted. The Done step shows the real Intro call row with no placeholder bars (`fr-done`, `ph-fr-done`).

## Quick pass, ACs 3 to 26 for forms, the link page and first run

| AC | Verdict | Evidence |
|---|---|---|
| AC-1 | **fail (phone)** | Desktop passes as above. Phone: the link page bar overflows (must fix 1). Forms, the form editor, Install and Home fit at 390. |
| AC-2 | met | Fix 7 and the earlier re-check. |
| AC-3 | met | Import: one hint line of seven services. Sync, Delete form, Remove block and Delete booking page are one line each. Share has two short sentences, as before (`lp-share`). |
| AC-4 | met | Arrows and ring as above. axe clean on Forms empty, Publish, Ready, and the link page overview and editor, Live and Private, in both themes. |
| AC-6 | met | Link, Copy link, QR, three embed tiles, no code (`pre, code, textarea` = 0). The clipboard held `…/f/verify-form` (`form-ready`, `ph-form-ready`). |
| AC-7 | met | Six steps. Two tiles, each with Copy link and Open. The clipboard held `…/ada-lovelace/intro-call` (`fr-done`, `ph-fr-done`). |
| AC-8 | Forms and Links met, claim still blocked | One primary each (fix 3). The inline claim still can't be reached in the app (first run always makes a handle). |
| AC-9 | met | Icon grid with names, description only as tooltip (`lp-add-focus`, `ph-lp-add`). |
| AC-10 | met | Paper chosen by arrow, the tick and ring moved (`lp-presets`). |
| AC-11 | met | Three tiles. For developers was `aria-expanded=false`, then `true` after Enter. |
| AC-13 | met | One step, answers auto matched, the email line is one line (`form-publish`). |
| AC-14 | met | Fix 2. |
| AC-16 | hint met, preview blocked | Hint as above. The preview list needs linktr.ee over the network. |
| AC-18 | met | Delete form, Remove block and Delete booking page are each a Modal with one line and two buttons (`form-delete-confirm`, `lp-delete-confirm`, `links-delete-confirm`). After the confirm, a toast says "Deleted “Intro call”." |
| AC-21 | met | Copied shows a tick. Ready and Done ease in under normal motion. |
| AC-23 | **partly met** | Claimed handle is live at once. A visitor gets "Page not found" while Private and the page while Live. The bar is right. The overview still offers the address while Private (must fix 2). |
| AC-25 | met | Both Skips are ghost buttons, at desktop and phone width. |

Not in these lanes, seen in passing (lane D): the form thanks screen is a warm card with one next step ("Send another") but no summary of what was sent (AC-19, `visitor-thanks-{light,dark}`). "Powered by" sits quietly at the foot of `/f/` and `/<handle>` (AC-26, `visitor-handle-{light,dark}`). `/f/:key` and `/<handle>` kept their routes (AC-20).

## For /check review (works, not blocking)

- The form editor logged a React error once: "This library called use() to suspend in a previous render but did not call use() when it finished." Nothing broke on screen.
- On the phone, the Add block modal's footer puts a small Add item on the left with a full width Cancel under it, and the help line above both (`ph-lp-add-dark`).
- On the public page, under reduced motion, the loading skeleton still pulses (`ws-skeleton-pulse`, 1400 ms) until the content arrives. That comes from the library's Skeleton, not these lanes.

Nothing in verify.md or the scope was ticked, because the verdict is FAIL.

## Recheck (41db71084, CI run 41170620801)

**Verdict: PASS.** Both must fixes hold in the real app. This was a short, targeted recheck of the two, not a new full verify.

- Setup: api :3370, worker :3371, Vite :5370 from the `visual-land1` worktree, its own database `crm_vlre` with every migration applied, one fresh sign up through Mailpit and the first run, and one headless Chromium. Shots were taken in light and dark, and each one was looked at. axe ran with the WCAG 2.2 AA tags in both themes. Shots: `/private/tmp/claude-501/-Users-brijraj-Desktop-brijraj-crm/2259bda6-8fc1-4ef4-a83d-b6fba62f0413/scratchpad/vlre/shots/`. The servers and the browser are stopped, and the database is dropped.
- **AC-1, the bar on a phone: fixed.** While Live, `scrollWidth` equals the viewport on both the overview and Edit page, at 390 (390/390) and at 320 (320/320). The address and Share drop their words for 26 × 26 icons, and Done does too under Edit page. Done's right edge sits at 374 of 390 and at 304 of 320. Share opens its dialog, and Done goes back to the overview. Every icon only control keeps its name: link "localhost:5370/ada-lovelace, open your page", button "Share", button "Done", and switch "Live". axe is clean on the overview, Edit page and Add (`ph390-lp-live`, `ph390-lp-edit-live`, `ph320-lp-live`, `ph320-lp-edit-live`, `ph390-lp-share`, `ph320-lp-share`). At 320 the bar's title truncates to "Lin…", which is fine.
- **AC-23, the Private overview: fixed.** While Private, the Your page card reads "Private. Turn on Live to share it." with Edit page and a Turn on Live button. It has no address, copy, Open, QR code or Download, and the bar has no address and no Share. This holds after a reload. Pressing Turn on Live (by keyboard) turns the bar's switch on and brings back Share online, the address, Open, the QR code, Download, and the bar's address and Share. A reload keeps it Live. The result is the same at 1440 and at 390, and axe is clean both ways (`p1440-overview-private`, `p390-overview-private`, `p1440-overview-live-again`, `p390-overview-live-again`).
- **Add block modal footer on a phone: fixed.** Add item and Cancel now share one full width (326 px at 390, 256 px at 320), with Add item above Cancel and the help line above both (`ph390-lp-add`, `ph320-lp-add`).
- For /check review (not blocking): Turn on Live unmounts itself, so keyboard focus falls to `body` after you press it. Moving focus to the bar's switch or to the card's heading would keep your place.
