# Settings

Spec 0012, milestone 1 (objects and attributes, #13), and spec 0008 (background jobs, #8). Every settings page sits in the workspace frame through `SettingsPage`: the TopBar holds the trail and the page's h1, then the library's `SettingsLayout` holds the settings navigation (Objects and Background jobs; #23 and later add theirs) beside the page. Settings opens from the workspace menu, above Sign out, the one way in. The routes load lazily, outside the first load. Each page keeps its own copy: `strings.ts` for the objects pages, `jobs-strings.ts` for Background jobs.

## Settings, Objects (`/w/$slug/settings/objects`, ObjectsScreen)

- **Purpose**: every object, standard and custom, in the workspace's order (the sidebar's), and the archived ones.
- **Main task**: owners and admins create an object, move one (drag its handle, or Move up and Move down in its row menu), archive one, restore one from Archived, or open one.
- **Leaves out**: an object's own settings (its page), the schema map (#56) and usage beyond the custom object meter (#38).

## New object (NewObjectDialog)

- **Purpose**: make a custom object (Projects, Partners).
- **Main task**: name one and many (the plural follows the singular plus "s" until edited), keep or change the API name (it follows the plural through the server's own `toApiSlug` until edited), pick an icon and a colour, then Create object; the object opens on its Attributes tab.
- **Leaves out**: attributes: the object starts with its text Name and the five system attributes.

## An object's settings (`/w/$slug/settings/objects/$object/$tab`, ObjectSettingsScreen)

- **Purpose**: one object, standard or custom alike, under its tile, name and Standard or Custom badge, in two tabs.
- **Main task**: add, edit, move, archive and restore its attributes (Attributes), and rename, restyle, archive or restore it (Configuration).
- **Leaves out**: changing a type (#14), and changing the API name (never).

## An object's attributes (the Attributes tab, AttributesTab)

- **Purpose**: the object's attributes as every table of it shows them: its own by position, the system ones, the archived ones.
- **Main task**: owners and admins add one (New attribute, in the page's header), open one to edit it (a row, or Edit in its menu; the address gains `?attribute=<id>`, so a link opens the same dialog), move one (drag its handle, or Move up and Move down), archive one (a confirm; not the name) and restore one from Archived.
- **Leaves out**: groups (#18) and the schema map (#56).

A meter "Attributes, N of 250" for owners and admins (a skeleton until `usage.get` answers), then the own attributes' Table (type icon and title, the type, badges for Primary, Required, Unique and Default, which reads "Default archived" while a select's or status's default names an archived option (milestone 3, AC-236), and a row menu), the system ones in a sunken Card, read only (a row opens them read only), and an Archived Disclosure: Restore on each, or, for a relationship end whose other object is archived, "Links to <Plural>, which is archived" and no Restore of its own. A move says the new place in a toast. `?attribute=` naming nothing this person can open here is removed, and nothing opens.

## The attribute dialog (AttributeDialog)

- **Purpose**: create or edit one attribute, from settings, the table's "+" header, its column menu or the view bar's Add attribute.
- **Main task**: name it, pick one of the fifteen types, set the type's settings (a Number's display, a Currency's code) and options (a Select's or Multi select's, a Status's stages, starting from Not started, In progress and Done), Required, Unique and Allow multiple where the type takes them and a default, then Create attribute or Save.
- **Leaves out**: Relationship (#15) and changing a type (#14).

The library's AttributeSettings, connected: one id minted per opening (a retry sends the same one), the write through the data layer and server confirmed, refusals on the setting they name (a taken API name on API name), an edit sending only what changed. A new attribute's options go with its create. An existing attribute's options save as they change (milestone 3, the editor's hint says so): each add, rename, recolour, outcome or target, move, archive and restore is one server confirmed write through `data.options`, its row spinning while it is out and showing its refusal after (a refused add's reason shows by Add option); the page reloads after each, and the dialog reads the attribute from the live list, so the rows are the server's. "N of 500" comes from `usage.get`. A system attribute, or anyone without `schema.manage`, sees it read only with Close.

## Attribute archive confirm (ArchiveAttributeDialog)

- **Purpose**: make archiving an attribute deliberate, standard objects' included.
- **Main task**: read that its values are kept (and, for a relationship end, that the other end goes with it), then Archive <title> or Cancel.
- **Leaves out**: deleting values; Restore in the Archived section brings it back at its old place.

## Archive confirm (ArchiveObjectDialog)

- **Purpose**: make archiving an object a deliberate step, standard objects included.
- **Main task**: read how many records it holds and that they stay, then Archive <plural> or Cancel.
- **Leaves out**: deleting anything; it is restored from Archived, the Configuration tab or the object's own address.

## Settings, Background jobs (`/w/$slug/settings/jobs`, JobsScreen)

- **Purpose**: Settings, Background jobs (spec 0008, AC-118): the workspace's long work, with its progress, live.
- **Main task**: see how a job is doing and cancel it, with a confirm. Owners and admins (`jobs.manage`) see every job, system ones included; members see their own.
- **Leaves out**: confirming a prepared job and retry controls (spec 0008 milestone 2), the daily cleanup's details (milestone 3). It sits in `SettingsPage` beside Objects, its table and states inside SettingsLayout's body.

Built from library parts only: SettingsLayout (through `SettingsPage`), Table, Badge (the status), ProgressBar ("done of total", indeterminate when the size isn't known), RelativeTime, Button, Modal (the cancel confirm, `tone="danger"`) and EmptyState (empty, and error with Try again); while it loads, the frame, the header and the Table's skeleton rows hold their places (`JobsPending`). Members see their own jobs without the Started by column, which would always name them. "Run a test job" shows for `jobs.manage` locally and in previews (AC-123): 20,000 synthetic items, every 50th refused, so the bar and the refusal summary both show.

## The finish toast (toast.ts)

- **Purpose**: tell the person when a job they started in this browser ends while the app is open (AC-119).
- **Main task**: say how it ended ("Test job: Done", "Test job: Done, 6 refused", "Failed", "Cancelled"), with View, which opens the Background jobs page.
- **Leaves out**: jobs started elsewhere, and notifications that outlive the tab (#28).

## Notes

- Every write here waits for the server (definition writes are never optimistic): the button spins with its ongoing verb, a refusal lands on the field it names (`NAME_TAKEN` on the name, `SLUG_TAKEN` and a reserved API name on API name) or in the form's banner, and once a write lands the data layer reads the objects again and every page reloads, so the sidebar and this page show the change, as every other member's do.
- Members open every page read only: no New object, meter, handles, Archive or Save, a quiet Callout saying only owners and admins can change objects, and the row menu holds Open alone. The server refuses them 403 anyway.
- States: while a page loads its header and rows hold their places (skeletons); a failed read shows an EmptyState with Retry in place of the page's body, and the navigation stays usable. An unknown object or tab says so inside the frame, with the way back to Objects.
