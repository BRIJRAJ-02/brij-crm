# 0074 rationale: port phase 3, shared behaviour

## Context

The handover's phase 3 names four behaviours the prototype keeps in `src/lib/` and a few shared parts: one drag wrapper (`lib/drag.ts`), guest looks on popups (`lib/look.ts`), PublishBar and ShareSheet everywhere, and the record panel floating at full height. The owner asked on 11 November for "one publish system everywhere (PublishBar on every editor incl. menus and business page, one status tag set, one ShareSheet dialog for every Share)" (`parity-gaps.md`, line 101), and spec 0073 left five share swaps owed to this phase.

Three facts shaped every call:
- **The real app already has most of each behaviour.** The drag wrapper is richer than the prototype's in the parts that matter most (the keyboard holder outside grids, the board's collision, the plane for the week); popups on the menu, business and reservation pages already wear the page's look through a portal host; ShareSheet, ReadyPanel and PublishBar exist; the record panel already floats. What is missing is the last step on each screen, which every screen does its own way.
- **Phase 1 is restyling the 72 shared parts at the same time.** Ten of the modules the drag look touches (Table, Sidebar, SortBuilder, ViewSettings, KanbanColumn, RulesEditor, SectionList, OptionsEditor, LinkList, GridHeaderCell) are its files.
- **The owner's rule: no functionality may be lost.** Each swap lists the behaviours the old screen code had and its tests keep them.

## Options considered

### Option 1: Port `lib/*` as the prototype has it

Add `LookContext`, the prototype's `DragArea` and `DragList` API, and its RecordPanel, beside the real ones, and move screens onto them.

- **Pros**: the later phases copy the prototype's JSX unchanged.
- **Cons**: two drag APIs, two look mechanisms and two record panels until a cleanup. The prototype's drag lacks the real one's keyboard holder (arrows inside a React Aria grid move focus instead of the item) and its LookContext misses Tooltip and Drawer. Phase 1's files change twice.

### Option 2: Map each behaviour onto the real part, add only small props, batch by risk (chosen)

Keep the real mechanisms, close each gap against the prototype as an additive prop or a small helper, and order the work so the least risky, most deleting batch goes first and the batch that touches phase 1's files goes after phase 1 lands.

- **Pros**: no second mechanism; old screen code is deleted as each part takes over; phase 1 and phase 3 never edit the same lines.
- **Cons**: later phases translate a few prototype names (DragList is SortableList, LookContext is the portal host). The mapping tables say which.

### Option 3: Do all four in one batch

- **Pros**: one review, one landing.
- **Cons**: one change across about forty files in two packages, half of them phase 1's; the reviewers cannot hold it, and a regression has nowhere to hide but everywhere. The laptop budget allows one build lane.

## Rationale

Option 2 is the house order (reuse, then variant, then new) applied to behaviour. Each behaviour already has one real home; the gap is that screens finish the job themselves. Putting the last step into that home deletes screen code (the load gate's 30%) and makes the next screen cheaper. Batches go smallest risk and largest deletion first: ShareSheet exists, three dialogs go, nothing in phase 1's files moves.

## Calls, and the picks

1. **Batch order.** Share swaps first (parts exist, code deletes), then the Share buttons that don't exist yet, then PublishBar (needs each editor's change list), then popups, the record panel, and drag last (phase 1's files). Industry practice for a migration: replace the most duplicated thing first, the thing that touches someone else's work last.
2. **The link page's Share on ShareSheet.** Its modal had more than ShareSheet: the code in the owner's saved style, the code filling the dialog, the private line with Turn on Live, the workspace line, and five more ways. Picks: `qrStyle` on ShareSheet and ReadyPanel (additive, the only way to keep AC-6124's styled code); the workspace line as ShareSheet's `description` (its job: one quiet line); Open page, Links for each place, Style the code and Add to Wallet in `extra`; while private, the private line as `description` and Turn on Live in `extra` (the old Callout said the same and offered the same button). The code's size goes from `fill` to ShareSheet's `sm` on its light tile, as the prototype draws it; the overview card keeps its own code and Download for printing, so nothing is lost. The share name is `@handle` (subject "@priya", file "priya-qr.png"): the handle is how Linktree and Instagram name a page, and it keeps one name across the subject, the QR label and the file.
3. **The forms' Share tab.** ShareSheet is a dialog; the tab shows the same column inline. Pick ReadyPanel `share` directly with `downloadQr`: ShareBlock was that and a download wrapper, and `downloadQr` is the wrapper now.
4. **The menu's "Show QR code".** It opened the live stage, which is now ShareSheet, whose first thing is the code. Pick "Share" with the share icon, the word every other screen uses for the same sheet (Calendly, Linktree, Notion all say Share). The title says "Share your menu" from Share and "Your menu is live" after a publish, as the prototype does. With no place to link to, a publish says it in a toast and Share is not offered, rather than drawing a sheet with nothing to share.
5. **The menu's live line.** "Guests open it from this link or by scanning the code" goes: the title says it is live and a QR code explains itself (the owner, 1 November 2026, on the telling off under codes). Less text.
6. **Copy link buttons stay.** Spec 0073 listed "the booking and menu Copy link buttons" as moving onto ShareSheet. The owner said on 5 November that the address copies in one press, as Linktree's does; moving it behind a dialog would add a press. Pick: Share opens ShareSheet beside the one press copy (batch 2); nothing that copies today stops copying.
7. **Booking pages and PublishBar.** The owner decided on 9 November that booking pages save and publish in one step, with no draft waiting (Calendly); on 11 November asked for PublishBar on every editor. Both hold if the booking editor draws PublishBar in its one step form: Publish saves and publishes at once, Versions stays, Discard is leaving without saving. Batch 3 builds it.
8. **Guest looks: portal host, not LookContext.** The prototype copies the look's theme and style onto each popup root and clears its background. The real app's `UNSAFE_PortalProvider` host inside the themed root lets the whole cascade reach the popup, including `data-template` and `data-page-*` selectors a style copy cannot carry, and it covers Tooltip and Drawer, which the prototype's misses. A popup inside the root still sits on top (React Aria overlays are `position: fixed` with the modal z-index), as GuestLook has shown on three pages since spec 0065.
9. **The record panel's box.** The prototype puts it inside the records area; the real one sits over the window with a `space-8` inset. Pick the prototype's: the top bar and the view's tabs stay readable and clickable while the panel is open, and it lines up with the content's own edges. Its width moves from `size-panel-wide` to `size-panel` (the prototype's).
10. **The record panel's reads.** `openPeek` waits for every read before drawing anything. Pick per section status: the record from the store at once, each section with its Skeleton until its read lands (crm-frontend-state: show held data first, never wait on the slowest read).
11. **The lift's scale.** The prototype lifts at 1.02. The house rule (spec 0071) keeps `--scale-press` at 1 and allows no scale on press; a lift is the same gesture, so it gets the shadow and the gap, not the scale.
12. **The drag look's home.** Ten modules each carry their own `[data-dragging]` rules. Pick one stylesheet beside the wrapper, in `@layer components` with `:where()` so a module can still override, drawing the lift, the gap and the settle for whatever the wrapper marks. It deletes those rules from the ten modules, which is why it waits for phase 1.
13. **The load gate's "beyond noise".** Content hashes change when any lazy chunk's name changes, and the entry carries the map of names; batch measurements in 0073 moved the first load 50 to 80 bytes either way with no first load module changing. Pick ±20 bytes as the brief asks, and say plainly in the batch where a line moved and why.

## Evidence

### Share code before batch 1 (source, gzip -9)

| File | Raw | Gzipped |
|---|---|---|
| `forms/ShareBlock.tsx` | 2,249 B | 1,096 B |
| `forms/PublishDialog.tsx` | 3,655 B | 1,623 B |
| `link-page/ShareLinkPageModal.tsx` | 5,323 B | 2,107 B |
| `link-page/share-strings.ts` | 912 B | 539 B |
| `link-page/qr-png.ts` | 355 B | 277 B |
| `menus/PublishDialog.tsx` | 6,291 B | 2,104 B |

### `pnpm size` before batch 1 (48d2373ad)

First load JavaScript 296.61 kB, first load CSS 7.86 kB, hosted form JavaScript 205.9 kB, hosted form CSS 18.57 kB, form step layouts 5.74 kB, signature and ranking 6.25 kB, booking page JavaScript 188.89 kB, booking page CSS 19.37 kB, media 1.14 kB, picture and gallery 1.67 kB, next times 1.37 kB, notice sheet 463 B.

### Publish and share permissions read for gate 2

`packages/core/src/access/table.ts`: `publishForm` and `setFormStatus` need `forms.manage`; `publishMenus`, `discardMenuDraft` and `setMenuHidden` need `hospitality.manage`; `publishBusinessPage` needs `hospitality.manage`; `publishLinkPage`, `discardLinkDraft`, `listLinkPageVersions` and `restoreLinkPageVersion` take only the caller's own link page (`ownLinkPage`); `showMyLinkPage` (Live or Private) is the member's own page; `publishBookingPage`, `discardBookingPageDraft` and the versions take the page's own door (`bookingPages`); `publishBrandTemplate` needs `workspace.manage`. Batch 1 calls none of these differently: it changes only what draws after a publish and the share dialogs, which make no request.

## References

- Prototype: `design/timefix-design-system/src/lib/drag.ts`, `lib/look.ts`, `components/ShareSheet/`, `components/PublishBar/`, `components/RecordPanel/`, `components/TimefixApp/TimefixApp.css` (the panel's dock), `components/DragHandle/DragHandle.css` (the lift, gap and settle).
- `design/timefix-design-system/parity-gaps.md` lines 86, 101, 105, 141; `app-flows.md` lines 72, 73, 112, 116.
- React Aria `UNSAFE_PortalProvider` (react-aria 3.52.1, already used by GuestLook and MenuList).
