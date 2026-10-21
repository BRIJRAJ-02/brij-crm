# Settings

Spec 0012, milestone 1 (objects and attributes, #13), spec 0008 (background jobs, #8) and spec 0026 (the settings area). Every settings page sits under the settings layout route (`routes/w.$slug.settings.tsx`), which swaps the app's sidebar for the settings sidebar (the library Sidebar's settings variant): "Settings" with a back link to the page Settings was opened from (`back.ts`: main.tsx remembers each workspace page reached outside Settings in this tab's sessionStorage; with none, the workspace's home), then Account (Preferences, Calendars) and Workspace (Objects, Background jobs). Every entry opens a page in Settings (20 October 2026): the Scheduling group's links into Captures (Booking pages, Forms) went, since neither has workspace wide settings yet; one booking page's or one form's settings live in its own editor, and Scheduling comes back as a group when workspace wide scheduling settings (spam protection, defaults) arrive. The old Settings addresses of the booking pages and forms (`/settings/booking-pages`, `/settings/forms`, and one page or form under them) redirect to Captures, on the same tab. A group with no page the member may open is left out (`visibleSettingsNav`); today every member may open every page. The frame stays mounted between settings pages, so the list keeps its place, and focus stays in it after a route change (`focus.ts`); the arrow keys move inside it and Tab passes it. Each page draws through `SettingsPage`: a `TopBar` with the trail ("Settings › Account › Preferences", `nav.ts` names the group by the address; the bar holds the page's h1) in the bar slot the settings frame keeps above the view (`topBarSlot.ts`, as every page's TopBar sits, with its hairline running on from the settings sidebar's head), with an object's tile and badge and the page's one primary action at its end (the owner, 21 October 2026: no title block under the bar repeats the trail), then `SettingsLayout` (`header="bar"`) with the body alone, its sections' headings h2 under the bar's h1. Disconnect on Calendars asks first: "Disconnect <account>?", what happens to its meetings and busy times and that it can be connected again, Cancel, then Disconnect, busy while the server works, a refusal shown inside the confirm. Settings opens on Account › Preferences, from the sidebar's foot (Settings, ⌘,), the workspace menu, or ⌘, (Ctrl+, off a Mac) from anywhere but a text field, an editor or a dialog. The routes load lazily, outside the first load. Each page keeps its own copy: `strings.ts` for the frame and the objects pages, `jobs-strings.ts`, `calendar-strings.ts` and `preferences-strings.ts`.

## Settings › Account › Preferences (`/w/$slug/settings/account/preferences`, PreferencesScreen)

- **Purpose**: how the app looks for this person (spec 0026, AC-684).
- **Main task**: pick the interface theme (System preference, Light or Dark) in a Select row; it applies the moment it changes, with no Save, and is kept in this browser by the theme controller (spec 0003), so another tab follows.
- **Leaves out**: time format, start of week, language and time zone, which need a stored per member preference (a later spec).

Built from library parts only: SettingsLayout (through `SettingsPage`), SettingsSection ("Appearance") around a Card, SettingsRow and Select (`isLabelHidden`, its label the row's title).

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
- **Layout**: the Configuration tab follows the settings page pattern (SettingsLayout's README): a Names and look section whose Form sits two fields to a row with Save in its footer, an Identifiers section with the read only API name and object ID, then a Danger zone section (Restore once archived) with the archive Card. The Attributes tab's tables run the full width.

## An object's attributes (the Attributes tab, AttributesTab)

- **Purpose**: the object's attributes as every table of it shows them: its own by position, the system ones, the archived ones.
- **Main task**: owners and admins add one (New attribute, in the page's header), open one to edit it (a row, or Edit in its menu; the address gains `?attribute=<id>`, so a link opens the same dialog), move one (drag its handle, or Move up and Move down), archive one (a confirm; not the name) and restore one from Archived.
- **Leaves out**: groups (#18) and the schema map (#56).

A meter "Attributes, N of 250" for owners and admins (a skeleton until `usage.get` answers), then the own attributes' Table (type icon and title, the type, badges for Primary, Required, Unique and Default, which reads "Default archived" while a select's or status's default names an archived option (milestone 3, AC-236), and a row menu), the system ones in a sunken Card, read only (a row opens them read only), and an Archived Disclosure: Restore on each, or, for a relationship end whose other object is archived, "Links to <Plural>, which is archived" and no Restore of its own. A move says the new place in a toast. `?attribute=` naming nothing this person can open here is removed, and nothing opens.

## The attribute dialog (AttributeDialog)

- **Purpose**: create or edit one attribute, from settings, the table's "+" header, its column menu or Add attribute at the foot of View settings.
- **Main task**: name it, pick one of the fifteen types, set the type's settings (a Number's display, a Currency's code) and options (a Select's or Multi select's, a Status's stages, starting from Not started, In progress and Done), Required, Unique and Allow multiple where the type takes them and a default, then Create attribute or Save.
- **Leaves out**: changing a type (#14). Relationship, last in the type picker for owners and admins, hands over to the relationship dialog below with the name typed so far, and a side of a two way relationship opens that dialog in edit mode.

The library's AttributeSettings, connected: one id minted per opening (a retry sends the same one), the write through the data layer and server confirmed, refusals on the setting they name (a taken API name on API name), an edit sending only what changed. A new attribute's options go with its create. An existing attribute's options save as they change (milestone 3, the editor's hint says so): each add, rename, recolour, outcome or target, move, archive and restore is one server confirmed write through `data.options`, its row spinning while it is out and showing its refusal after (a refused add's reason shows by Add option); the page reloads after each, and the dialog reads the attribute from the live list, so the rows are the server's. "N of 500" comes from `usage.get`. A system attribute, or anyone without `schema.manage`, sees it read only with Close.

## The relationship dialog (RelationshipDialog)

- **Purpose**: create a relationship from an object's Add attribute, or rename the two sides of one from its settings or its column menu (spec 0014).
- **Main task**: choose the related object and how records link, name each side, then Create relationship (or Save the names).
- **Leaves out**: changing the objects or the cardinality (#14), one way references (engine only), linking records (milestone 2).

The library's RelationshipSettings, connected. Creating (`useRelationshipCreate`): its step shows in the attribute dialog's own Modal once Relationship is chosen, so the scrim stays and Esc puts focus back on Add attribute; this object is the defining side, named with what was typed in the attribute dialog; the relationship's id is minted once per opening and sent again on every retry (a lost answer's retry gets the relationship already made); the write waits for the server and both objects' lists are read again, so the column appears here at once and the other object's table shows its side as its definitions event arrives. Editing (`RelationshipDialog`): both names come from the live list (each side carries its pair's name, `relationship.pairedTitle`, so a rename elsewhere shows), the side that was opened takes focus, and only the names that changed (trimmed) go out, in one `relationships.update`. Refusals land on the side's name (`from.title`, `to.title`), else above the settings. Anyone without `schema.manage` sees it read only with Close.

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
- **Main task**: see how a job is doing, confirm a counted change waiting for it, or cancel a job; each asks first. Owners and admins (`jobs.manage`) see every job, system ones included; members see their own.
- **Leaves out**: retry controls (spec 0008 milestone 2), the daily cleanup's details (milestone 3). It sits in `SettingsPage` beside Objects, its table and states inside SettingsLayout's body.

Built from library parts only: SettingsLayout (through `SettingsPage`), Table, Badge (the status), ProgressBar ("done of total", indeterminate when the size isn't known), RelativeTime, Button, Modal (the confirms, Modal's "When to ask first": a waiting change's Review asks in its own words, "Delete 12,345 people?", saying whose it is when it isn't the reader's, danger for all but a restore, with Not now leaving it waiting; Cancel asks "Cancel “Bulk delete”?" with Keep job; both busy until the server answers, and a refusal, which the jobs store toasts, closes them) and EmptyState (empty, and error with Try again); while it loads, the frame, the header and the Table's skeleton rows hold their places (`JobsPending`). Members see their own jobs without the Started by column, which would always name them. "Run a test job" shows for `jobs.manage` locally and in previews (AC-123): 20,000 synthetic items, every 50th refused, so the bar and the refusal summary both show.

## Settings › Account › Calendars (`/w/$slug/settings/account/calendars`, CalendarScreen)

- **Purpose**: Settings › Account › Calendars (specs 0024 and 0026): the member's own calendar connections, so their meetings reach the people and companies they meet.
- **Main task**: connect a Google calendar (the button carries the Google Calendar mark; the browser goes to the API's start address, on to Google's consent and back with `?calendar=` saying how it went, shown once in a Callout), see each connection's account, status and last sync, choose who sees its meetings (Shared or Private, a SegmentedControl), make one the default, and disconnect one (a danger confirm).
- **Leaves out**: other members' connections, Outlook (milestone 4), the disconnected banner, the workspace's "Create people for unknown attendees" setting and Add as person (milestone 2).

Its old address, `/w/$slug/settings/calendar`, where the API's Google callback still sends the browser, redirects here with its search (`?calendar=`) kept (AC-686).

Laid out in the settings page pattern (20 October 2026): a Connected calendars section holding the connections in a SettingsGrid (side by side where there’s room; the empty, off, loading and failed states span the page instead), then, for owners and admins, a For the workspace section with "Add people from meetings", a setting for every member that sits on this page because it is about calendars.

Built from library parts only: SettingsLayout (through `SettingsPage`), SettingsSection, SettingsGrid, Card per connection (its account as the title, Google and Default as the line under it, Make default and Disconnect in its footer), DescriptionList (Status as a Badge with the last error, Last synced as a RelativeTime, the sharing control with a line saying what it means), Callout (how connecting went; the limit of 3 reached), Modal (the disconnect confirm) and EmptyState (no calendar yet, with Connect Google calendar; calendar sync not set up; error with Try again). Changes show at once through `data.calendar` and come back with a toast when refused; a connection still syncing is read again until it is done.

## Members (MembersScreen.tsx, InviteDialog.tsx)

- **Purpose**: Settings › Workspace › Members (spec 0031, AC-803, AC-810): who is in the workspace, and who is invited.
- **Main task**: owners and admins invite people by email with one role, and resend or revoke an open invitation on the Invitations tab; everyone reads who is in and with which role.
- **Leaves out**: changing roles, removing and leaving (slice 3), transfer (slice 4), teams, guests, the invite link and email domains (later slices of spec 0031).

Built from library parts only: SettingsLayout (through `SettingsPage`, its one header action Invite people, no description line, the owner's settings pattern of 21 October 2026), Tabs (Members and Invitations with counts, the second only for holders of `members.invite`), Table (an Avatar and the name as the row header, a You badge on the reader's row, the role, Joined as a RelativeTime; on Invitations a row Menu with Resend and Revoke, whose button spins while a resend is on its way), Callout (for those who can't invite: who can), Modal (the Invite dialog's Form: a multiline Field that takes a pasted list, and a role Select whose options say what each role can do) and EmptyState (no open invitations). Every change waits for the server, then the route reads the list again. Another admin's change arrives as a live `members` event, which reloads the page. While it loads, `MembersPending` draws the same header, the tabs for those who get them, and skeleton rows.

### The confirm (MemberConfirm.tsx)

Anything on the page that ends something asks first (the owner, 21 October 2026): today Revoke ("Revoke the invitation to grace@example.com?", then "Revoke invitation"); removing, leaving and handing over join it in later slices. A danger Modal (an alert dialog a click outside won't close) with the question naming the thing, one sentence on what happens and whether it can be undone, Cancel (ESC) first and the verb last on a danger solid Button, which spins while the server works; a refusal shows inside it in a danger Callout and it stays open. The page says what happened in a toast once the server agrees.

## The finish toast (toast.ts)

- **Purpose**: tell the person when a job they started in this browser ends while the app is open (AC-119).
- **Main task**: say how it ended ("Test job: Done", "Test job: Done, 6 refused", "Failed", "Cancelled"), with View, which opens the Background jobs page.
- **Leaves out**: jobs started elsewhere, and notifications that outlive the tab (#28).

## Notes

- Every write here waits for the server (definition writes are never optimistic): the button spins with its ongoing verb, a refusal lands on the field it names (`NAME_TAKEN` on the name, `SLUG_TAKEN` and a reserved API name on API name) or in the form's banner, and once a write lands the data layer reads the objects again and every page reloads, so the sidebar and this page show the change, as every other member's do.
- Members open every page read only: no New object, meter, handles, Archive or Save, a quiet Callout saying only owners and admins can change objects, and the row menu holds Open alone. The server refuses them 403 anyway.
- States: while a page loads its header and rows hold their places (skeletons); a failed read shows an EmptyState with Retry in place of the page's body, and the navigation stays usable. An unknown object or tab says so inside the frame, with the way back to Objects.
