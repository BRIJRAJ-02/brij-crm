# 0018. The screens of sections and layouts

## Summary

Settings gets sections inside #13's Attributes tab, with one new library module (`AttributeSections`) for a list whose rows move within and between sections by drag and by keyboard. The record page, the panel and the create form read one pure function, `recordLayout`, so they always agree. Folding and "Hide empty fields" are AttributeList variants the screen keeps in the browser's storage. Highlights reuse ViewSettings to pick and AttributeList's new grid layout to show.

## Library work (`packages/ui`, before the screens that use it)

Each gets a README, a story per state, the three browser tests, axe, a screenshot, `design-system-guardian`, then the artifact publish.

- **AttributeSections** (new module). Why new: OptionsEditor and ViewSettings reorder one flat list; nothing moves rows between titled sections. A React Aria `GridList` with `GridListSection`s and `useDragAndDrop`. Props: `sections` (`[{ id, title?, items, menu? }]`, the untitled one with no title), `renderItem` (the row's content: icon, title, type, badges), `itemMenu(item)` (menu items, including "Move up", "Move down" and a "Move to section" submenu listing every section), `onMove(itemId, sectionId, index)`, `onSectionMenu`, `isReadOnly`. A live region announces each move ("<Title> moved to <Section>, position <N> of <M>"). Rows and sections move by drag (handle) and by the menus; Enter on a handle picks a row up, arrows choose the place, Enter drops, Esc cancels (as ViewSettings). States: default, empty section ("Drop attributes here"), read only (no handles, no menus), dragging, drop target.
- **AttributeList** (variants, all optional):
  - `expandedSectionIds` with `onExpandedChange(sectionId, isExpanded)` (controlled folding; without them, today's `defaultExpanded`),
  - `hideEmpty` with `keepShownIds` (items whose value is empty by the field set's `isEmpty` are left out, except kept ids; a section left with no items is left out),
  - `layout: 'list' | 'grid'` (grid draws each item as a tile, title over value, 3 per row at or above `bp-container-md`, 2 at or above `bp-container-sm`, 1 below; editing as in list),
  - `heading` with `menuItems` (draws `label` as a visible heading with a "More" icon button opening Menu).
- **ViewSettings** (variant): `maxShown` (with `countLabel(shown, max)`): once `maxShown` rows are shown, the other switches are disabled with the Tooltip "Up to <max>"; the head reads the given count label.
- **Form** (variant): `FormSection`, a `fieldset` with its `legend` styled as a label heading, for the create dialog's sections.

## Settings: an object's Attributes tab (#13's page, changed)

Brief: Purpose: shape how an object's records read. Main task: put attributes into sections and order them. Leaves out: lists (no screen yet) and per person layouts.

- Header actions: "New section" (secondary) beside #13's "New attribute" (primary).
- A "Highlights" Card above the list: the highlighted attributes as Tags in order, "<N> of 6", and "Edit highlights". For a member, the Tags only.
- The list (AttributeSections), in order:
  - "No section" (always shown, muted title, so rows can be dropped there),
  - each section with its title, "<N> attributes", and a section menu: "Add attribute here", "Rename", "Move up", "Move down", "Delete",
  - then #13's System and Archived parts unchanged (archived attributes keep their section, shown in the Archived part).
- Each attribute row: #13's content plus a "Hidden" badge when not shown on the record page, and a "Highlight" badge with its number when highlighted. Its menu adds "Move to section", "Hide from record page" or "Show on record page", and "Add to highlights" or "Remove from highlights" ("Add" disabled with the reason when 6 are set, or the attribute is hidden or holds many records).
- Every action is server confirmed: the row or section shows busy, and the list redraws from the refetched definitions.
- A member sees the sections and badges with no handles and no menus, and #13's Callout.

### Dialogs

- **New section** and **Rename section**: Modal + Form with one Field "Section name" (1 to 100 characters, with a count), "Create section" or "Save". `NAME_TAKEN` and `CONFIG_INVALID` show on the field, `LIMIT_REACHED` as the form's banner.
- **Delete section**: a confirm Modal, danger tone: "Delete <title>? Its <N> attributes move to the top, without a section. No values change." Buttons "Delete section" and "Cancel".
- **Edit highlights**: Modal with ViewSettings (`maxShown` 6, count label "<N> of 6 highlights") listing the object's live, non system, shown attributes that hold one value or one record, in layout order with the highlighted ones first in their order; "Save" sends `attributes.setHighlights`; refusals as the form's banner.
- **AttributeSettings** (#13's, changed): a "Section" Select (every section by order, plus "No section"; defaults to the section it was opened from by "Add attribute here", else the last section, else "No section") and a "Show on record page" Switch (on by default). Editing shows both and sends only what changed.

## The record page and the panel (`RecordDetails`, spec 0017, changed)

- AttributeList with `heading` "Details" and `menuItems`: "Hide empty fields" (a checked item), "Collapse all", "Expand all".
- Sections from `recordLayout`: untitled (no title), each section by order, "Hidden fields (<N>)" (when N > 0), then "Record". Folding is controlled: `expandedSectionIds` comes from the stored preference merged with the defaults (every section open, "Record" and "Hidden fields" closed).
- The relationship sections (spec 0017) follow in layout order, leaving out sides hidden from the page.
- Preferences: `apps/web/src/features/records/prefs.ts` (new) reads and writes the `localStorage` key `crm:record-layout:v1:<workspaceId>:<objectId>` inside try/catch, at most once per change, and ignores section ids that no longer exist. Nothing record related is stored there.
- While "Hide empty fields" is on, the ids the person committed on this page since opening it are passed as `keepShownIds`, so a value they just cleared doesn't vanish under their cursor.
- Overview (spec 0017) gets "Highlights" as its first block: a Card with AttributeList `layout="grid"`, one untitled section holding the highlights in order, editing through the same `onCommit` as Details. With no highlights (or none visible) the block is left out.

## The create dialog (#13's, changed)

- The primary attribute's editor, then each required attribute's in layout order, then "Add more fields" (a Disclosure trigger) revealing the rest: the untitled ones first with no heading, then a `FormSection` per section with its title as the legend. Attributes hidden from the record page are left out unless required. Sections with nothing to show are left out.

## Every screen

- Briefs in `apps/web/src/features/settings/README.md` and `apps/web/src/features/records/README.md`; strings in each feature's `strings.ts`.
- Focus: after "Create section" focus moves to the new section's title; after a move by keyboard focus stays on the moved row; after "Delete section" focus moves to the "No section" title; dialogs return focus to their trigger.
- `dxe quick`, `ux-interaction-reviewer` and `design-system-guardian` before each milestone lands.

## Rationale (short)

One pure `recordLayout` keeps the page, the panel, the create form and settings from drifting apart. Sections inside the existing Attributes tab, rather than a separate layout editor, keep one place where an admin sees and orders attributes. Personal folding in the browser is a convenience, not data, so it stays out of the server and the store.
