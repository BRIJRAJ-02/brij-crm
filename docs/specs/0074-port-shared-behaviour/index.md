# 0074. Port phase 3: shared behaviour

**Date**: 2026-11-12
**Status**: In Progress
**Batch 1**: built on `feat/port-3`, 12 Nov 2026 (as built, measurements and open items below)
**Builds on**: [0073 Port phase 2, library additions](../0073-port-library-additions/index.md) (ShareSheet, `shareableUrl`, `downloadQr`, the three gates), [0071 Port phase 0, tokens](../0071-port-tokens/index.md) (the app scale, no zoom, motion tokens), [0068 Professional pages and Publish](../0068-professional-pages-publish/index.md) (PublishBar and the publish data), spec 0072 (phase 1, on `feat/port-1`: restyles the 72 shared parts)

## Summary

The prototype keeps four behaviours in one place each: one drag wrapper, one way for popups to wear a guest page's look, one share dialog with one publish bar, and a record panel that floats over the page at full height. The real app has most of the machinery already, but each screen still finishes the job its own way. This spec maps each of the four onto what exists, names every screen it touches, and splits the work into six batches, smallest risk and biggest deletion first. Nothing the app does today is lost: each batch lists the behaviours it must keep.

## Rationale

The mapping evidence, the options and the picks: [rationale.md](rationale.md).

## Requirements

**User stories**:
- As someone sharing a form, a link page, a menu or a booking page, I want the same share dialog every time, so I learn it once.
- As an editor of anything guests see, I want one bar that says whether guests see my latest changes, so I never wonder what is live.
- As a guest on a dark or styled public page, I want its menus, pickers and sheets in the same look, so the page never flashes the app's own theme at me.
- As someone working down a list of records, I want the record panel to float over the list at full height and open at once, so the list never jumps and I never wait for what is already on screen.
- As someone reordering a long list, I want every drag to look and feel the same and stay smooth, so moving things is never a gamble.
- As the owner, I want less hand made code per screen, no slower pages and nothing lost, so the port makes the app better, not just different.

**Acceptance criteria**:

Share and publish
- **AC-7401**: Every dialog in `apps/web` whose job is to hand out a public address (the forms' live dialog, the link page's Share, the menu's live link and QR) is ShareSheet. No screen draws its own QR code beside a Copy link button inside a Modal.
- **AC-7402**: The forms' and the booking page's Share tabs draw their link row with `ShareColumn` (ShareSheet's body, exported beside it, so a tab and the sheet never drift); `ShareBlock.tsx` is deleted. Saving a QR code anywhere in `apps/web` goes through `downloadQr` or the library's `qrPng`, `qrSvg` and `saveFile`; `apps/web/src/features/link-page/qr-png.ts` is deleted and nothing imports it.
- **AC-7403**: ShareSheet takes `qrStyle` (the link page's saved colour, centre picture and frame label, spec 0061 AC-6124) and draws the code in it, on screen and in what Download saves. ReadyPanel takes the same `qrStyle` for its `share` column. Both are additive props; neither part's look changes.
- **AC-7404**: The link page's Share keeps every way it has today: the code in the owner's saved style, Copy link, Download, Open page, Links for each place, Style the code, Add to Wallet (when read), and the workspace's name line. A page that turns Private while Share is open says so at the sheet's foot with Turn on Live beside it ("Private. Only you can open it. · Turn on Live", the forms' footer pattern), and its extra ways other than Open page hide.
- **AC-7405**: A menu's publish ends on ShareSheet titled "Your menu is live", with Open guest menu among its ways. The split button's "Show QR code" becomes "Share" and opens the same sheet titled "Share your menu". With no place to link to, the publish says it with a toast and Share is not offered.
- **AC-7406** (batch 2): Every public thing that has an editor or a card has one Share button that opens ShareSheet: booking pages (with Offer specific times, One time link and Add to link page as its own ways), the workspace link, team pages, the business page. One press Copy link buttons stay where they are today (owner, 5 November 2026: the address copies in one press).
- **AC-7407** (batch 3): Every editor of a published thing heads with PublishBar: the link page (today), Settings › Brand (today), forms, menus and the business page, replacing `EditorStatus` and each screen's own publish buttons there. A booking page keeps its one step save (owner, 9 November 2026: no draft waits), drawn as PublishBar where Publish saves and publishes at once. A first publish ends on ShareSheet titled "<name> is live"; later publishes say Published in the bar.
- **AC-7408** (batch 3): Discard draft, Unpublish, Make private and Hide confirm in a Modal with the action named on its danger button. An Undo that restores a deleted thing stays one click.

Guest looks on popups (batch 4)
- **AC-7409**: Every popup opened on a guest page (Popover, Menu, Select, ComboBox, DatePicker, Tooltip, Modal in every variant) is portalled inside that page's themed root, so it wears the page's theme, template, font, corners and colours. The hosted form, the link page, the booking page and the booking manage page gain it; the menu, business and reservation pages keep theirs.
- **AC-7410**: A popup in the app (not on a guest page) is unchanged: it portals to `document.body` and wears the app's theme.
- **AC-7426**: A guest page's popups carry `--size-topbar: var(--size-bar)` (spec 0071's legacy `size-bar`, 46px, which the guest pages' own bars use; MenuList's root already sets it), so a guest sheet's or dialog's header is the height of the page's bars, never the app's `size-topbar`. A story measures a sheet's header against the page's bar on the menu, link and booking pages.

- **AC-7427** (owed at the phase 1 merge): ReadyPanel's `share` tile and ShareSheet take a `qrSize` option, and the link page's Share uses the large size, since its code is scanned from a screen across a table (the owner's Share design, 25 October 2026). ReadyPanel is phase 1's file, so the option lands when phase 1 merges, not before.
- **AC-7428**: Download saves the PNG in one press (the sheet's Download PNG); the SVG sits in a menu beside it. A download in flight holds the sheet open: Esc, a click outside and Close wait, and Done pressed meanwhile closes the sheet once the file is saved. After a menu's first publish, Done hands focus to the live split button that replaced Publish, never to the page.

Record panel (batch 5)
- **AC-7411**: The record panel floats over the right of the content area at its full height, below the top bar, inset by the content's own padding, never pushing the table or board. Its width is `size-panel`; it enters over `duration-slow` and leaves over `duration-medium` on `ease-smooth-out`, and reduced motion keeps only the fade.
- **AC-7412**: The panel's head says the object and "n of N" with Previous and Next; J and K step like ↑ and ↓ unless focus is in a field, a listbox or a grid; Esc closes and focus goes back to the row that opened it. The quiet line "J K next and previous · Esc close" sits at its foot.
- **AC-7413**: The panel draws at once with the record the data layer already holds (name, the table's columns) and fills each section (activity, tasks, notes, comments, files, related) as its read lands, each with its own Skeleton. It never waits on the slowest read to draw anything, and never reads again what a view already keeps fresh.

Drag (batch 6, after phase 1 lands)
- **AC-7414**: One lift look in the wrapper for every sortable list: the lifted copy on `surface` with `shadow-md` (no tilt, no scale: the house rule keeps `--scale-press` at 1 and the lift follows it), the place it will land as a dashed `border-strong` gap on `surface-subtle`, and a settle over `duration-fast` on `ease-smooth-out` on drop. The ten modules that each draw their own `[data-dragging]` lift lose those rules.
- **AC-7415**: Rows of one kind only land among rows of their kind (a menu's sections and its items in one area), through a `kindOf` option on DragArea; a board card crossing columns shows where it will land while it moves.
- **AC-7416**: No screen imports dnd-kit; every drag goes through `packages/ui/src/lib/drag/` (lint already refuses it elsewhere).

Gate 1: load time
- **AC-7417**: No `pnpm size` line grows by more than 20 bytes (content hash noise) in any batch. Budgets sit at the measurement plus at most 0.5 kB.
- **AC-7418**: Where a shared part replaces hand made screen code (share dialogs, publish bars, popup wiring, drag looks), that code, gzipped, is at least 30% smaller at the end of the phase, measured on the real pages (the owner's rule: measure per phase, on real pages); each batch still reports its before and after, and the old code is deleted, not left beside the new. The share code is measured again at phase end (amended 13 Nov 2026: batch 1's 25.7% is accepted, since no first load grew and Menus fell 4.4 kB).
- **AC-7419**: Each batch reports every touched route's lazy JavaScript and CSS (its static closure past the first load, gzipped) before and after. ShareSheet stays out of `index.html`, `book.html` and `form.html` (`apps/web/build.test.ts`, which batch 1 makes load bearing).

Gate 2: security
- **AC-7420**: Every address a share or publish surface draws, copies, shares or encodes into a QR code passes `shareableUrl` (inside ShareSheet) or `safeHref` (ReadyPanel's onward row, PublishBar's Preview). A test proves a `javascript:` address draws nothing shareable.
- **AC-7421**: Publish, unpublish, discard and restore keep their server side checks unchanged; the client only hides what the server would refuse. The checks relied on (`packages/core/src/access/table.ts`): `publishForm`, `setFormStatus` (`forms.manage`); `publishMenus`, `discardMenuDraft`, `setMenuHidden` (`hospitality.manage`); `publishBusinessPage` (`hospitality.manage`); `publishLinkPage`, `discardLinkDraft`, `restoreLinkPageVersion` (`ownLinkPage`); `showMyLinkPage` (the member's own page only); `publishBookingPage`, `discardBookingPageDraft`, `restoreBookingPageVersion` (`bookingPages`, the page's own door); `publishBrandTemplate` (`workspace.manage`).
- **AC-7422**: A drag never moves something the person can't change: every drag site passes `isDisabled` from the same `canChange` (or permission) the server checks, and the server refuses the write regardless. Batch 6 lists each site and its check.
- **AC-7423**: No batch adds raw HTML: no `dangerouslySetInnerHTML`, `innerHTML` or `insertAdjacentHTML` (spec 0073 AC-7317's lint holds).

Gate 3: scalability
- **AC-7424**: While a row is lifted in a list of 10,000 (the board, the sidebar, a virtualised table), each move does work bounded by the rows drawn, not by the list: place lookups use a map built once at lift, and announcements read it. Virtualised lists keep scrolling and drawing while a row is lifted (auto scroll), proven by a story with 10,000 rows.
- **AC-7425**: The record panel opens with no read for what a view already holds (AC-7413), proven by a browser test that counts the data layer's reads.

## Decision

**Chosen option**: map each behaviour onto the real part that already does most of it, add only small additive props, and land it in six batches ordered by risk (Option 2 in the rationale).

**Implementation skills**:
- `crm-design-system` (`.claude/skills/crm-design-system/`): house rules, always
- `crm-frontend-state` (`.claude/skills/crm-frontend-state/`): the record panel's reads, drag on held lists
- `react-aria` (`.claude/skills/react-aria/`): `UNSAFE_PortalProvider`, Modal, Popover
- `tanstack-virtual` (`.claude/skills/tanstack-virtual/`): drag in virtualised lists
- `transitions-polish` (`.claude/skills/transitions-polish/`): the panel's and the drag's motion tokens
- `security-and-hardening` (`.claude/skills/security-and-hardening/`): the address gate, publish permissions

## Feature design

### Item 1: one drag wrapper (batch 6)

| | |
|---|---|
| Exists | `packages/ui/src/lib/drag/drag.tsx` (DragArea, SortableList, SortableGroup, useSortableItem, SortableRowGrip, useDropZone, useDragTarget, listWords) and `plane.tsx` (PlaneArea, usePlaneItem). Pointer after a few pixels, keyboard on a grip with the focus holder, announcements, auto scroll, reduced motion, the board's items first collision. Only this folder imports dnd-kit (lint). 17 files call it |
| Prototype adds | One lift look (`.tf-drag-lift`: `surface`, `shadow-md`, scale 1.02), the dashed gap where it lands, a settle on drop (`data-settling`), shifts on `ease-smooth-out`, live cross group order while moving (`live` groups), `kindOf` (rows land only among their kind), and zoom measuring |
| Not taken | Zoom measuring (phase 0 removed zoom). Scale 1.02 on the lift (the house rule keeps press and lift scale at 1, spec 0071) |
| Change | The wrapper owns the lift: `data-dragging` and `data-settling` set as today, plus one shared stylesheet beside the wrapper drawing the lift, the gap and the settle for any element the wrapper marks; `kindOf` on DragArea; shifts move to `ease-smooth-out`; place lookups through a map built at lift |
| Touches | Table, Sidebar, ViewSettings, SortBuilder, KanbanColumn, RulesEditor, SectionList, OptionsEditor, LinkList, GridHeaderCell (each loses its own lift rules); screens: the board, the sidebar, view settings, sort and filter builders, rules, sections (menus, forms), options, link list, grid columns, week calendar |
| Why last | Every module it touches is phase 1's to restyle; it lands after phase 1 merges, so the two never fight over the same lines |

### Item 2: guest looks on popups (batch 4)

| | |
|---|---|
| Exists | `GuestLook` (`modules/GuestLook/`) and `MenuList` wrap their page in `UNSAFE_PortalProvider` whose container is a div inside the themed root, so every React Aria overlay opened inside portals there and inherits the page's tokens. The menu, business and reservation pages use it |
| Gap | The hosted form (`public-form` FormGround: theme, corners, template and page variables on its root), the link page (`LinkPage` root: theme, font, shape, ground, fill, hue, template), the booking page and the manage page (`BookingFrame`: template and Night or Studio theme) portal popups to `document.body`, so Select, the phone country picker, the gated link notice, the gallery viewer, Tooltips, the visitor bar's menu, add to calendar, Share and the change Modals open in the app's light theme |
| Prototype | `LookContext` re-applies the look's `data-theme` and style on each Popover and Dialog root. It misses Drawer and Tooltip |
| Change | Not LookContext: the real app's portal host is the better mechanism (CSS variables and `data-*` selectors cascade into the popup with no copying, and every overlay, Tooltip and sheet included, follows). One small library helper, `PopupHost` (the PortalProvider plus its host div, from GuestLook), used by GuestLook, MenuList, FormGround, LinkPage and BookingFrame; its host div also sets `--size-topbar: var(--size-bar)` (AC-7426, the coordinator's note of 12 Nov: phase 0's legacy `size-bar` is what the guest pages' bars use) |
| Touches | `packages/ui`: GuestLook, MenuList, public-form FormParts, LinkPage, public-booking BookingFrame. `apps/web`: none (the pages already render those roots). Budgets: JavaScript only, no CSS, on `book.html` and `form.html` |

### Item 3: PublishBar and ShareSheet everywhere (batches 1 to 3)

Share surfaces today, and what each becomes:

| Screen | Today | Becomes | Batch |
|---|---|---|---|
| Forms, after the first publish | `ReadyDialog` (`forms/PublishDialog.tsx`): Modal around `ShareBlock` (ReadyPanel `share`), footer filing line | ShareSheet: title "<form> is live", `embedHref` to the Share tab, `footer` the filing line with Change | 1 |
| Forms › Share tab and booking page › Share tab, link row | `ShareBlock` inline (the booking page imported the forms' one) | `ShareColumn`; `ShareBlock.tsx` deleted | 1 |
| Link page › Share | `ShareLinkPageModal`: Modal, QrCode `fill` in the saved style, Callout when private, Field `copy`, More row, Open page and Download in the footer | ShareSheet with `qrStyle`; workspace line as `description`; Open page, Links for each place, Style the code and Add to Wallet in `extra`; private: the private line and Turn on Live in `footer`; loaded apart (`features/share`) | 1 |
| Link page › overview card, Download | `qrPng` and `saveFile` from `qr-png.ts` | `downloadQr` | 1 |
| Menus › Publish, then live; Show QR code | `PublishDialog` live stage: Callout with the link and CopyButton, QrCode `md`, Open guest menu, Done | ShareSheet ("Your menu is live" after a publish, "Share your menu" from Share), Open guest menu in `extra` | 1 |
| Insights, team pages, Menu QR, Table drawer | Import `saveFile`, `qrPng`, `qrSvg` from `qr-png.ts` | Import them from `@crm/ui` | 1 |
| Booking pages (editor header, Links cards) | Copy link, the Share tab's link card | Copy link stays; Share opens ShareSheet with Offer specific times, One time link, Add to link page, `embedHref` | 2 |
| Workspace link (TeamLinksMenu), team pages, business page | Copy link in a menu or field | Share opens ShareSheet; copy stays | 2 |
| Forms, menus, business page editors | `EditorStatus` plus their own Publish buttons and split | PublishBar; first publish opens ShareSheet | 3 |
| Booking page editor | Save changes (save and publish in one, owner 9 Nov) | PublishBar in its one step form | 3 |

Kept as they are (not share dialogs): Insights' named, revocable share links (their own dialog); InviteDialog (inviting people); the Menu QR print sheet; ShareTimesCard and OneOffLinksCard (they make a link, then copy it); every one press CopyButton.

### Item 4: the record panel floating at full height (batch 5)

| | |
|---|---|
| Exists | `RecordPanel` on `Panel variant="floating"` (`position: fixed`, inset `space-8` from the window on every side, over the top bar, `radius-xl`, `shadow-lg`, width `size-panel-wide` from RecordPeek's `width="lg"`); ↑ and ↓ step; Esc closes; tabs, stats, states. RecordPeek (`apps/web/src/features/records/RecordPeek.tsx`) calls `openPeek`, which awaits the objects, access, the record and every section's read, then draws; until then it draws nothing |
| Prototype | Floats over the records area (below the top bar, the content's padding as its inset), full height of that area, `size-panel`, `radius-lg`, `shadow-lg`, enters from the side over `duration-slow`, leaves over `duration-medium`; "n of N" with Previous, Next, Open full page and Close; J and K; a foot hint |
| Change | Panel's floating variant takes the content area's box from AppShell (as custom properties if AppShell can set them, so nothing measures in script; batch 5 checks AppShell first); RecordPeek draws from `useRecord` at once and gives each section its own status; the head gains "n of N" and J and K |
| Touches | `packages/ui`: Panel (floating offsets, motion tokens), RecordPanel (head, keys, foot), AppShell (the content box). `apps/web`: RecordPeek, peek.ts, RecordsScreen and BoardScreen (they pass the place and the total) |

### Batches

1. **ShareSheet behind every share dialog that exists** (this lane): AC-7401 to AC-7405, AC-7417 to AC-7421, AC-7423. Smallest risk: the part exists and three hand made dialogs go.
2. **A Share button where there is none**: AC-7406, with the same gates.
3. **PublishBar on every editor**: AC-7407, AC-7408; each editor's change list read from the data it already holds.
4. **Guest looks on popups**: AC-7409, AC-7410, AC-7426.
5. **The record panel**: AC-7411 to AC-7413, AC-7425.
6. **The drag wrapper**, after phase 1 merges: AC-7414 to AC-7416, AC-7422, AC-7424.

### Behaviour that must survive batch 1 (checked in its tests)

- Forms: "<form> is live" as the dialog's name; Copy link the one primary; Done focused on open; Email, WhatsApp, More; Download PNG or SVG with a toast on failure; Put it on your site to the Share tab, closing the dialog; the filing line with Change on one line; the dialog keeps the form while it plays its exit.
- Forms › Share tab: the same link row, with no dialog chrome.
- Link page: everything in AC-7404; Share offered only while the page is Live; one dialog at a time (Links for each place and Style the code close Share before they open).
- Menus: the review stage and its checks unchanged; Publish refused says why; Open guest menu; Done; the split button's Open in new tab.

### Where the batch 1 code lives

| Path | Owns |
|---|---|
| `packages/ui/src/modules/ShareSheet/` | `qrStyle`, `ShareColumn` (the sheet's body for a Share tab), their README sections and stories (`Styled`, `Column`, `ColumnRefused`) |
| `packages/ui/src/modules/ReadyPanel/` | `qrStyle` for the `share` column's code |
| `apps/web/src/features/forms/PublishDialog.tsx` | ReadyDialog on ShareSheet |
| `apps/web/src/features/forms/ShareTab.tsx`, `booking/PageEditor.tsx` | the link row on ShareColumn; `ShareBlock.tsx` deleted |
| `apps/web/src/features/share/` | `lazyShareSheet(load)`: the sheet loaded apart for the link page and Menus, mounted once first opened, preloaded when idle |
| `apps/web/src/features/link-page/LinkPageScreen.tsx` | Share on ShareSheet; `ShareLinkPageModal.tsx` deleted |
| `apps/web/src/features/menus/PublishDialog.tsx`, `MenusScreen.tsx` | the review Modal and ShareSheet side by side (one exits as the other enters), Share in the split's menu, the sheet preloaded when the screen is idle |
| `apps/web/src/features/link-page/qr-png.ts` | deleted; its importers use `@crm/ui` |

### Batch 1 as built

- **ShareColumn instead of ReadyPanel directly** (AC-7402): a Share tab composing ReadyPanel would have repeated the address gate (`shareableUrl` is not exported), the download and its failure toast and the words, which is what `ShareBlock` was. The booking page's Share tab used the forms' `ShareBlock` too (it said "QR code for the form's link" on a booking page); both tabs now draw ShareColumn and name the code after the thing.
- **Loaded apart** (AC-7419): drawn statically, ShareSheet grew the link page route by 2.4 kB of JavaScript and 1.5 kB of CSS and the menus route by 3.5 kB and 1.5 kB. Loaded apart (`features/share`, the screen passing its own `import()` so it joins the route's existing preload list), the link page route grows 0.3 kB of JavaScript and no CSS, and the menus route shrinks 4.4 kB and 0.4 kB. The forms and booking editors draw ShareColumn on their Share tab, so they load it statically.
- **Menus**: the review Modal and the sheet are mounted side by side (`isOpen` by stage), so after a publish one exits as the other enters with no frame of bare page between them; with no place, a publish says it in a toast and the dialog closes; a place gone while the sheet is open closes it.
- **Link page**: "Private. Only you can open it. · Turn on Live" sits in the sheet's footer (the forms' "Answers go to People · Change" pattern), not in the row of ways to share; the Wallet pass is offered only for an `https:` address.
- **Names**: the link page's code saves as `<handle>-qr.png` (was `<handle>-link-page.png`), from the sheet and the overview card alike; the email subject is `@handle`.

Measurements (gzip; the route lines are each route component's static closure past the first load):

| Line | Before (48d2373ad) | After batch 1 | Change |
|---|---|---|---|
| First load JavaScript | 296.61 kB | 296.63 kB | +20 B (no first load module changed; the entry's map of lazy chunk names, within the ±20 B allowance) |
| First load CSS, hosted form JS and CSS, booking page JS and CSS, the lazy form and booking chunks | 7.86, 205.9, 18.57, 188.89, 19.37 kB; 5.74, 6.25, 1.14, 1.67, 1.37 kB, 463 B | the same | 0 |
| Link page route (`w.$slug.link-page`) | 466,946 B JS, 62,600 B CSS | 467,265, 62,600 | +319 B JS |
| Link page in a partner's frame (`embed.$clientId.link-page`) | 462,450, 60,868 | 462,774, 60,868 | +324 B JS |
| Profile settings (draws the link page loader) | 471,712, 63,760 | 472,036, 63,760 | +324 B JS |
| Menus (`w.$slug.menus`) | 331,543, 50,544 | 327,115, 50,119 | −4,428 B JS, −425 B CSS |
| Form editor (`captures_.forms.$formId`) | 485,242, 59,266 | 486,098, 59,671 | +856 B JS, +405 B CSS |
| Booking page editor (`captures_.links.$pageId`) | 448,947, 58,471 | 449,847, 58,876 | +900 B JS, +405 B CSS |
| Insights; Menu QR and its print sheet | 297,196; 248,063; 246,679 | 297,303; 248,124; 246,739 | +107, +61, +60 B JS (the QR helpers now come from `@crm/ui`'s chunk) |

The form and booking editors grow because ShareColumn draws a refused address with Callout (the address gate the old `ShareBlock` lacked) and its chunk carries ShareSheet; no route lost any behaviour for it.

The share code itself (source, gzip -9, files wholly about sharing plus the share blocks inside mixed files): 6,343 B before (`ShareBlock.tsx`, the forms `PublishDialog.tsx`, `ShareLinkPageModal.tsx`, `share-strings.ts`, `qr-png.ts`, the menus live stage, the link page's call site), 4,712 B after (the forms `PublishDialog.tsx`, `share-strings.ts`, `features/share/`, the menus sheet and its wiring, the link page's call site): **25.7% less, short of the 30% target** (AC-7418). Raw, 14,258 to 10,407 B (27% less). The difference is the lazy loader (978 B) and the review's fixes (the side by side dialogs, the stranded close, the footer); without the loader the share code would be about 40% less, but the link page and menus routes would carry 2.4 and 3.5 kB more. The load gate's route numbers were weighed as the stronger of the two.

### Batch 1's open items, decided (coordinator, 13 November 2026, accepted)

- **Download is one press again** (AC-7428): ReadyPanel's `share` column draws Download as a SplitButton, Download PNG on its main half and Download SVG in its menu, so the link page's one press PNG is back and the SVG is still there. The owner's rule is "simple, familiar, foolproof", and two presses for a download was a regression.
- **The QR code's size** (AC-7427): the link page keeps its large code, because it is scanned from a screen. ReadyPanel is phase 1's file, so no size option is added now; it is owed at the phase 1 merge: "ReadyPanel/ShareSheet `qrSize` option; the link page uses the large size".
- **The 30% share code target** (AC-7418, amended): under the owner's rule (measure per phase, on real pages) batch 1 is accepted, since no first load grew and Menus dropped 4.4 kB. The share code is measured again at the phase's end.
- **Closing mid download** (AC-7428): fixed. ShareColumn tells the sheet while a file is being made; the sheet is busy (Esc, a click outside and Close wait) and a Done pressed meanwhile closes it as soon as the file is saved.
- **Focus after a menu's first publish** (AC-7428): fixed. When the publish dialog closes and focus has fallen to the page, Menus hands it to Publish or, once live, to the split button's main half (found beside its named menu half: a `ref` on SplitButton's halves grew the hosted form and booking page by 40 B, since they share Button's chunk, so it was taken back).
- **A failed chunk load** reaches the app's `vite:preloadError` guard, as Bookings' lazy parts do (unchanged).
- Screenshots for `Styled`, `Column` and the rest of ShareSheet's stories need `pnpm test:visual --update` in the pinned image (unchanged).

## Build plan

1. ShareSheet and ReadyPanel `qrStyle`, with a story, satisfies **AC-7403**
2. Forms: ReadyDialog on ShareSheet, the forms' and booking page's Share tabs on ShareColumn, `ShareBlock.tsx` deleted, satisfies **AC-7401**, **AC-7402**
3. Link page: Share on ShareSheet, the overview's Download on `downloadQr`, `ShareLinkPageModal.tsx` deleted, satisfies **AC-7401**, **AC-7404**
4. Menus: the live stage and Share on ShareSheet, satisfies **AC-7401**, **AC-7405**
5. `qr-png.ts` deleted, its importers on `@crm/ui`, satisfies **AC-7402**
6. Browser tests per screen, the gates measured, the reviewers, satisfies **AC-7417** to **AC-7421**, **AC-7423**
7. Batches 2 to 6 as listed, each with its own measurement and reviewers

## Consequences

- Three hand made share dialogs and one re-export file go; every share looks and behaves the same.
- The link page's Share draws its code at the ShareSheet's size (`sm` on a light tile, the prototype's) instead of filling the dialog; the overview card keeps its own code and Download for printing.
- Batch 6 waits on phase 1. Until then each module keeps its own lift look.

## Follow-up

- Screenshots for ShareSheet with `qrStyle` need `pnpm test:visual --update` in the pinned image (no Docker on the shared laptop in this lane).
- Spec 0073's other owed items (one bubble part, one reading pace, the SearchField dissolve and NumberField digit pop) are not phase 3's shared behaviour as the handover lists it; they stay with the phases named in 0073.
