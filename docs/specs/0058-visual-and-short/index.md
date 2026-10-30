# 0058. Visual and short: links, booking and forms

**Date**: 2026-10-31
**Status**: Proposed

## Summary

The pages where people make booking links, forms and link pages are full of sentences, and the popups are the worst. This spec swaps explaining text for things you can see and tap: tiles, thumbnails, previews and chips. It also adds a clear "done, here is your link" moment after you create something. Everything lines up on one grid, moves with the same few smooth, basic animations, and stays easy to understand while looking world class. It changes how things look and feel only. No new behaviour, no new addresses.

## Requirements

**User stories**:
- As a new owner, I want to see my booking link and link page the moment they exist, so I can copy and share them without hunting.
- As a form builder, I want publishing to take one click for a normal form, so I do not read paragraphs about matching and uniqueness.
- As a link page owner, I want to pick a block kind or a look by seeing it, not by reading a list of words.
- As a visitor who just booked or submitted, I want a short summary and one clear next step.
- As anyone using these screens, I want everything aligned and the motion smooth, so it feels calm and finished.

**Acceptance criteria** (each is checkable; "alignment" and "motion" are defined in Feature design):

Alignment and quality (apply to every screen and popup this spec touches):
- **AC-1**: Alignment. Every touched screen and popup passes the alignment rules (one spacing scale from tokens, shared left edges, aligned label and input baselines, equal tile sizes, centred empty states, no off grid values), checked in light and dark inside the real layout with popovers open.
- **AC-2**: Motion. Interactions use only the basic motion set (press, hover, enter and exit of popups, tile select, a short success check). Only transform and opacity animate, durations and easing come from the existing tokens, nothing blocks input, and reduced motion turns every animation into an instant change.
- **AC-3**: Less text. Each touched popup and empty state has at most one short heading, one short line of help, and its controls. Any explaining sentence that remains is one line (under 12 words) or sits in a hint or tooltip. A paragraph of copy fails.
- **AC-4**: Accessibility holds. Every new tile, grid, drawer and success panel is fully keyboard usable, has a visible focus ring, a name a screen reader can read, and meets WCAG AA contrast.

Success and first moments:
- **AC-5**: After "New booking page" is created, the user sees a Ready panel with the link, Copy, Share, a QR code and a small live preview of the visitor page. The editor opens behind it and the panel can be dismissed in one action.
- **AC-6**: After a form's first publish, the same Ready panel shows the form link, Copy, Share and QR, and the three embed choices as tiles. No code is shown by default.
- **AC-7**: The first run Done step shows two tiles, the booking link and the link page link, each with Copy and Open. No step is added or removed.
- **AC-8**: Links, Forms and Link page each show an illustrated empty state with one primary action. The link page with no handle offers an inline handle field and never sends the user to Profile.

Visual pickers:
- **AC-9**: The Add block popup shows an icon grid of block kinds with a short name each. A description appears only as a tooltip.
- **AC-10**: Appearance presets show as thumbnails of the real look, with the name under the thumbnail. The chosen one is clear without reading.
- **AC-11**: The form Install tab shows inline, popup and corner button as three tiles with a small picture each. Developer material (own HTML, allowed sites, signed posts, secret) sits behind one "For developers" disclosure, closed by default.

Popup diet:
- **AC-12**: Rotation group: Fair is the default, advanced fields are hidden behind one disclosure, and the member table opens in a drawer, not inside the popup.
- **AC-13**: Form publish is one step for a normal form. Answers auto match to fields and show as a question to field table with chips. The unique email rule is one line.
- **AC-14**: Sync earlier submissions shows a count preview and one button, with "Only unfiled" selected by default.
- **AC-15**: Time off drops its hint lines and shows affected meetings as a count with a link to the list.
- **AC-16**: Import links shows a preview list with a count. The seven service names are one hint line.
- **AC-17**: New booking page asks for a name and a length. It uses the default schedule, and choosing another schedule moves to the editor.
- **AC-18**: Every delete, remove and rotate confirm stays a Modal (owner rule, 21 Oct) with a one line message and two buttons. None is replaced by an undo toast.

Visitor side look:
- **AC-19**: The form thanks screen shows a summary of what was sent and one next step. The booking manage page leads with a summary card (what, when, who) and the primary action. Both add no new data fields, requests or origins.

Delight (these pages are client facing, so the first impression is the product):
- **AC-21**: Small, tasteful moments of delight, all inside the basic motion set. Copy shows a quick "Copied" confirmation with a tick. The Ready panel and Done tiles ease in. A newly created page or form gets one short success check. Confirmation screens (booked, sent) feel warm and finished, with a friendly short line, never a wall of text. Nothing loops, nothing delays the user, and reduced motion removes the movement but keeps the message.

Marketing:
- **AC-22**: The Timefix marketing site (`apps/marketing`) shows the new look. Its booking, forms and link page screens are retaken from the updated app (light and dark, 3840 by 2400 as today), and the All features sheet and tab copy are corrected to match what shipped. The site follows its owner rules (no pricing, no blue gradient, Host Grotesk headline, one primary per view) and ships on its own, apart from the CRM push.

Safety rails:
- **AC-20**: Nothing changes in behaviour or addresses. `/b/:key`, `/f/:key` and `/<handle>` keep their routes, requests and behaviour, the Content Security Policy gains no origin, and existing tests still pass.

## Decision

**Chosen option**: Option 2: Visual rewrite of the touched surfaces on shared library pieces, in parallel lanes.

Replace text with visuals using the library we already have (TileGrid, EmptyState, Disclosure, Modal, QrCode, Skeleton, ChoiceChips), add only what is missing as library variants first, and split the work into lanes that own separate files.

**Implementation skills**: `crm-design-system` (`.claude/skills/crm-design-system/`) · `interaction-design` (`.claude/skills/interaction-design/`) · `emil-design-eng` (`.claude/skills/emil-design-eng/`) · `interface-affordances` (`.claude/skills/interface-affordances/`) · `subtractive-design` (`.claude/skills/subtractive-design/`) · `humane-functionalism` (`.claude/skills/humane-functionalism/`) · `design-engineering` (`.claude/skills/design-engineering/`) · `ux-heuristics` (`.claude/skills/ux-heuristics/`) · `impeccable` (`.claude/skills/impeccable/`)

## Feature design

**Alignment rules** (what AC-1 means, checked by the probe in `verify.md`):
- Spacing uses only the token scale. No raw pixel values.
- Inside one card, popup or panel, every label, input, tile and button shares one left edge and one right edge.
- Labels sit on a shared baseline with their input in a row. Buttons in a row share one height and one baseline.
- Tiles in a grid are one size. Rows of chips wrap on the same gap.
- Popups use one padding, one header height and one footer layout (primary button right, secondary left of it).
- Empty states are centred on both axes of their container, with the icon, heading, line and button on one centre line.
- Dark and light both pass, with a popover or menu open on top.

**Motion rules** (what AC-2 means):
- Basic set only: press (scale to 0.98), hover (colour or lift), popup and drawer enter and exit (fade plus small slide), tile select (ring and a tick), success check (one short draw).
- Durations and easing come from `--duration-press`, `--duration-hover`, `--duration-modal`, `--duration-popover`, `--duration-move`, `--ease-out` and `--ease-in-out`. No new tokens and no raw milliseconds.
- Only `transform` and `opacity` animate. No layout animation.
- Interruptible: a second click or Escape during an animation never waits for it.
- No motion on the first paint of public pages, and no looping decoration. `prefers-reduced-motion` makes every change instant.

**Library additions (Lane 0, lands first).** Reuse, then variant, then new, as the design system rule says:
| Piece | How | Notes |
|---|---|---|
| `TileGrid` | variant `choice` | Equal size tiles with an icon or thumbnail slot, a name, a selected ring and tick. Used by the block kind grid, preset thumbnails and embed tiles. |
| `EmptyState` | variant with an illustration slot | One heading, one line, one primary action, centred. |
| `ReadyPanel` | new module in `packages/ui/src/modules/ReadyPanel/` | Link field, Copy, Share, QR (`QrCode` atom) and a preview slot. Needs a spec reviewer pass because no module does this today. |
| `Disclosure` | reuse | For developers, advanced rotation fields. |
| `Modal` | reuse | One padding and footer layout for every popup. A drawer variant if none exists. |

**Lanes** (each owns its files and touches nothing else; lane branches never edit `docs/specs/`):
| Lane | Owns | Delivers |
|---|---|---|
| 0 Library | `packages/ui/src/molecules/TileGrid`, `EmptyState`, `Modal` (drawer variant if needed), `packages/ui/src/modules/ReadyPanel`, their stories and tests, `packages/ui/README` entries | AC-1, AC-2, AC-4 for new pieces. Lands first so other lanes use real props. |
| A Booking | `apps/web/src/features/booking/{NewPageDialog,RotationDialog,RotationsScreen,TimeOffDialog,NewScheduleDialog,RenameScheduleDialog,DeleteScheduleDialog,DeletePageDialog,LinksScreen,PageEditor}.tsx` and their `*strings.ts` files | AC-5, 8 (Links empty), 12, 15, 17, 18 |
| B Forms | `apps/web/src/features/forms/{PublishDialog,SyncDialog,FormConfirms,InstallTab,FormsScreen,FormEditor}.tsx`, `forms/strings.ts` | AC-6, 8 (Forms empty), 11, 13, 14, 18 |
| C Link page and first run | `apps/web/src/features/link-page/{registry,AppearanceCard,ImportLinksModal,LinkPageLoader,LinkPagePending,LinkPageHomeCard,SharingCard,ShareLinkPageModal}.tsx`, its strings, `apps/web/src/features/welcome/{DoneStep}.tsx` and `welcome/strings.ts` | AC-7, 8 (link page), 9, 10, 16, 18 |
| D Visitor side | `apps/web/src/public/booking/ManagePage.tsx`, `packages/ui/src/modules/{BookingReceipt,BookingChanges}`, `packages/ui/src/public-form/{HostedForm,HostedFormSteps,FormParts}.tsx` and CSS | AC-19, 20, 21 |
| M Marketing | `apps/marketing/` only (its screens in `public/shots/`, the tabs and the All features sheet copy). Starts after lanes A to D land. Uses the marketing README rules and the demo workspace reseed. | AC-22 |

Each lane also owns the matching `*.browser.test.tsx` files and the Storybook stories of what it changes. Strings stay in the existing `*strings.ts` files. A lane that needs a library change asks Lane 0, it does not edit the library itself.

**Data model**: none. No schema, no migration, no API change, no new env var.

**Value sourcing**:
| Action | Value displayed | Source |
|---|---|---|
| Ready panel (booking) | the link and preview | the created page's existing `key` and public address helper in `features/booking/links.ts` |
| Ready panel (form) | the link and embed tiles | the published form's existing address and `snippets.ts` |
| Done step tiles | booking link, link page link | existing draft state in `welcome/draft.ts` and the same address helpers |
| Sync count | number of earlier submissions to file | the existing sync preview result already used by `SyncDialog` |
| Time off count | meetings affected | the existing step 2 result of `TimeOffDialog` |
| Form thanks summary | what the visitor sent | the answers already held by the hosted form on the page |
| Manage summary | what, when, who | the booking data `ManagePage` already loads |

**Key invariants**:
- No new network call, route, origin or stored field.
- Every confirm for deleting or removing stays a Modal.
- Copy lives in strings files, never inline.

**Security model**: unchanged. No new data is shown to a visitor that the page does not already load.

**Critical test scenarios**:
- Happy path: create a booking page, see the Ready panel with a working Copy, verifies **AC-5**.
- Happy path: first publish of a form shows the Ready panel and three embed tiles, verifies **AC-6, AC-11**.
- Failure case: tab through a tile grid with the keyboard and pick with Enter, verifies **AC-4**.
- Failure case: reduced motion on, every animation is an instant change, verifies **AC-2**.
- Regression: existing booking, form and link page flows (`booking-journey`, `form-to-booking`) still pass, verifies **AC-20**.
- Alignment probe passes in light and dark for every touched screen, verifies **AC-1**.

## Build plan

Approach: Tracer Bullet. Lane 0 and one thin thread (booking Ready panel) go first, then the other lanes thicken in parallel.

1. Lane 0: add `TileGrid` choice variant, `EmptyState` illustration slot, drawer variant if missing, and `ReadyPanel`, with stories, tests and the alignment probe helper, satisfies **AC-1, AC-2, AC-4**
2. Lane A thin thread: Ready panel after New booking page, wired to existing link helpers, satisfies **AC-5**
3. Lane A: NewPageDialog, RotationDialog and drawer, TimeOffDialog, schedule dialogs, Links empty state, one line confirms, satisfies **AC-3, AC-8, AC-12, AC-15, AC-17, AC-18**
4. Lane B: merge PublishDialog to one step with the mapping table, SyncDialog preview, Install tiles and For developers disclosure, Ready panel on first publish, Forms empty state, one line confirms, satisfies **AC-3, AC-6, AC-8, AC-11, AC-13, AC-14, AC-18**
5. Lane C: block kind grid, preset thumbnails, import preview, inline handle field, Done step tiles, link page empty state, one line confirms, satisfies **AC-3, AC-7, AC-8, AC-9, AC-10, AC-16, AC-18**
6. Lane D: form thanks summary card and booking manage summary card, satisfies **AC-19, AC-20**
7. Delight pass across lanes A to D: copy confirmation, ease in of Ready panel and tiles, success check, warm one line confirmations, satisfies **AC-21**
8. Lane M, after A to D land: retake the booking, forms and link page screens from a reseeded demo workspace, update tab copy and the All features sheet against the shipped code, satisfies **AC-22**
9. Verify pass: run the alignment probe and motion checks across all lanes, screenshots in light and dark inside the real layout, satisfies **AC-1, AC-2, AC-4, AC-20**

## Consequences

**Positive**:
- Faster setup and fewer words to read, with a clear done moment.
- One set of tiles, empty states and a Ready panel reused everywhere, which later phases (themes, blocks, brand kit) build on.
- Alignment and motion become checkable rules, not taste.

**Negative / tradeoffs**:
- Existing browser tests and visual screenshots change and must be reviewed.
- A new library module (`ReadyPanel`) needs reviewer sign off.
- Merging the publish steps means auto matching must be trusted, so the mapping table stays visible and editable.

**Neutral**:
- Visual screenshots in the pinned image regenerate for touched stories.

## Follow-up

- [ ] Owner calls still open, deferred out of this phase: link page public by default, hiding visitor controls on `/b/:key`, removing first run steps (conflicts with the 22 Oct onboarding decision), custom accent colour, one shared brand kit, removing "Powered by Timefix".
- [ ] Phase 2 spec: link page themes v2 (gallery, looks, font packs, backgrounds, cover and avatar shapes, contrast guard).
- [ ] Phase 3 and later: link page blocks and reach, booking behaviour, forms layouts and fields, custom domain.
- [ ] Check branches `wip/formdesign`, `wip/forms2`, `wip/forms-track`, `wip/forms-questions` before Lane B starts, so work is not duplicated.

## Rationale

Short pointer: see [rationale.md](rationale.md) for the context, options and reasoning.
