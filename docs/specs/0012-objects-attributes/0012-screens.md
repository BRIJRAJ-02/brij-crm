# 0012. The screens of objects and attributes

## Summary

Settings gets its first pages: Objects, and each object's Attributes and Configuration. One dialog, AttributeSettings, creates and edits every attribute, whether opened from settings, from the "+" at the end of a table's columns, or from a column's menu. Tables work for any object, with a create dialog that asks for the name and the required fields first. Every piece is a library component; three of them (SettingsLayout, AttributeSettings, OptionsEditor) move forward from spec 0003's deferred milestone 4.

## Routes (`apps/web/src/routes`)

| Route | Screen | Guard |
|---|---|---|
| `/w/$slug/settings` | redirects to `/w/$slug/settings/objects` | a member (the door) |
| `/w/$slug/settings/objects` | SettingsLayout: "Objects" page; the object list, the meter, "New object" | a member; controls only with `schema.manage` |
| `/w/$slug/settings/objects/$object` | redirects to `…/$object/attributes` | as above |
| `/w/$slug/settings/objects/$object/$tab` | SettingsLayout with the object's header (icon tile, plural name, Standard or Custom badge) and Tabs: Attributes, Configuration. The Attributes tab reads `?attribute=<id>` (AC-231) | as above; an unknown object or tab shows NotFound inside the frame |
| `/w/$slug/objects/$object` (from #10) | any live object's table; an archived object shows the archived page | a member |

`$object` is the API name, as in the table's route, so links survive renames (API names never change). `RESERVED_SLUGS` keeps every object API name clear of the fixed segments (`map`, `list`, `new`, `settings`, `attributes`, `configuration`), so `/settings/objects/map` (spec 0016) can never be an object. Settings routes load lazily, outside the first load. The workspace menu in the sidebar gains "Settings" above "Sign out". SettingsLayout's navigation holds one entry, "Objects"; #8, #23 and later features add theirs.

## Library work (`packages/ui`, before the screens that use it)

Each gets a README with why it exists, a story per state, the three browser tests, axe, a screenshot, `design-system-guardian`, then the artifact publish.

- **SettingsLayout** (module, from the inventory): settings navigation (a list of links, current one marked), the page header (title, description, actions), and sections with a heading. Reuses Tabs and Breadcrumbs; no new tokens.
- **AttributeSettings** (module, from the inventory): presentational, props in and callbacks out. Parts: the type picker (a Select listing `PICKER_TYPES` with the registry's icon and label; read only when editing; an optional `relationshipEntry` prop, `{ label, onChoose }`, adds "Relationship" last, and `onChoose` lets the screen swap #15's RelationshipSettings into the same Modal), title, API name (prefilled, editable on create, read only with a copy button after), description, the switches (Required, Unique, Allow multiple, each shown only where the type allows), the default (the type's form editor from the field set, `surface='form'`, plus "Current user" for Member and "Today + N days" for Date as a SegmentedControl choice), the type settings (Number display, Currency code, Status starter stages), and the OptionsEditor slot. Server refusals land on their field through the Form molecule's `fieldFor`. When the static default names an archived option, the default field shows it muted with a note: "This option is archived. New records get <first live option>." (required) or "This option is archived. New records get no value." (optional).
- **OptionsEditor** (module, from the inventory): React Aria `GridList` with drag and keyboard reorder (the existing `reorder.ts`), each row a label field, a HuePicker in a Popover, and for status an outcome Select and a target days field; "Add option"; a row menu with Archive or Restore; archived options in a collapsed "Archived" group, muted like the archived Tag. Shows "N of 500" from a prop.
- **DataGrid** (variant props, optional): `onAddColumn` draws a "+" header cell after the last column (a labelled button, "Add attribute"); `columnActions(columnId)` adds items to the column menu after the built in ones ("Edit attribute", "Archive attribute"). Without the props nothing changes.
- **Select and Status editors** (variant prop, optional): `onCreateOption(label)` adds "Create "<label>"" as the last item when the typed text matches no live option's label (ignoring case). Without the prop nothing changes. The screen's handler mints the option id and sends one `records.setValues` with `newOption` through the data layer (optimistic, rolled back on refusal).
- **Type picker labels**: the registry's label per type exists (spec 0005); Multi select and Link are the picker's own labels for `select` with `isMulti` and `url`.

## Settings, Objects

- Header: "Objects", "Shape the records your workspace keeps." Actions: "New object" (primary). Once #56 ships the map, the header also holds a "List" and "Map" SegmentedControl (spec 0016 AC-342); this spec leaves room for it in the header's actions and builds nothing for it.
- For `schema.manage`, a Meter "N of 50 custom objects" (warning from 80%).
- Loading: five Skeleton rows and a Skeleton meter while `objects.list` and `usage.get` load. Error: an EmptyState (error tone) with "Retry" in place of the table; the header and navigation stay usable.
- A Table of live objects in `position` order: drag handle, icon tile, plural name, badge, "N attributes", and a row menu ("Open", "Move up", "Move down", "Archive"). The whole row opens the object's Attributes tab.
- "Archived" section (a Disclosure, closed by default) with each archived object and "Restore".
- For a member: the same list with no "New object", no meter, no drag handles, no row menu items but "Open", and a quiet Callout: "Only workspace owners and admins can change objects and attributes."
- Empty state never happens (the standard objects exist), but if every object is archived the live list says "No live objects. Restore one below or create a new one."

## New object dialog

Modal + Form: Singular name, Plural name (follows the singular plus "s" until edited), API name (follows `toApiSlug(plural)` until edited), Icon (IconPicker), Colour (HuePicker). "Create object" shows busy until the server answers, then goes to the new object's Attributes tab. Refusals: `SLUG_TAKEN` on API name ("An object already uses this API name."), `CONFIG_INVALID` on its field (including "That API name is reserved."), `NAME_TAKEN` on the name field it names, `LIMIT_REACHED` as the form's banner.

## An object's Configuration tab

A Form: Singular name, Plural name, Icon, Colour, "Save" (enabled when changed; busy while waiting, the fields kept as typed; `NAME_TAKEN` on the name it names, `CONFIG_INVALID` on its field, anything else in the form's banner; the page's own read shows Skeleton fields while loading and an EmptyState with Retry on failure). API name and the object id read only with copy buttons. A danger zone Card: "Archive <plural>" (or "Restore" when archived) opening a confirm Modal (danger tone): "Archive Projects? It leaves the sidebar and its 1,240 records are kept. Relationship fields that point to it are hidden until you restore it." The count comes from `records.count`.

## An object's Attributes tab

- Header actions: "New attribute" (primary). For `schema.manage`, a Meter "N of 250 attributes".
- Loading: Skeleton rows while `attributes.list` and `usage.get` load; error: an EmptyState with Retry.
- A Table in three sections:
  - Attributes: drag handle, type icon, title, type label, badges (Required, Unique, Default, Primary), row menu ("Edit", "Move up", "Move down", "Archive"; no Archive on the primary).
  - System: the five system attributes, read only, no handle, no menu.
  - Archived (Disclosure): each archived attribute with "Restore"; one archived by its object shows its reason instead.
- A row opens AttributeSettings in edit mode and sets `?attribute=<id>`; opening the tab with that param opens the same dialog (a relationship attribute opens #15's RelationshipSettings in edit mode), and closing it removes the param. An unknown, hidden or other object's id clears the param and opens nothing.
- A member sees the rows and badges only, with the same Callout as Objects.

## AttributeSettings dialog

- Create (from "New attribute", the grid's "+", or #10's "Add attribute"): the type picker first, then the fields the type allows. "Create attribute" waits for the server; on success the dialog closes, the column appears (at the end), and focus returns to where the dialog was opened from.
- Edit (from a settings row or the column menu's "Edit attribute"): the same fields, type read only with a note "Changing the type comes later." (removed by #14), API name read only. "Save" sends only what changed.
- Select and Multi select: the OptionsEditor, starting empty with one blank row focused. Status: the OptionsEditor prefilled with the starter stages.
- Currency: a currency Select (required). Number: a SegmentedControl, Plain or Percent.
- Refusals: on their field where one is named (`SLUG_TAKEN`, `CONFIG_INVALID` with an attribute id), else the banner (`LIMIT_REACHED`, `UNIQUE_HAS_DUPLICATES` with its list or count).

## Archive and restore confirms

- Attribute: "Archive <title>? It leaves every table and form. Its values are kept and come back if you restore it." Restore needs no confirm.
- Relationship end: the confirm names both ends: "This also archives <far title> on <far plural>."
- Option: archive needs no confirm (it is reversible and shown in place); the archived group shows how many records still hold each archived option only from #14. Archiving the option the default names is allowed; the Default badge turns into "Default archived".

## Tables and the create dialog

- `/w/$slug/objects/$object` reads the object by API name from the definitions store; TopBar shows its icon tile, plural name and "New <singular>"; everything else is #10's People screen made generic.
- An archived object's URL shows an EmptyState: "<Plural> is archived", with "Restore" for `schema.manage` and "Back to <first live object>" for everyone.
- The create dialog: the primary attribute's editor, then each required attribute's, then a "Add more fields" Button (a Disclosure trigger) revealing the rest in `position` order. Defaults are prefilled. "Create <singular>" behaves as #10's create (optimistic, refusals on their fields).
- The grid's "+" header and schema column menu items show only with `schema.manage`.
- Record chips (reference cells, the panel, pickers) take their icon tile and hue from the definitions store's object for the chip's `objectId`, so restyling an object restyles its chips live.

## Every screen

- A three line brief (purpose, main task, what it leaves out) in each feature folder's README (`apps/web/src/features/settings/`, `apps/web/src/features/objects/`).
- Focus moves to the page title on route change; dialogs return focus to their trigger; after a create from the "+" header, focus moves to the new column's header.
- Reordering by keyboard everywhere (GridList's keyboard drag, plus the row menu's Move up and Move down) with a live region announcing the new position.
- Every string lives in the feature's `strings.ts`.
- `dxe quick`, `ux-interaction-reviewer` and `design-system-guardian` before each milestone lands.

## Rationale (short)

One dialog for create and edit means one place to get each type's settings right, and the grid's "+" and column menu reuse it rather than growing their own forms. Settings pages, not inline popovers, hold the schema because reordering, archived sections and usage meters need room and a stable URL that #56's schema map can open. Pulling the three modules forward keeps the rule that screens are built only from library parts.
