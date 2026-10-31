# /check verify 0058, lanes B and C · FAIL

**Spec**: [0058 Visual and short](../specs/0058-visual-and-short/index.md), lanes B (forms) and C (link page and first run) only.
**Branch**: `wip/visual-land1` at `bb71aca1e` (wip/visual-links merged with wip/visual-forms).
**Date**: 31 October 2026.

**FAIL: 2 of the 17 criteria checked fail (AC-2, AC-4), AC-1 fails on the probe, 2 are partly blocked (AC-8 inline claim, AC-16 preview list).**
Next: run `/debug` on the kind grid focus (AC-4/AC-9) and the reduced motion fades (AC-2). Then rerun this check.

## How it ran

- The real app came from this worktree: the api on :3200, the worker on :3201 and Vite on :5280 (`API_DEV_ORIGIN=http://localhost:3200`). It used its own database, `crm_vl1` on the compose Postgres, with all migrations applied (to `0135_link_page_switch`). `CALENDAR_SYNC=on` was set with dummy Google credentials, so the Calendar step shows.
- One headless Chromium was driven by Playwright scripts, 1440 × 900, plus a 2000 × 1100 pass. Every screen was shot in light and dark. The alignment probe (`@crm/ui/alignment-probe`) and axe (WCAG 2.2 AA tags) ran on each screen and popup. Keyboard walks and reduced motion (`reducedMotion: 'reduce'`) were checked too.
- A real sign up went through Mailpit, then the whole first run, then link page edits, then a form's first publish. Two visitors submitted the hosted form, an invited member joined, and every confirm was opened.
- Screenshots are in the session scratchpad, `.../scratchpad/vl1/shots/` (named below).

## Failing or owed

- **AC-4 / AC-9, keyboard (fail)**. In the Add block grid (`Add to your link page`), an arrow key onto Email signup, Writing, Questions, Testimonial, Contact card or Section selects the kind. That kind's form then autofocuses its first field and pulls focus out of the grid. So a keyboard user can never arrow across the grid. Observed: from Timefix form, ArrowRight lands on `INPUT "The row on your page"`. From Writing, ArrowRight lands on `INPUT "Title"`. From Testimonial, ArrowRight lands on `INPUT "Full name"`. Shot: `lp-add-arrow-steal-{light,dark}.png`. Run `/debug`.
- **AC-4, focus ring (fail)**. A focused choice tile that is also selected looks the same as a selected tile without focus. The focus halo is `rgba(31,95,214,0.14) 0 0 0 3px`, and in dark it can't be seen. This shows in the Add block grid, the presets and the Install tiles. Shot: `lp-add-gridfocus-dark.png` against `lp-add-kbd-dark.png`.
- **AC-2, reduced motion (fail as written)**. With reduced motion on, the publish Modal still fades in (`ws-modal-fade-in` 240 ms), and so do the Ready panel and its check (`ws-ready-panel-fade` 240 ms, running). Tile ticks still fade over 160 ms. The spec and verify.md ask for an instant change. The movement itself is removed, and only `transform`, `opacity`, `translate` and `scale` animate, with token durations. Escape closed the Ready panel in about 70 ms (it doesn't block).
- **AC-1, probe (fail)**. Every popup head has `paddingRight 11px`, which is off the spacing scale. This covers Add block, Import, Share, Publish, Ready and Sync. Select and disclosure triggers have 1 px paddings: Save to, the mapping rows, the Icon select, For developers and Role. The other probe hits are false positives: layout containers with large padding, and child spans measured against the empty state container. The tiles were equal size everywhere. The visual misalignments: the Ready panel's three embed tiles stop about 130 px short of the link field's right edge (`form-ready-light.png`). The Install tiles fill only a third of the card (`form-install-dark.png`). The content under For developers is indented about 4 px from the cards above it (`form-install-dev-light.png`).
- **AC-8, inline handle claim (blocked)**. No normal path leaves a person without a handle. First run makes one, and an invited member gets one made for them (`grace`). So `ClaimLink` couldn't be reached in the real app. The Forms and Link page empty states pass: `forms-empty-{light,dark}.png` and `member-linkpage-dark.png`.
- **AC-16, preview list (blocked)**. Locally the import couldn't reach linktr.ee: "We couldn't read that page" (422). The seven services sit on one hint line (pass).

## Per criterion

| AC | Verdict | Evidence |
|---|---|---|
| AC-1 | fail (probe) | See above. axe was clean everywhere. |
| AC-2 | fail (reduced motion) | Normal motion passes: Modal `grow`, Ready `enter` and `pop` 240 ms, tile `scale` 160 ms, colour only on hover. |
| AC-3 | met | Every popup has one heading and one line. Confirms are one line. The Share modal has two short sentences (`lp-share`). |
| AC-4 | fail | Keyboard trap in the grid and a faint focus ring. Names read and axe is clean. |
| AC-6 | met, with a note | `form-ready`: link, Copy link, QR, three embed tiles, no code (`pre/code/textarea` = 0). Share is drawn only where `navigator.share` exists, and this Chromium has none, so no Share shows on desktop Chromium or Firefox. |
| AC-7 | met | `fr-done`: two tiles, the booking link and the link page link, each with Copy link and Open. Six steps, unchanged. The clipboard held `…/ada-lovelace/intro-call`. |
| AC-8 | met for Forms and Link page, blocked for the claim | See above. |
| AC-9 | met visually, fail by keyboard | `lp-add`: an icon grid with names. The description shows only as a tooltip (it showed on focus). |
| AC-10 | met | `lp-presets`: five thumbnails of the real look, the name under each, a ring and tick on the chosen one, and the preview updates. |
| AC-11 | met | `form-install`: three tiles. For developers is closed (`aria-expanded=false`) and opens with Enter onto own HTML, allowed sites, signed posts and the secret. |
| AC-13 | met, with a note | `form-publish`: one step (no Next). Answers auto match, and the email line is one line. The Saved as column uses selects, not chips. |
| AC-14 | met | `form-sync`, `form-sync-all`: Only unfiled is the default, with a count and one button "Sync 2 submissions". |
| AC-16 | hint met, preview blocked | See above. |
| AC-18 | met | Each one is a Modal with one line and two buttons: delete block, delete form, rotate secret, remove site, change object. None is a toast. |
| AC-21 | met (normal motion) | Copied shows a tick (`fr-done-copied`, `form-ready-copied`). The Ready panel eases in and its check pops. Done tiles rise. |
| AC-23 | met | `lp-screen`: a claimed handle is live at once. The switch works by keyboard, a visitor gets "Page not found" while it's Private and the page while it's Live. The invited member's page read Private on Home until they opened it, then went Live with an Undo toast. The old panel is gone. |
| AC-25 | met | `fr-calendar`, `fr-invite`: Skip for now on both. |

Nothing in verify.md or the scope was ticked, because the verdict is FAIL.

## For /check review (works, but short of world class)

- In dark mode, the phone preview's light page stops where the content stops, and the frame below stays dark. This shows on the link page and on the form preview (`lp-screen-dark`, `lp-presets-dark`, `form-sync-all-dark`).
- Calendar's Skip is a ghost button, and Invite's Skip is a filled secondary. Same words, two looks.
- The switch label always reads "Live", even when it is off. Private is shown only by the line in the card and a lock icon, so "Live" next to an off switch reads oddly. Share, Open and "Paste it in your bio" are still offered while the page is Private.
- The Ready panel has two primaries (Copy link and Done), and the QR leaves a large empty area to its right.
- The Add block tiles are large grey wells with a 14 px icon, so they read as unfinished. The presets Plain, Paper and Quiet look almost the same.
- Sync says "Unchanged 2" beside "Sync 2 submissions". The menu says "File earlier submissions the way the form files now", but the dialog says "Save … saves now".
- Done step: the preview's link rows are skeleton bars, which look like it is still loading.
- Forms empty state: there are two primaries, the bar's New and the empty state's New form.
- In this setup Centrifugo refused the socket (403), because :5280 isn't an allowed origin. This comes from the environment, not from these lanes.

## Fixes after this verify (31 October 2026)

Rechecked in the real app (own database `crm_vl1fix`, api :3200, Vite :5280, one headless Chromium, light and dark, then reduced motion). Shots: `.../scratchpad/vlfix/shots/`.

- **AC-4 / AC-9, keyboard: fixed.** The Add modal's frame keeps focus on the tiles while an arrow swaps the kind: an editor's form focuses its first field only for the kind the modal opened on (`useFocusesFirstField`). Enter, Space or a click on a tile moves to that kind's first field. Arrowed from Link to Section with focus on each tile, then Enter landed in "What they said" (`lp-add-focus`). Covered by `LinkPage.browser.test.tsx`, "the Add modal's keyboard".
- **AC-4, focus ring: fixed.** A focused tile now draws the library ring (the accent line outside the tile past a hairline gap, plus the halo), so a focused chosen tile differs from a chosen one in both themes (`lp-add-focus-dark`, story `ChoiceTinted`).
- **AC-2, reduced motion: fixed.** Modal and scrim, ReadyPanel and its mark, and the tile tick change at once under reduced motion: no animations ran on open, on the Ready panel or on a tick, and Esc closed in about 50 ms.
- **AC-1: fixed.** Popup heads have 16 px on both sides; the close button's optical offset moved to a negative margin. Select and Disclosure triggers, and Table cells, drop the button and cell UA 1 px. ChoiceTiles use `auto-fit`, so the Ready panel's and Install's embed tiles end on the right edge (Ready: link row, last tile and grid all end at 984 px; `form-ready`, `form-install`). The probe passes on Add, Ready and Sync. Install's one hit is the false positive noted above (a layout container's 776 px padding).
- **Live switch:** reads "Live" when on and "Private" when off; its accessible name stays "Live" (Switch `offLabel`, drawn by CSS so the hosted form's first load stays in budget; `lp-switch-on`, `lp-switch-off`).
- **Skip for now:** both steps use the ghost button. The filled look in `fr-invite` was the pointer resting over it after the Calendar step's Skip (`fr-invite` now).
- **Ready panel:** one primary (Done); Copy link is secondary (`copyVariant`). With no preview, a line beside the QR says to point a phone's camera at it.
- **Add block tiles:** each kind's picture slot is tinted in its data hue, with the mark at one and a half `size-icon` (Icon `lg`).
- **Sync:** one count line ("2 already match.") replaces the Stats row, and the dialog says "File …" as the menu does (`form-sync-all`).
- **Done step preview:** the placeholder rows show only on Your link; Invite and Done show the real rows alone (`fr-done`).
- **Dark mode phone preview:** the page fills the phone's screen to its foot (`lp-screen-dark`).

## Left as is, by decision

- AC-13 keeps dropdowns for Saved as: the mapping must stay editable.
- AC-8's inline claim is only reachable with no handle. `ClaimLink` lives in the app (no Storybook there); `LinkPage.browser.test.tsx`, "a link page with no handle", renders and drives it.
- AC-16's preview list needs the network (linktr.ee); the hint line passes.
- Plain, Paper and Quiet looking alike is spec 0060's 14 looks.
