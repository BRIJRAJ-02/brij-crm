# /check verify 0058, lane A1 · FAIL

**Spec**: [0058 Visual and short](../specs/0058-visual-and-short/index.md), lane A1 only (booking popups): AC-1 to AC-5, AC-15, AC-17, AC-18, AC-21.
**Branch**: `wip/visual-booking` at `ed1bfa4c7` (on crm-6a's L1 lane, `aa2496644`).
**Date**: 31 October 2026.

**FAIL: 5 of the 9 criteria are met. AC-18 and AC-3 fail on the booking page delete confirm. AC-2 fails on reduced motion. AC-1 fails on the probe, but only on shared library paddings. AC-5 is met with one gap.**
Next: run `/develop` on `DeletePageDialog` copy (AC-3, AC-18). Run `/debug` on the reduced motion fade (AC-2, a Lane 0 library item, the same finding as lanes B and C). Then rerun this check.

## How it ran

- The real app ran from this worktree: the api on :3220, the worker on :3221 and Vite on :5290 (`API_DEV_ORIGIN=http://localhost:3220`). It used its own database, `crm_vba1`, on the compose Postgres, with every migration applied. The database was dropped afterwards.
- One headless Chromium, driven by Playwright scripts at 1440 × 900 (browser zone Asia/Kolkata). Every screen was shot in light and dark inside the real layout. The alignment probe (`@crm/ui/alignment-probe`) and axe (WCAG 2.2 AA tags) ran on each popup. Keyboard walks were done, and a second pass ran with `reducedMotion: 'reduce'`.
- A real sign up went through Mailpit. Then New booking page was used four times, schedules were made, renamed and deleted, a visitor booked Mon 2 Nov 9:00 on the public page, and time off over 2 to 3 Nov was saved over that booking. Every confirm was opened.
- Screenshots are in the session scratchpad, `.../scratchpad/vba1/shots/` (named below).

## Failing or owed

- **AC-18 and AC-3, delete booking page (fail)**. The confirm reads "The link stops working, and this can't be undone. Bookings already made stay." That is two sentences and 14 words, and it wraps to two lines (`page-delete-{light,dark}.png`). `strings.deleteText` was not touched on this branch. The schedule and time off confirms pass.
- **AC-2, reduced motion (fail as written)**. With reduced motion on, the Ready panel and its check still fade in (`ws-ready-panel-fade`, 240 ms, opacity only). The spec asks for an instant change. Normal motion passes: `enter` (opacity and translate) and `pop` (opacity and scale), both 240 ms from `--duration-modal`, with the pop delayed by `--duration-hover`. Escape during the enter animation reached the editor in 55 ms.
- **AC-1, probe (fail on shared library paddings)**. The Modal head has `paddingRight 11px` (`calc(--overlay-inset - (control - icon) / 2)`, an optical inset for the close icon). The Select triggers in Time off have 1 px block paddings. Both come from the library, not this lane. With those ignored, every popup passes: New schedule, Rename, Delete schedule, Time off (empty, filled and saved), Delete time off and Delete booking page. In New booking page, the field, the segmented control, the radio group and the footer all share left 496 and right 944.
- **AC-5, the editor behind the panel (gap)**. The spec says "the editor opens behind it". Behind the Ready panel you see the Links list, and the editor opens only once the panel is dismissed (`ready-{light,dark}.png`). Dismissing takes one action (Escape, close or Edit page).

## Per criterion

| AC | Verdict | Evidence |
|---|---|---|
| AC-1 | fail (probe, library) | See above. axe was clean on every popup. |
| AC-2 | fail (reduced motion) | See above. Only `opacity`, `translate` and `scale` animate. Button colour moves only on hover (120 ms). |
| AC-3 | fail (delete page) | New schedule, Rename and Delete schedule each show one line ("No pages use it. This can't be undone."). Time off has no hint lines. Delete time off reads "These days open for booking again." Ready reads one heading and "Anyone with the link can book." The delete page body fails. |
| AC-4 | met | Focus goes to Title on open. The duration segments arrow from 30 to 60 min. Tab order: Title, segments, Who it books, Cancel, Create page. Ready panel focus lands on Copy link. Every delete confirm traps Tab between Cancel and Delete, with a ring. axe was clean in both themes. |
| AC-5 | met, with a gap | `ready-*`, `ready-share-rm0-*`: a link field, Copy link, QR (`svg[aria-label="QR code for the link"]`, 120 px) and the live `/b/:key` preview (310 × 150). The clipboard held `http://localhost:5290/ada-lovelace/intro-call-2`. Share shows when `navigator.share` exists (it was injected, and pressing it called share). Plain desktop Chromium has no Share. |
| AC-15 | met | `timeoff-empty-*`, `timeoff-filled-*`: no hint lines. `timeoff-saved-*`: "1 meeting in this time off" with Open Bookings, which goes to `/bookings/calendar`. The For picker is not shown for a workspace with one member, so it was not exercised here. |
| AC-17 | met | `np-empty-*`: Title and Duration (15, 30, 45, 60, Custom). The created page's Hours tab shows "Working hours, Default" (`editor-hours-*`). An admin also sees Who it books (see the notes below). |
| AC-18 | fail (delete page) | Delete schedule, Delete time off and Delete booking page are all alertdialog Modals with two buttons, and none is a toast. The delete page body is two sentences. |
| AC-21 | met (normal motion) | `ready-copied-*`: the button turns into a tick and "Copied", announces "Link copied", and resets to "Copy link" within 3 s. The panel eases in and its check pops once. Nothing loops. Under reduced motion, the message stays. |

Nothing in verify.md or the scope was ticked, because the verdict is FAIL.

## For /check review (works, but short of world class)

- **Time off saved says the count twice.** The Modal head shows "1 meeting in this time off" beside the close button, and the warning Callout repeats it (`timeoff-saved-light.png`). Focus also lands on the close icon, not Done.
- **The Time off date picker offers past presets**: "Last 7 days, Last month, This quarter". Leave is planned forward, so these presets are wrong here. There is also an empty row between the calendar and the presets (`timeoff-calendar-open-dark.png`).
- **The Ready preview is clipped.** At 150 px tall, it shows only the avatar and name, and the page title is cut through at the bottom edge (`ready-share-rm0-light.png`).
- **The Ready link field cuts the URL off mid word** with no fade or ellipsis once Share is present (`…/rm-ch`).
- **Two headings on Ready**: the Modal title (the page name) and "Your booking page is ready". One of them could go.
- **Who it books** adds three radio cards to New booking page for admins, each with a help line. "Books whoever in the workspace is free, in turn. It's on nobody's profile." is 13 words. AC-17 asks for a name and a length.
- In the Ready panel, the preview region is a Tab stop with no visible focus ring.
