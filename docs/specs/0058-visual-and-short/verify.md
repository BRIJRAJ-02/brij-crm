# 0058 verify: Visual and short

How `/check verify` proves each criterion on the real app. Screenshots are taken in light and dark, inside the real layout, with a popover or menu open where one exists. The agent that verifies looks at every screenshot itself before a lane lands.

## Alignment probe (AC-1)

A Playwright helper (added by Lane 0, reused by every lane) opens each touched screen and popup and measures real boxes:
- every label, input, tile and button inside one card or popup shares the same left edge (within 1px)
- tiles in a grid have equal width and height
- paddings and gaps are values from the token scale (read from computed style, none off scale)
- label and input in a row share a baseline, buttons in a row share a height
- empty states are centred in their container on both axes
- popups use the standard header and footer layout

The probe fails the lane if any check fails. A human screenshot review backs it up.

## Motion check (AC-2)

- Computed style on animated elements shows only `transform` and `opacity` transitions
- Durations equal the token values, no raw milliseconds in the lane's CSS (Stylelint already refuses them)
- With `prefers-reduced-motion: reduce` emulated, every transition is zero or an instant change
- Pressing Escape or clicking again during an enter or exit animation responds at once

## Per criterion

| AC | How it is checked |
|---|---|
| AC-3 | Word count of each touched popup and empty state from the strings, against the limits in the spec. A reviewer reads each one. |
| AC-4 | Keyboard run through every new tile grid, drawer, disclosure and Ready panel. Focus ring visible, names read by the accessibility tree snapshot, axe contrast clean. |
| AC-5 | Browser test: create a booking page, the Ready panel appears with the link, Copy puts it on the clipboard, QR renders, preview shows. |
| AC-6 | Browser test: first publish of a form shows the Ready panel and the three embed tiles, no code visible. |
| AC-7 | Browser test: Done step shows two tiles with working Copy and Open. Step order unchanged. |
| AC-8 | Browser tests for the three empty states. With no handle, typing a handle in the inline field claims it without leaving the screen. |
| AC-9 | Browser test: the Add block popup shows the icon grid and each kind adds the right block. |
| AC-10 | Browser test: preset thumbnails render the real look, selecting one updates the preview. |
| AC-11 | Browser test: Install shows three tiles, developer material is closed by default and opens with the disclosure. |
| AC-12 | Browser test: Fair is selected on open, advanced fields are hidden, the member list opens in a drawer. |
| AC-13 | Browser test: a normal form publishes in one step, the mapping table shows chips and can be edited, the unique email line is one line. |
| AC-14 | Browser test: Sync shows a count and one button with Only unfiled selected. |
| AC-15 | Browser test: Time off shows no hint lines and shows a meeting count. |
| AC-16 | Browser test: Import shows a preview list and count. |
| AC-17 | Browser test: New booking page takes a name and a length only and uses the default schedule. |
| AC-18 | Browser tests: each delete, remove and rotate confirm opens a Modal with one line and two buttons. |
| AC-19 | Browser tests on `ManagePage` and the hosted form thanks screen: summary card present, one next step, no new requests (network log unchanged). |
| AC-21 | Browser test: Copy shows "Copied" with a tick and resets. Ready panel and Done tiles animate in with token motion only. With reduced motion the same message appears with no movement. A reviewer watches the flows for warmth and for anything that delays input. |
| AC-22 | The marketing build passes (`pnpm --filter @crm/marketing build`). New shots exist at 3840 by 2400 in light and dark. Every claim in the tabs and All features sheet is checked against the code, nothing unbuilt stays. The owner rules still hold. |
| AC-20 | Existing e2e flows pass on CI (`booking-journey`, `booking-edges`, `form-to-booking`). Network and CSP diff is empty. `pnpm check` is green. |

## Before landing a lane

1. Lane skill pass: `crm-design-system`, `interaction-design`, `emil-design-eng`, `interface-affordances`, `subtractive-design`, `humane-functionalism`.
2. `design-system-guardian`, then `ux-interaction-reviewer`.
3. Alignment probe, motion check and screenshots in light and dark.
4. Heavy suites on CI via the lane push script, nothing heavy locally.
