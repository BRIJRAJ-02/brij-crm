# Settings

Spec 0012, milestone 1 (objects and attributes, #13), spec 0008 (background jobs, #8) and spec 0026 (the settings area). Every settings page sits under the settings layout route (`routes/w.$slug.settings.tsx`), which swaps the app's sidebar for the settings sidebar (the library Sidebar's settings variant): "Settings" with a back link to the page Settings was opened from (`back.ts`: main.tsx remembers each workspace page reached outside Settings in this tab's sessionStorage; with none, the workspace's home), then Account (Preferences, Calendars) and Workspace (Objects, Background jobs). Every entry opens a page in Settings (20 October 2026): the Scheduling group's links into Captures (Booking pages, Forms) went, since neither has workspace wide settings yet; one booking page's or one form's settings live in its own editor, and Scheduling comes back as a group when workspace wide scheduling settings (spam protection, defaults) arrive. The old Settings addresses of the booking pages and forms (`/settings/booking-pages`, `/settings/forms`, and one page or form under them) redirect to Captures, on the same tab. A group with no page the member may open is left out (`visibleSettingsNav`); today every member may open every page. The frame stays mounted between settings pages, so the list keeps its place, and focus stays in it after a route change (`focus.ts`); the arrow keys move inside it and Tab passes it. Each page draws through `SettingsPage`: a `TopBar` with the trail ("Settings › Account › Preferences", `nav.ts` names the group by the address; the bar holds the page's h1) in the bar slot the settings frame keeps above the view (`topBarSlot.ts`, as every page's TopBar sits, with its hairline running on from the settings sidebar's head), then `SettingsLayout` with the title as an h2, a one line description, a hairline (left off when Tabs follow), then the body. Settings opens on Account › Preferences, from the sidebar's foot (Settings, ⌘,), the workspace menu, or ⌘, (Ctrl+, off a Mac) from anywhere but a text field, an editor or a dialog. The routes load lazily, outside the first load. Each page keeps its own copy: `strings.ts` for the frame and the objects pages, `jobs-strings.ts`, `calendar-strings.ts` and `preferences-strings.ts`.

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

- **Purpose**: create or edit one attribute, from settings, the table's "+" header, its column menu or the view bar's Add attribute.
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
- **Main task**: see how a job is doing and cancel it, with a confirm. Owners and admins (`jobs.manage`) see every job, system ones included; members see their own.
- **Leaves out**: confirming a prepared job and retry controls (spec 0008 milestone 2), the daily cleanup's details (milestone 3). It sits in `SettingsPage` beside Objects, its table and states inside SettingsLayout's body.

Built from library parts only: SettingsLayout (through `SettingsPage`), Table, Badge (the status), ProgressBar ("done of total", indeterminate when the size isn't known), RelativeTime, Button, Modal (the cancel confirm, `tone="danger"`) and EmptyState (empty, and error with Try again); while it loads, the frame, the header and the Table's skeleton rows hold their places (`JobsPending`). Members see their own jobs without the Started by column, which would always name them. "Run a test job" shows for `jobs.manage` locally and in previews (AC-123): 20,000 synthetic items, every 50th refused, so the bar and the refusal summary both show.

## Settings › Account › Calendars (`/w/$slug/settings/account/calendars`, CalendarScreen)

- **Purpose**: Settings › Account › Calendars (specs 0024 and 0026): the member's own calendar connections, so their meetings reach the people and companies they meet.
- **Main task**: connect a Google calendar (the button carries the Google Calendar mark; the browser goes to the API's start address, on to Google's consent and back with `?calendar=` saying how it went, shown once in a Callout), see each connection's account, status and last sync, choose who sees its meetings (Shared or Private, a SegmentedControl), make one the default, and disconnect one (a danger confirm).
- **Leaves out**: other members' connections, Outlook (milestone 4), the disconnected banner, the workspace's "Create people for unknown attendees" setting and Add as person (milestone 2).

Its old address, `/w/$slug/settings/calendar`, where the API's Google callback still sends the browser, redirects here with its search (`?calendar=`) kept (AC-686).

Laid out in the settings page pattern (20 October 2026): a Connected calendars section holding the connections in a SettingsGrid (side by side where there’s room; the empty, off, loading and failed states span the page instead), then, for owners and admins, a For the workspace section with "Add people from meetings", a setting for every member that sits on this page because it is about calendars.

Built from library parts only: SettingsLayout (through `SettingsPage`), SettingsSection, SettingsGrid, Card per connection (its account as the title, Google and Default as the line under it, Make default and Disconnect in its footer), DescriptionList (Status as a Badge with the last error, Last synced as a RelativeTime, the sharing control with a line saying what it means), Callout (how connecting went; the limit of 3 reached), Modal (the disconnect confirm) and EmptyState (no calendar yet, with Connect Google calendar; calendar sync not set up; error with Try again). Changes show at once through `data.calendar` and come back with a toast when refused; a connection still syncing is read again until it is done.

## Members (MembersScreen.tsx, InviteDialog.tsx, InviteLinkCard.tsx)

- **Purpose**: Settings › Workspace › Members (spec 0031, AC-803, AC-810, AC-811, AC-818): who is in the workspace, what each can do, and who is invited.
- **Main task**: find someone by name or email; owners and admins change roles with the row's Select (only the roles they may give), remove people from the row menu, invite people by email, resend or revoke open invitations, and share the invite link.
- **Leaves out**: leaving (the workspace menu's), teams and guests (later slices of spec 0031).

The lean pass (the owner, 21 October 2026): the TopBar holds the trail, the page's h1 and its one primary action, Invite people (`SettingsLayout header="bar"`, as the recui lane set for every settings page), and no title block or description repeats them. Tabs (`inset="none"`, so the first tab's label lines up with the table's first column) hold Members and Invitations with counts; the search sits at the strip's end on the Members tab only. A lone member who may invite gets one quiet row under their own ("Just you so far. Invite your team to work together."), not a block. Empty searches and an empty Invitations tab say so in a title alone.

Built from library parts only: SettingsLayout (through `SettingsPage`), Tabs, Field (`variant="search"`, its text in `?q=` once typing pauses), Table (an Avatar and the name as the row header, a You badge on the reader's row, the role as a small Select or plain text, Joined as a RelativeTime, a row Menu with Transfer ownership and Remove from workspace, each only where the reader may; on Invitations a row Menu with Resend and Revoke), Button (Show more members), Callout (for those who can't invite: who can), EmptyState and Modal. Every role picker takes its options from `roles.list` (spec 0037, AC-1439), filtered by the owner rules. Someone else's role changes at once and goes back with the server's reason if refused; a change to one's own role asks first. Every other change waits for the server, then the route reads the page again. While it loads, `MembersPending` draws the same bar (Invite people disabled), the tabs (or the note), the search and skeleton rows.

### The invite dialog (InviteDialog.tsx)

One row per person: an email Field (text, with the email keyboard, so a pasted column keeps its line breaks) whose suffix holds that row's role, an inline Select defaulting to the row before it (the roles list's default for the first), and, with more than one row, a ghost `x` that removes it (nothing is sent yet, so it asks nothing). Add another (full width, label at the start), or Enter in the last row, adds a row and focuses it; Enter on an empty last row sends. A pasted list ("a@x.com, b@y.com" or one per line) fills this row and new ones, up to 20; past that, a line says only the first ones were added. Each row says what's wrong under it once left (not an address, already in the list); Invite with a bad row focuses it. The button counts the valid rows ("Invite 3 people"); one call per role. Sent, the dialog says who was invited (announced), who already belongs, and whose email didn't go out, with Invite more and Done.

### Domain join (EmailDomainCard.tsx, the Join requests tab)

The Invitations tab opens with the Email domain card for holders of `workspace.manage` (spec 0031, AC-819): one SettingsRow whose switch lets people at the reader's own verified domain ask to join ("People at @acme.com can ask to join. You approve each one."); a public or unverified address says why it can't, with the switch disabled. Turning it on waits for the server with the switch on and disabled, the line reading "Turning on for @acme.com…" and the card busy, then a toast says it is on. Only the reader's own domain may go on (the server refuses any other, and every public mail domain). While requests wait, a Join requests tab joins Members and Invitations with its count (AC-810, AC-820): Name, Email, Asked (a RelativeTime), and Approve and Decline. Approve brings them in at once as a member and reloads the page; Decline ends their request, so it asks first in the page's confirm ("Decline Grace's request?"), and they are never told.

### The invite link (InviteLinkCard.tsx)

A Card of SettingsRows above the Invitations table, its first row naming it: the switch ("Anyone with the link can join as a member" while off), then while on the link to copy (Field `variant="copy"`, how many joined as its one hint), Expires (never, 1, 7 or 30 days from now) and Most uses (no limit, 10, 25, 50, 100), and Reset link in the footer. Turning it off and Reset end the current link, so both ask first in the page's confirm; every change waits for the server.

### The confirm (MemberConfirm.tsx)

Anything on the page that ends something asks first (the owner, 21 October 2026): Revoke ("Revoke the invitation to grace@example.com?", then "Revoke invitation"), Remove from workspace (its own dialog, below) and lowering one's own role ("Change your own role to Admin?", then "Change my role", which shows `LAST_OWNER`'s sentence for the only owner); and Transfer ownership ("Make Grace Hopper the owner of Acme?", then "Transfer ownership"). A danger Modal (an alert dialog a click outside won't close) with the question naming the thing, one sentence on what happens and whether it can be undone, Cancel (ESC) first and the verb last on a danger solid Button, which spins while the server works; a refusal shows inside it in a danger Callout and it stays open. The page says what happened in a toast once the server agrees.

### The remove dialog (RemoveMemberDialog.tsx)

- **Purpose**: ask before removing someone, saying what it does (spec 0031, AC-814, AC-816).
- **Main task**: read what happens, optionally pick who takes over their open tasks and records, then Remove member.
- **Leaves out**: the removal's rules (the server's), the hand over's progress (Background jobs) and the toast (the page's).

The same danger Modal as the confirm ("Remove Grace Hopper from Acme?", Cancel (ESC) first, "Remove member" last, busy while it runs, a refusal in a danger Callout inside). As it opens it reads `members.removalPreview` and the member list through the data layer, with Skeleton lines while that loads (Remove member waits for it), then one sentence per effect that applies: open tasks assigned to them, records naming them as owner, booking pages that pause with nobody left to host, and calendar connections disconnected. When tasks or records name them, a searchable Select (each person with their Avatar and email, clearable, empty by default) picks who takes them over; the removal then starts a `members.reassign` job and the toast says where their work is going. A failed read says so in a warning Callout and still lets the removal go ahead.

## The finish toast (toast.ts)

- **Purpose**: tell the person when a job they started in this browser ends while the app is open (AC-119).
- **Main task**: say how it ended ("Test job: Done", "Test job: Done, 6 refused", "Failed", "Cancelled"), with View, which opens the Background jobs page.
- **Leaves out**: jobs started elsewhere, and notifications that outlive the tab (#28).

## Notes

- Every write here waits for the server (definition writes are never optimistic): the button spins with its ongoing verb, a refusal lands on the field it names (`NAME_TAKEN` on the name, `SLUG_TAKEN` and a reserved API name on API name) or in the form's banner, and once a write lands the data layer reads the objects again and every page reloads, so the sidebar and this page show the change, as every other member's do.
- Members open every page read only: no New object, meter, handles, Archive or Save, a quiet Callout saying only owners and admins can change objects, and the row menu holds Open alone. The server refuses them 403 anyway.
- States: while a page loads its header and rows hold their places (skeletons); a failed read shows an EmptyState with Retry in place of the page's body, and the navigation stays usable. An unknown object or tab says so inside the frame, with the way back to Objects.
