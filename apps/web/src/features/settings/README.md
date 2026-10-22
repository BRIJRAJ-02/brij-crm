# Settings

Spec 0012, milestone 1 (objects and attributes, #13), spec 0008 (background jobs, #8) and spec 0026 (the settings area). Every settings page sits under the settings layout route (`routes/w.$slug.settings.tsx`), which swaps the app's sidebar for the settings sidebar (the library Sidebar's settings variant): "Settings" with a back link to the page Settings was opened from (`back.ts`: main.tsx remembers each workspace page reached outside Settings in this tab's sessionStorage; with none, the workspace's home), then Account (Profile, Preferences, Security, Notifications), Scheduling (Calendars) and Workspace (Objects, Background jobs). Every entry opens a page in Settings (20 October 2026): the Scheduling group's links into Captures (Booking pages, Forms) went, since neither has workspace wide settings yet; one booking page's or one form's settings live in its own editor, and Scheduling comes back as a group when workspace wide scheduling settings (spam protection, defaults) arrive. The old Settings addresses of the booking pages and forms (`/settings/booking-pages`, `/settings/forms`, and one page or form under them) redirect to Captures, on the same tab. A group with no page the member may open is left out (`visibleSettingsNav`); today every member may open every page. The frame stays mounted between settings pages, so the list keeps its place, and focus stays in it after a route change (`focus.ts`); the arrow keys move inside it and Tab passes it. Each page draws through `SettingsPage`: a `TopBar` with the trail ("Settings › Account › Preferences", `nav.ts` names the group by the address; the bar holds the page's h1) in the bar slot the settings frame keeps above the view (`topBarSlot.ts`, as every page's TopBar sits, with its hairline running on from the settings sidebar's head), with an object's tile and badge and the page's one primary action at its end (the owner, 21 October 2026: no title block under the bar repeats the trail), then `SettingsLayout` (`header="bar"`) with the body alone, its sections' headings h2 under the bar's h1. Disconnect on Calendars asks first: "Disconnect <account>?", what happens to its meetings and busy times and that it can be connected again, Cancel, then Disconnect, busy while the server works, a refusal shown inside the confirm. Settings opens on Account › Preferences, from the sidebar's foot (Settings, ⌘,), the workspace menu, or ⌘, (Ctrl+, off a Mac) from anywhere but a text field, an editor or a dialog. The routes load lazily, outside the first load. Each page keeps its own copy: `strings.ts` for the frame and the objects pages, `jobs-strings.ts`, `calendar-strings.ts` and `preferences-strings.ts`.

## Settings › Account › Preferences (`/w/$slug/settings/account/preferences`, PreferencesScreen)

- **Purpose**: how the app looks and reads for this person (spec 0026, AC-684).
- **Main task**: pick the theme (Appearance, "Saved on this browser.", kept by the theme controller, spec 0003), then the member's own time zone (searchable, "This browser’s" first), date format (Automatic, 8 Oct 2026, Oct 8, 2026, 2026-10-08, each shown as today reads), week start (Automatic, Monday, Sunday, Saturday) and start page (Home, Tasks, or any live object). Each applies the moment it changes, with no Save; the member's choices go through `data.preferences.change` (shown at once, put back with a toast if refused) and a quiet "Preferences saved" toast with Undo follows once it lands.
- **Leaves out**: the language (the browser's) and the clock's 12 or 24 hours.

The member's preferences are kept per member per workspace on the server (`member_preferences`, `preferences.get` and `preferences.update`, the caller's own only, each change audited). The workspace frame (`routes/w.$slug.tsx`) reads them before its first page and wraps every page in `PreferencesScope` (`features/workspace`), a `FormatScope` over UiProvider's browser defaults: dates, relative times, date pickers, month grids and "today" follow the time zone, date format and week start. Opening `/w/$slug` (so signing in too) lands on the start page (`landing.ts`); Home is the first live object until the Home page lands. Bookings' week starts on the week start (`first-day.ts`). The records layer's relative filters (today, this week), rules, bulk targets and exports resolve in the member's zone (`zoneOf` in `@crm/data`), and so do schedules, new schedules and new pages (`memberZone` in `features/booking/zone.ts`); Bookings' week grid still draws in the browser's zone.

Built from library parts only: SettingsLayout (through `SettingsPage`), SettingsSection ("Appearance", "Dates and time", "Start page") around a Card, SettingsRow and Select (`isLabelHidden`, its label the row's title), Skeleton while loading and EmptyState if the read failed.

## Settings › Account › Security (`/w/$slug/settings/account/security`, SecurityScreen)

- **Purpose**: the devices signed in to this account, and ending them (spec 0033, AC-890, AC-891, AC-896).
- **Main task**: see each device in a table (browser and system, rough place from the edge, last use; this one first, marked This device) and sign one out from its row, or every other one from the Signed in devices section's action at its heading (beside the rows it ends, not at the page bar's end), Sign out of all other devices, with an InfoTip on the 10 minute sign in it needs. Each ending asks first in a danger Modal. A single sign out leaves the table at once (the data layer puts it back with a toast if refused) and says so in a toast; Sign out of all other devices waits in its confirm, and when the server wants a recent sign in (STEP_UP_REQUIRED) the confirm says so in a Callout, its button now Close. After one device's sign out focus goes to Sign out of all other devices while it is still there, so the next sign out is a Tab away; otherwise to the page's title when the button in use went with the change.
- **Leaves out**: two factor and passkeys (milestones 2 and 3), recent activity and new device alerts (milestone 4), and signing this device out (the account menu does).

Two factor sign in sits above the devices (`TwoFactorSection.tsx`, milestone 2): the authenticator app's row (Set up, or Turn off in a danger Modal) and, while on, Backup codes (Make new codes). Set up opens on the QR code (the `QrCode` atom) and the key as text, takes the app's first code, then shows the 10 backup codes once in the code face with Copy and Download, Done only after "I've saved these". Each change, and each device sign out, asks for a step up inline in its own dialog when this session isn't fresh (`StepUp.tsx`: the app's code or a backup code when two factor is on, else an emailed code; turning off and new codes need the second factor itself).

Passkeys sit under two factor (`PasskeysSection.tsx`, milestone 3, AC-887): one row per passkey (its name, or "Passkey"; when it was added and last used) with Rename (a small Modal, saved at once and put back if refused) and Remove (a danger Modal, after a step up: a second factor's while two factor is on, since a passkey signs in alone), then a row to add one ("Add passkey": primary while there are none; off where the browser can't make passkeys). Adding asks for an optional name and a step up in its Modal, then the browser's own prompt; closing that prompt leaves the dialog to try again. With a passkey on the account, every step up offers "Use a passkey" too (`StepUp.tsx`), which counts as a second factor.

At the foot, the danger zone (`DeleteAccountSection.tsx`, AC-902 to AC-907): Delete account opens a danger Modal that first lists the workspaces you are the last owner of (each linking to its Members settings, and nothing can be deleted meanwhile); otherwise it says what happens, reminds you to export first, asks for a step up (the second factor itself when two factor is on) and your email typed in full, then deletes and goes to sign in.

Built from library parts only: SettingsSection ("Signed in devices", its `actions` holding the InfoTip and the danger Button) around a Table (Device, with its rough place after the name so a phone needs no sideways scroll, and a Badge; Last active through RelativeTime, a quiet Sign out per row, the danger confirm carrying the weight; on a phone it scrolls sideways in its own frame), Show more under it, Modal, Callout and EmptyState. The device lines are plain functions in `security-lines.ts`; copy in `security-strings.ts`.

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
- **Layout**: the Configuration tab follows the settings page pattern (SettingsLayout's README): a Names and look section whose Form sits two fields to a row, saved from the library SaveBar at the view's foot (the object's page holds the edits, `useObjectConfiguration`, so the bar shows on either tab and a tab change keeps them; Discard puts back what the server holds), an Identifiers section with the read only API name and object ID, then a Danger zone section (Restore once archived) with the archive Card. The Attributes tab's tables run the full width.

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

Built from library parts only: SettingsLayout (through `SettingsPage`), Table (scrolling sideways in its own frame on a phone), Badge (the status with its state's dot: green Done, blue under way, orange Needs confirm, red Failed; a finished job that handled nothing leaves Progress empty rather than "0 so far"), ProgressBar ("done of total", indeterminate when the size isn't known), RelativeTime, Button, Modal (the confirms, Modal's "When to ask first": a waiting change's Review asks in its own words, "Delete 12,345 people?", saying whose it is when it isn't the reader's, danger for all but a restore, with Not now leaving it waiting; Cancel asks "Cancel “Bulk delete”?" with Keep job; both busy until the server answers, and a refusal, which the jobs store toasts, closes them) and EmptyState (empty, and error with Try again); while it loads, the frame, the header and the Table's skeleton rows hold their places (`JobsPending`). Members see their own jobs without the Started by column, which would always name them, and an "Only yours" badge beside the title says so (the page lost its description to the bar on 21 October 2026); the empty state says what shows here, for everyone or for the person's own. "Run a test job" shows for `jobs.manage` locally and in previews (AC-123): 20,000 synthetic items, every 50th refused, so the bar and the refusal summary both show.

## Settings › Account › Calendars (`/w/$slug/settings/account/calendars`, CalendarScreen)

- **Purpose**: Settings › Account › Calendars (specs 0024 and 0026): the member's own calendar connections, so their meetings reach the people and companies they meet.
- **Main task**: connect a Google calendar (the button carries the Google Calendar mark; the browser goes to the API's start address, on to Google's consent and back with `?calendar=` saying how it went, shown once in a Callout), then manage each connection on its own compact row (the owner, 21 October 2026, as Attio and Calendly list them): the provider's mark, the account, a Default badge with an InfoTip (new bookings go to it), its state as a Badge with a dot (green connected, blue syncing, orange expired, red revoked or failed) and its last sync, Reconnect on the row when it stopped, who sees its meetings (a Select whose Shared and Private choices say what others see), and a "···" menu with Make default and Disconnect. Disconnect asks first; from the confirm the row stays until the server answers (`remove(…, { asksFirst: true })`), and a refusal shows inside the confirm. Owners and admins see a Workspace section with Add people from meetings (a Switch, with an InfoTip and an example).
- **Leaves out**: other members' connections, Outlook (milestone 4), the disconnected banner, the workspace's "Create people for unknown attendees" setting and Add as person (milestone 2).

Its old address, `/w/$slug/settings/calendar`, where the API's Google callback still sends the browser, redirects here with its search (`?calendar=`) kept (AC-686).

Laid out in the settings page pattern (20 October 2026): a Connected calendars section holding the connections in a SettingsGrid (side by side where there’s room; the empty, off, loading and failed states span the page instead), then, for owners and admins, a For the workspace section with "Add people from meetings", a setting for every member that sits on this page because it is about calendars.

Built from library parts only: SettingsLayout (through `SettingsPage`), SettingsSection, SettingsGrid, Card per connection (its account as the title, Google and Default as the line under it, Make default and Disconnect in its footer), DescriptionList (Status as a Badge with the last error, Last synced as a RelativeTime, the sharing control with a line saying what it means), Callout (how connecting went; the limit of 3 reached), Modal (the disconnect confirm) and EmptyState (no calendar yet, with Connect Google calendar; calendar sync not set up; error with Try again). Changes show at once through `data.calendar` and come back with a toast when refused; a connection still syncing is read again until it is done.

## Members (MembersScreen.tsx, InviteDialog.tsx, InviteLinkCard.tsx)

- **Purpose**: Settings › Workspace › Members (spec 0031, AC-803, AC-810, AC-811, AC-818): who is in the workspace, what each can do, and who is invited.
- **Main task**: find someone by name or email; owners and admins change roles with the row's Select (only the roles they may give), remove people from the row menu, invite people by email, resend or revoke open invitations, and share the invite link.
- **Leaves out**: leaving (the workspace menu's), teams and guests (later slices of spec 0031).

The lean pass (the owner, 21 October 2026): the TopBar holds the trail, the page's h1 and its one primary action, Invite people (`SettingsLayout header="bar"`, as the recui lane set for every settings page), and no title block or description repeats them. Tabs (`inset="none"`, so the first tab's label lines up with the table's first column) hold Members and Invitations with counts; the search sits at the strip's end on the Members tab only. A lone member who may invite gets one quiet row under their own ("Just you so far. Invite your team to work together."), not a block. Empty searches and an empty Invitations tab say so in a title alone.

Built from library parts only: SettingsLayout (through `SettingsPage`), Tabs, Field (`variant="search"`, its text in `?q=` once typing pauses), Table (an Avatar and the name as the row header, a You badge on the reader's row, the role as an inline Select (the value and its chevron, no box, so a column of roles reads as text) or plain text, Joined as a RelativeTime, a row Menu with Transfer ownership and Remove from workspace, each only where the reader may; on Invitations a row Menu with Resend and Revoke), Button (Show more members), Callout (for those who can't invite: who can), EmptyState and Modal. Every role picker takes its options from `roles.list` (spec 0037, AC-1439), filtered by the owner rules. Someone else's role changes at once and goes back with the server's reason if refused; a change to one's own role asks first. Every other change waits for the server, then the route reads the page again. While it loads, `MembersPending` draws the same bar (Invite people disabled), the tabs (or the note), the search and skeleton rows.

### The invite dialog (InviteDialog.tsx)

The one invite form (owner, 22 October 2026: "use the same system to add the users across"): `useInvite.tsx` holds the rows, each row's problem and sending, and the library's `InviteRows` draws them; first run's Invite your team uses the same pair. One row per person: an email Field (text, with the email keyboard, so a pasted column keeps its line breaks), that row's role (a compact Select, Member for a new first row, the row before it's role after that) and, with more than one row, a ghost `x` that removes it (nothing is sent yet, so it asks nothing). The columns are named once above the rows, Email, and Role with the InfoTip saying what each role can do (it moved from the dialog's title bar to sit by the pickers). "+ Add another" under the rows (named "Add another person"), or Enter in the last row, adds a row and focuses it; Enter on an empty last row sends. Focus starts in the first email. A pasted list ("a@x.com, b@y.com" or one per line) fills this row and new ones, up to 20; past that, a line says only the first ones were added. Each row says what's wrong under it once left (not an address, already in the list, already a member, already invited); Invite with a bad row focuses it. The button counts the valid rows ("Invite 3 people"); one call per role. If a call fails part way, the rows already handled leave the list and a line says how many, so Invite again retries only the rest. Sent, the dialog says who was invited (announced), who already belongs, and whose email didn't go out, with Invite more and Done.

Every other Invite button opens this same dialog in place (`InviteTeamDialog.tsx`, which reads the person's role, the roles, the members and the open invitations through the data layer once it opens, loading meanwhile, with Try again if that fails): Home's Finish setting up › Invite your team, and Round robin's Invite teammates for someone who may invite (anyone else still goes to Members, which says who can).

### Domain join (EmailDomainCard.tsx, the Join requests tab)

The Invitations tab opens with the Email domain card for holders of `workspace.manage` (spec 0031, AC-819): one SettingsRow whose switch lets people at the reader's own verified domain ask to join ("People at @acme.com can ask to join. You approve each one."); a public or unverified address says why it can't, with the switch disabled. Turning it on waits for the server with the switch on and disabled, the line reading "Turning on for @acme.com" and the card busy, then a toast says it is on. Only the reader's own domain may go on (the server refuses any other, and every public mail domain). While requests wait, a Join requests tab joins Members and Invitations with its count (AC-810, AC-820): Name, Email, Asked (a RelativeTime), and Approve and Decline. Approve brings them in at once as a member and reloads the page; Decline ends their request, so it asks first in the page's confirm ("Decline Grace's request?"), and they are never told.

### The invite link (InviteLinkCard.tsx)

A Card of SettingsRows above the Invitations table, its first row naming it: the switch ("Anyone with the link can join as a member" while off), then while on the link to copy (Field `variant="copy"`, how many joined as its one hint), Expires (never, 1, 7 or 30 days from now) and Most uses (no limit, 10, 25, 50, 100), and Reset link in the footer. Turning it off and Reset end the current link, so both ask first in the page's confirm; every change waits for the server.

### The confirm (MemberConfirm.tsx)

Anything on the page that ends something asks first (the owner, 21 October 2026): Revoke ("Revoke the invitation to grace@example.com?", then "Revoke invitation"), Remove from workspace (its own dialog, below) and lowering one's own role ("Change your own role to Admin?", then "Change my role", which shows `LAST_OWNER`'s sentence for the only owner); and Transfer ownership ("Make Grace Hopper the owner of Acme?", then "Transfer ownership"). A danger Modal (an alert dialog a click outside won't close) with the question naming the thing, one sentence on what happens and whether it can be undone, Cancel (ESC) first and the verb last on a danger solid Button, which spins while the server works; a refusal shows inside it in a danger Callout and it stays open. The page says what happened in a toast once the server agrees.

### The remove dialog (RemoveMemberDialog.tsx)

- **Purpose**: ask before removing someone, saying what it does (spec 0031, AC-814, AC-816).
- **Main task**: read what happens, optionally pick who takes over their open tasks and records, then Remove member.
- **Leaves out**: the removal's rules (the server's), the hand over's progress (Background jobs) and the toast (the page's).

The same danger Modal as the confirm ("Remove Grace Hopper from Acme?", Cancel (ESC) first, "Remove member" last, busy while it runs, a refusal in a danger Callout inside). As it opens it reads `members.removalPreview` and the member list through the data layer, with Skeleton lines while that loads (Remove member waits for it), then one sentence per effect that applies: open tasks assigned to them, records naming them as owner, booking pages that pause with nobody left to host, and calendar connections disconnected. When tasks or records name them, a searchable Select (each person with their Avatar and email, clearable, empty by default) picks who takes them over; the removal then starts a `members.reassign` job and the toast says where their work is going. A failed read says so in a warning Callout and still lets the removal go ahead.

## Settings › Account › Notifications (`/w/$slug/settings/account/notifications`, NotificationSettingsScreen)

- **Purpose**: Settings › Account › Notifications (spec 0038, AC-1179): what reaches the member by email from this workspace.
- **Main task**: turn email for Mentions, Replies and Task assignments, and the daily digest, on or off; each switch saves at once and is put back with a toast on a refusal.
- **Leaves out**: the in app inbox (always on, said in the Email InfoTip), other workspaces' settings, push notifications.

Lean, as the owner's settings pages are: no page description, one Email section like every other settings page's (its heading above the card, its line saying the inbox always gets every notification, AC-1179, and an InfoTip on what an email holds) with short rows, Mentions, Replies, Task assignments, and Daily digest with its own InfoTip. Built from SettingsLayout (through `SettingsPage`), Card, SettingsRow (its `info` slot), Switch and InfoTip, with no new component. Each switch saves at once through `data.inbox.setSettings` and is put back with a toast on a refusal, as Calendars' switch is. The settings follow a change made in another tab live (AC-1180). Turning the digest on sends the browser's time zone with it, for 8 in the morning there. Once the bar header lands (wip/recui), the title sits in the top bar like every settings page.

## The finish toast (toast.ts)

- **Purpose**: tell the person when a job they started in this browser ends while the app is open (AC-119).
- **Main task**: say how it ended ("Test job: Done", "Test job: Done, 6 refused", "Failed", "Cancelled"), with View, which opens the Background jobs page.
- **Leaves out**: jobs started elsewhere, and notifications that outlive the tab (#28).

## Notes

- Every write here waits for the server (definition writes are never optimistic): the button spins with its ongoing verb, a refusal lands on the field it names (`NAME_TAKEN` on the name, `SLUG_TAKEN` and a reserved API name on API name) or in the form's banner, and once a write lands the data layer reads the objects again and every page reloads, so the sidebar and this page show the change, as every other member's do.
- Members open every page read only: no New object, meter, handles, Archive or SaveBar, a quiet Callout saying only owners and admins can change objects, and the row menu holds Open alone. The server refuses them 403 anyway.
- States: while a page loads its header and rows hold their places (skeletons); a failed read shows an EmptyState with Retry in place of the page's body, and the navigation stays usable. An unknown object or tab says so inside the frame, with the way back to Objects.
