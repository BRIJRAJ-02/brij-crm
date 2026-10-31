# /check verify 0058, lane A1, final · PASS

**Spec**: [0058 Visual and short](../specs/0058-visual-and-short/index.md), lane A1 (booking popups and flows).
**Branch**: `wip/visual-booking` at `ae6ae9c98` (CI green, run 41166554988, with the hosted form slimming commits).
**Earlier review**: [0058-verify-lane-a1.md](0058-verify-lane-a1.md) (FAIL at `ed1bfa4c7`).
**Date**: 31 October 2026.

**PASS: every lane A1 criterion is met, and every finding from the earlier review is fixed or was a review note that is now handled. Ready to land.** Two small should fixes are listed below; neither blocks the landing.

## How it ran

- The real app ran from this worktree: api on :3340, worker on :3341, Vite on :5340, against its own database `crm_vbfin` on the compose Postgres with every migration applied. The worker used the current shared worker password (no login role was changed). The database was dropped at the end (and again after a short second run for the unignored probe), and the stack and browser were stopped.
- One headless Chromium, driven by Playwright scripts. Every popup was shot in light and dark, at 1440 × 900 and 390 × 844, inside the real layout, with popovers and modals open. The alignment probe (`@crm/ui/alignment-probe`) and axe (WCAG 2.2 AA tags) ran on each popup. Keyboard walks ran at 1440, and one pass ran with `reducedMotion: 'reduce'`.
- A real sign up went through Mailpit and the first run steps. A visitor booked Mon 2 Nov 9:00 on the public page, time off over 2 to 3 Nov was saved over it, a teammate was invited and joined, and a deal was made, deleted and undone.
- Shots: `/private/tmp/claude-501/-Users-brijraj-Desktop-brijraj-crm/2259bda6-8fc1-4ef4-a83d-b6fba62f0413/scratchpad/vbfin/shots/` (115 files, names below, each with `-light` and `-dark`).

## The earlier findings, rechecked

| Earlier finding | Now | Evidence |
|---|---|---|
| AC-18, AC-3: delete booking page was two sentences on two lines | Fixed. "Its link stops working. Bookings already made stay." One line (20 px box) at 1440 and at 390. alertdialog Modal, two buttons, Tab stays between Cancel and Delete. | `page-delete-1440-*`, `page-delete-390-*` |
| AC-2: the Ready panel and its check faded under reduced motion | Fixed. With reduce on, `.ws-ready-panel-root` and `.ws-ready-panel-check` have `animation: none` and opacity 1 at once. The Modal has no animation either. "Copied" still shows. | reduced motion run, `rm-ready-copied-*` |
| AC-1: Modal head 11 px right padding, Select triggers 1 px block padding | Fixed. The probe passes with no ignores at all; the Modal head pads 16 px each side. | probe logs |
| AC-5: the editor is not behind the Ready panel | Unchanged, as accepted before: the Links list sits behind, and one action (Escape, close or Edit page) opens the editor. | `ready-*`, `editor-*` |
| Time off saved said the count twice | Fixed. Said once, in the warning Callout, which is announced. | `timeoff-saved-*` |
| Time off saved focused the close icon | Fixed when Save is clicked (focus on Done). Not when saved with ⌘↵, see the should fixes. | focus probe |
| Time off picker offered past presets | Fixed. Tomorrow, Rest of this week, Next week, Next month. | `timeoff-calendar-1440-*`, `timeoff-calendar-390-*` |
| Ready preview clipped | Fixed. The preview shows the avatar, name, page title, length and zone. | `ready-1440-*`, `ready-390-*` |
| Ready link cut mid word | Fixed. Cut in the middle with an ellipsis, so host and key both show ("http://localhost:5… intro-call-390"). | `ready-390-*` |
| Two headings on Ready | Fixed. One heading, the Modal's "Your booking page is ready". | `ready-*` |
| Who it books: three cards with long help lines | Fixed. Three plain radios in a row (two rows at 390), the help in one InfoTip. | `np-empty-*`, `np-infotip-*` |
| Ready preview was a Tab stop with no ring | Fixed. Tab now goes Copy link, Edit page, Close, and back. | keyboard walk |

## Per criterion (booking side)

| AC | Verdict | Evidence |
|---|---|---|
| AC-1 alignment | met | Probe ok on New booking page (71 checks), Ready (left edges, baseline, button height), New schedule, Rename, Delete schedule, Time off (empty, filled, saved), Delete time off and Delete booking page, at both widths. A second run with no ignores at all (Modal head and Selects included) also passes on New booking page, Ready, Time off, New schedule and Delete schedule; the Modal head now pads 16 px on both sides and 8 px top and bottom. |
| AC-2 motion | met | Normal motion: Ready `enter` and check `pop`, 240 ms, opacity, translate and scale only; button colour 120 ms on hover. Reduced motion: no animation on the Modal or Ready panel. Only button border colour transitions (120 ms) remain under reduce; colour is not movement, as accepted in the earlier review. |
| AC-3 less text | met | New booking page: no help lines, the one help in an InfoTip. Confirms: "No pages use it. This can't be undone.", "These days open for booking again.", "Its link stops working. Bookings already made stay." Ready: one heading and "Anyone with the link can book." |
| AC-4 accessibility | met | axe clean on every popup and popover, both themes, both widths (Ready, New booking page, InfoTip, Hours Select listbox, schedule dialogs, Time off and its calendar, every confirm, welcome Calendar and Invite). Focus opens on Title; Ready opens on Copy link; every confirm traps Tab between Cancel and Delete with a ring. |
| AC-5 Ready panel | met (gap as before) | Link field, Copy link (clipboard held `http://localhost:5340/ada-lovelace/intro-call-1440`), QR (`svg[aria-label="QR code for the link"]`, 120 px), live preview. Share needs `navigator.share`, which plain desktop Chromium lacks. |
| AC-12 rotation | not in A1 | Planned for lane A2 (the member table drawer waits on crm-6a's L2). Today's New group has Fair as default but shows Count meetings and Returning guests open, and the member picker in the popup (`rr-new-1440-*`). Not a finding for A1. |
| AC-15 time off | met | No hint lines; saved shows "1 meeting in this time off" once with Open Bookings, which goes to `/bookings/calendar`. |
| AC-17 new page | met | Title and Duration (15, 30, 45, 60, Custom); the page uses Working hours, Default (`editor-hours-select-*`). Who it books shows for an admin as three plain radios. |
| AC-18 confirms | met | Delete schedule, Delete time off and Delete booking page are alertdialog Modals with one line and two buttons. Undo deletes stay one click: deleting a deal shows "Deleted Big deal 1440." with Undo, no Modal, and Undo brings the row back (`deal-deleted-toast-*`). Set as default also undoes in one click from its toast (`sched-default-toast-*`). |
| AC-21 delight | met | Copy turns into a tick and "Copied", then back to "Copy link" within 3 s (`ready-copied-*`). Ready eases in and its check pops once; nothing loops; under reduce the message stays. |
| AC-25 Skip | not in A1 | Lane C owns the first run steps (`wip/visual-links`, not merged here). On this branch Invite shows "Skip for now" and Calendar shows "Continue without a calendar" (`welcome-calendar-*`, `welcome-invite-1440-*`). Lane C has "Skip for now" for Calendar; check it there. |

## Slimming changed nothing visible

- **Select badge face**: the page editor's schedule Select shows "Working hours" with its Default badge, in the trigger and the option (`editor-hours-select-1440-*`, `editor-hours-select-390-*`).
- **Select dot face**: New deal's Stage Select shows coloured dots for Lead, In progress, Won and Lost, in the trigger and the list, and the table cell keeps its dot (`deal-stage-select-1440-*`, `deal-created-1440-*`).
- **Icons**: Lucide icons draw everywhere checked: sidebar, menus (Rename, Duplicate, Set as default, Delete), the Time off card, buttons, the Callout and the calendar presets. Brand marks draw on the Calendar step (Google, Outlook).
- **Toasts**: success toasts with their icon, Undo and close, at both widths (`sched-default-toast-*`, `deal-deleted-toast-*`, `deal-created-1440-*`).

## Should fix (not blocking)

- **Time off saved with ⌘↵ focuses the close icon, not Done.** Clicking Save lands on Done, as the fix meant. Pressing ⌘↵ (the shortcut shown on Save) lands on Close at 50, 300 and 1000 ms (`timeoff-saved-1440-light.png`, `timeoff-saved-390-dark.png`). Keyboard users are the ones who press ⌘↵, so `autoFocus` on Done likely loses to focus restore from the shortcut path. One line fix in `TimeOffDialog.tsx`; the browser test only covers the click path.
- **An intermittent React warning in dev**: "This library called use() to suspend in a previous render but did not call use() when it finished." It showed twice (once in the New page run, once in the Time off run) and never again in targeted reruns with marks on each step, so it is not tied to a lane A1 action. Nothing on screen broke. Worth a look in `/check review`.

## For /check review (works, small)

- The Time off calendar still keeps an empty sixth row above the presets in a five week month (`timeoff-calendar-1440-dark.png`). It keeps the popover the same height month to month, so it may be on purpose.
- On the Calendar step, Connect Outlook is disabled locally (no Outlook client set), so it is skipped by Tab. Expected here.

Nothing in verify.md or the scope was ticked here; the lane lands in the one train at the end, and the spec's other lanes are still open.
