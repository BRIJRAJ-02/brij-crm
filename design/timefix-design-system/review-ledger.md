# Prototype review ledger (10 Nov night)

State at 22:15 IST: blockers all fixed; open items below are majors and minors still to do (zones K6/K7, offered times K9, Reports per tab, more form templates and layouts, link page blocks, Bookings' own sidebar outside the app).

The owner wants a foolproof, full prototype: every screen and every flow, each format (team, salon, restaurant) from onboarding, easy to understand, links integrated. Four reviewers read the prototype; their findings are listed here with their state. `[ ]` means open and `[x]` means fixed.

## Known before the review
- [x] Trash keeps deleted records; restore, delete for good (confirm), empty trash
- [x] History reads real changes (deletes, restores, imports, purges)
- [x] Record page: Files tab (drop, download, delete + Undo), notes open in place, reactions saved
- [x] Bulk Add to list really adds (pick a list, "already there" count, Undo)
- [x] Companies import (matched by domain)
- [x] Custom objects: a records table
- [x] Links hub: everything you share in one place (your page, booking pages, forms, menu), with copy, QR, open and numbers
- [x] Insights read real data (form responses, meetings)
- [x] First run picks the format (team / salon / restaurant) and lands in the right workspace
- [x] Phone walk of every module (More page, Settings list then page, each format)

## Shell, Settings, doors (reviewer 3)
Blockers:
- [x] B1 Phone: no way to reach Bookings pages other than Meetings, Lists, custom objects, the workspace menu or Sign out
- [x] B2 Member role change says Saved and snaps back
- [x] B3 Remove member and revoke invite only show a toast
- [x] B4 Home's "bring back from Preferences" switch does nothing

Major:
- [x] M5 ⌘K to a record from Import or Duplicates goes nowhere (`sub` isn't cleared)
- [x] M6 Settings state is lost when you move (switches, two factor, calendars, apps, grants)
- [x] M7 "Saved" with no effect:
  - [x] theme
  - [x] names (sidebar)
  - [x] Saved shown on blur
  - [x] business apps not affecting Bookings
  - [x] sign-in rules
- [x] M8 Fake controls:
  - [x] Upload logo
  - [x] New team; teams can't be renamed or deleted
  - [x] the workspace menu's Workspace settings
  - [x] the person menu's Profile and Sign out
- [x] M9 Confirmations: sign out of other devices (and remove them from the list), two factor off, sign out
- [x] M10 Two factor setup takes an empty code; no step-up; backup code takes anything
- [x] M11 Delete account: list the workspaces where you're the last owner, step-up. Delete workspace leads to the deleted screen with Restore.
- [x] M12 ⌘K:
  - [x] New person and New task should open their dialogs
  - [x] New booking page should open create
  - [x] "Create person '<query>'"
  - [x] Recent
  - [x] search notes and tasks
  - [x] Go to Companies, Deals, Lists and objects
- [x] M13 Sidebar "+ New object" should open the New object dialog
- [x] M14 Settings at phone width: the nav squeezes the content
- [x] M15 Workspace switch only changes Bookings; "Northwind" is hard-coded in Settings
- [x] M16 Doors aren't modal (focus, Escape, ⌘K)

Minor:
- [x] m17 App switch aria labels
- [x] m18 ⌘, ? [ shortcuts not bound
- [x] m19 Go to Settings keeps the old start page
- [x] m20 Tab bar: waiting badge, highlight for every page
- [x] m21 Settings › Bookings routing link for businesses
- [x] m22 Settings › Lists rows open, rename, delete
- [x] m23 Billing appears in role powers; main has none
- [x] m24 Doors:
  - [x] restore confirmation
  - [x] "back to workspaces"
  - [x] "make my own" should go to welcome
  - [x] email preferences confirm when saved
- [x] m25 First run's answers are thrown away

Missing flows:
- [x] Flow 1: new person → welcome; expired session; sign-in error banners
- [x] Flow 2: full page asking to set up two factor (revoke one device done)
- [x] Flow 3: Create workspace
- [x] Flow 4:
  - [x] invitation states: wrong account, used link
  - [x] invite link options
  - [x] domain requests
  - [x] lowering to Guest confirms with counts
  - [x] transfer ownership, leave workspace
  - [x] remove with counts and reassign
  - [x] team delete with Undo (refusal when a round robin uses it: open)
  - [x] object access and Preview as
  - [x] guest empty screen
- [x] Flow 12: customise the sidebar
- [x] Flow 13: Developer (API keys done); Partner connect and disconnect

## Records, Lists, Import (reviewer 1)
Read the code before trash, files and add-to-list landed; those items are marked fixed.

Blockers:
- [x] R1 Editing Close date in the panel crashes (string stored where a Date is read)
- [x] R2 Bulk Add to list only toasts (fixed: pick a list, really adds, Undo)
- [x] R3 List settings eat commas and trailing spaces while typing stages

Major:
- [x] R4 Undo restores a stale whole-app snapshot (bulk delete, merge, import), losing later edits
- [x] R5 Deleting a record leaves broken references: list entries hide until restored, the panel closes, links open the Trash page with Restore
- [x] R6 "Deleted" detected by name prefix; real deleted state has no Restore
- [x] R7 Back from a record always lands on the object list and resets its view, search and selection
- [x] R8 ⌘K can't open a record from Import or Duplicates (same as M5)
- [x] R9 Re-import wipes owner and tags on matched people
- [x] R10 "Undo this import for 7 days" is false
- [x] R11 Renaming or removing a list stage hides its entries; empty stages leave no columns
- [x] R12 "Not a duplicate" forgotten; callout counts pairs as people; "1 people"
- [x] R13 Merge drops comments, activity, list entries, inbox, form responses; can't pick company
- [x] R14 Fake buttons:
  - [x] Email on the record page
  - [x] opening a note (fixed)
  - [x] comment reactions (fixed)
  - [x] Companies import (fixed); Deals import hidden until it exists
  - [x] list empty state points to a missing Lists section
  - [x] custom object page promises add and import
  - [x] ⌘K New person
- [x] R15 Board column "+" ignores the column

Minor:
- [x] switching views drops unsaved changes silently
- [x] selection survives search and filter (hidden rows get deleted)
- [x] Clear filters creates a draft view from search alone
- [x] list headers look sortable but aren't
- [x] "Moved to X" after a reorder in the same column
- [x] Industry select vs free text; record page lacks Owner and Company; edits there have no Undo; Close date UTC drift
- [x] plurals ("1 deals", "1 people", "1 rows"); "Import 0 people" enabled
- [x] stray separators fixed; new deal without company still allowed
- [x] import: no Back from Match, `.CSV` refused, read errors, quoted cells
- [x] Add to list dialog empty with no message
- [x] list delete Undo moves it to the end
- [x] long text not truncated (list title fixed; related rows, merge names open)

Accessibility:
- [x] merge buttons have role="cell"
- [x] focus lost after bulk action and list delete
- [x] panel says ↑/↓ but uses J/K
- [x] no ⌘Z for cell edits; bad email accepted
- [x] list title is not a heading

Missing flows:
- [ ] §5 New badge on the new row, Create '<query>' in ⌘K, edit clash, add attribute
- [x] §6 View menu (rename, duplicate, delete, default, group by), footer sums, fold board columns, add stage, bulk Set/Clear and Stage, select all matching, duplicates for companies, archive lists, add to list from a record
- [x] §7 Import dates, new attribute from a column, new option, export hidden columns
- [x] §8 Record page Delete with Undo, Restore and merged banners, Lists in details, task dialog, resolve comments, mentions to Inbox
- [x] States: loading, error, read only, no access

## Home, Inbox, Tasks, Notes, Forms, Link page, Insights (reviewer 2)
Blockers:
- [x] F1 Responses reach People by email field, not fixed ids; auto-file when "Save to People"; match by email (no duplicate person)
- [x] F2 Form undo uses fresh state (no stale whole-form restore)
- [x] F3 Link page edits and saved reports kept in app state
- [x] F4 Inbox Done: no 5s timer loss, single Undo, "Move to inbox" wording in Done

Major:
- [x] H5 Checklist ticks only when the step is actually done; Import opens the importer; Invite opens Members
- [x] T6 Tasks: done tasks reachable when nothing is open; group counts exclude done
- [x] T7 Task due date drifts a day (UTC parse)
- [x] N8 Notes:
  - [x] the last edit is lost on Back
  - [x] no delete
  - [x] empty untitled notes are kept
- [x] F9 Forms draft:
  - [x] every setting counts as an edit
  - [x] a form with no questions can be published
  - [x] Preview of a draft records real responses
- [x] I10 Mark all read ignores the filter
- [x] K11 ⌘K New task and New person open their dialogs (see M12)
- [x] X12 Fake or misreported:
  - [x] Join
  - [x] copy that fails still says copied
  - [x] Insights share link and numbers
  - [x] Home "won this quarter"
  - [x] Forms results invented
  - [x] "Book a meeting" after sending never sends the visitor anywhere
- [x] D13 Dead ends: the sidebar can't leave an open editor, note or preview; Back after "Open person" lands on People

Minor:
- [x] inbox empty state when filtered
- [x] pluralisation
- [x] paused page names the owner
- [x] empty form name or link accepted
- [x] the open response stays when switching to Spam
- [x] Results empty state
- [x] Undo of a form delete changes its order
- [ ] Home loading state
- [x] Home: adding a task when caught up
- [x] Home: task overflow
- [x] a tick is lost when leaving quickly
- [x] deal chip icon

Accessibility:
- [x] Home agenda rows can't be opened
- [x] response list semantics
- [x] Enter doesn't save a task
- [x] double Inbox heading
- [x] unread count in the tab title

Missing flows:
- [x] Inbox:
  - [x] Due today filter
  - [x] a mention opens its thread
  - [x] a booking notice opens that booking
- [x] Forms:
  - [x] 11 templates
  - [x] map questions to attributes
  - [x] logic sentences
  - [x] Discard asks first
  - [x] "Live · edited" on cards
  - [x] countdown into booking
  - [x] retry
  - [x] sync earlier submissions
  - [x] search
  - [x] subtitle
  - [ ] Classic, Steps and One-at-a-time layouts
  - [x] Desktop and Phone preview
  - [x] 50-question cap
- [x] Link page:
  - [x] writing, FAQ, testimonial, form and signup blocks
  - [x] title fetched from the link
  - [x] delete asks first, plus archive
  - [ ] team pages
  - [x] handle from the workspace
- [ ] Insights: one-page picker, all time and custom range, comparison, drop-off, sessions
- [x] Reports:
  - [x] object and filter choice
  - [x] a tab per report
  - [x] rename and delete
  - [x] reach from Home and ⌘K
- [x] Home:
  - [x] link page section
  - [x] team metrics
  - [x] Reports link
  - [x] sections hideable from Preferences

## Bookings, restaurant, salon, menu (reviewer 4)
Blockers:
- [x] K1 Share links and QR use handle "priya" for every workspace (share, embed, offered times, one-time links, create)
- [x] K2 Several guest bookings in one session double-book (pending only reaches state on close; same table; host[0] fallback)

Major:
- [x] K3 Profile page bookings: guest changes never reach the host
- [x] K4 Manage booking ignores cut-offs
- [x] K5 Reschedule keeps the old round robin host even if busy
- [x] K6 Cut-offs wrong when the guest picks another time zone
- [x] K7 Chat booking shows the wrong time in another zone; minutes can pass 1440
- [x] K8 Week view drag ignores other meetings, time off, busy and past
- [x] K9 Offered times can be booked twice
- [x] K10 Walk-in offered a table whose party has run over
- [x] K11 Olive seed double-books T3; Confirm doesn't re-check
- [x] K12 Walk-ins between services vanish from the List
- [x] K13 Sold out from the dish drawer waits for Publish
- [x] K14 New tables get no QR code; names unencoded; handle change breaks printed codes silently; empty handle
- [x] K15 Inline Undo of a cancel still says "Guest emailed"; two Undos
- [x] K16 Undo of a page delete leaves routing re-pointed

Dead or fake:
- [x] Add to link page (toast only)
- [x] Add to calendar only flips a label
- [x] Insights share link never copies
- [x] Bookings' own sidebar Home/Inbox/People/Forms, workspace menu, Profile, Sign out
- [x] Join toast only
- [x] Waitlist "Text: table ready" with no phone
- [x] Chat suggestions return wrong days
- [x] Standalone chat on a confirm-first page shows booked

Missing states:
- [x] closed day offers the waitlist
- [x] date-only hour changes ignored for open/closed and services
- [x] team day fixed 8:00–20:00
- [x] "A request waiting" demo time made up
- [x] floor view free table on another day opens an empty menu
- [x] past reservation date select blank
- [x] online waitlist "hoping for" empty
- [x] re-seated no-show shows 0 min
- [x] hidden-page email always @northwind.com
- [x] business page "Not live" has no publish; guest page ignores published
- [x] tables can't be renamed or deleted

Accessibility:
- [x] VenuePage tablist without tabs
- [x] MenuPage smooth scroll ignores reduced motion
- [x] Team day keyboard can't set length
- [ ] menu reorder only via menu items


## Second pass (10 Nov)
Everything above is closed except these, kept on purpose or left for the build:
- [ ] Forms "Steps" layout (Classic and One at a time are built)
- [ ] Team members' own link pages (needs per-person data; the workspace link page is built)
- [ ] Visits and traffic sources in Insights (no visit tracking in a prototype; bookings, answers and form opens are real)
- [ ] Edit clash "use mine" (needs two people editing at once)
- [ ] Menu reorder by drag (Move up/down in each row's menu, keyboard friendly)
- [ ] Home loading skeleton (records lists have one)

A second review round (four reviewers) ran after this; its findings and the improvement pass follow.

## Improvement pass (10 Nov, late)
Small changes on every screen, inside the current design language:
- [x] Shell and settings: profile photo (with Undo), the Calendars page lists real calendars, the only owner is offered "Make someone else owner" before leaving or deleting, sign-out names the workspace, a restored item opens from its toast.
- [x] Tasks: an empty "Mine" offers "See everyone's tasks"; New task from a record links it.
- [x] Records: board columns show their total value; one "More" menu with separators; an empty table offers Add or Import; New person checks the email and warns about a known email or domain.
- [x] Forms: the builder preview follows the logic; mapping and logic sit behind "More options" (open when set); the question count shows only near the 50 limit; Results are grouped per question with answer counts.
- [x] Links: each row has a direct Edit button. Insights: Share copies the current tab, range and filter.
- [x] Bookings: Reassign names why someone can't take it (away, not working, at a limit, another meeting, calendar busy); the guest's Manage page gives the change deadline as a date and Add to calendar; a closed venue says when it opens next; floor tiles read "Free until 7:30 PM"; late parties' tables free up after the late hold; the service header shows the busiest start time against pacing; salon staff tiles show their next free time; the salon confirm step states the change policy; the rating has a spoken label.
- [ ] Home stats that open their screen (StatCard has no press state yet; left for the build)

## UI sweep and every setting (10 Nov, night)
Owner: "new pages don't look polished as bookings" and "make sure all settings are there".
- [x] Every page is full width with Bookings' 24px gutter (Home, Inbox, Tasks, Notes, records, record page, Forms, Links, Insights, Import were capped in a centred column).
- [x] One toolbar on every list page: search, a quiet count, one ink action (Notes and Links gained search; Links lost its intro line). Section labels match Bookings.
- [x] Bookings pages inside the app use the app's own top bar action (Search); the app's Inbox already carries booking notices, so Bookings' bell is gone there.
- [x] Record page: a bigger name, Email and More on the name row, no floating icons.
- [x] Home: finished setup steps fold into "5 done". Insights: chart dates never overlap; "up from 0" instead of "New".
- [x] Settings now lists every setting the real app has (checked against origin/main's settings routes):
  - Account: public profile (page link, bio, social links), time zone, date format, week start, a Replies email, backup codes (new set, copy, download), recent sign-ins, and a full Calendars page (connect, reconnect, disconnect with Undo, per calendar: show on my week, log meetings to the CRM, colour; where bookings land, what teammates see, add people from meetings, sync now).
  - Workspace: time zone, how long form answers are kept, a web address check (taken names) with a confirm before moving; Brand as its own page (logo, colour, dark colour, Classic/Studio/Night/Split look, live preview); invite link "most people" cap; team access per object; custom roles (new, duplicate, delete, default for new people, up to 20), data and scheduling powers, sign-in length, sign out everyone; connected apps show when they last called and can change access; History has a Sign-ins tab; Imports and exports lists every CSV and downloads exports again.
  - Scheduling: Availability, Round robin, Routing (what's set now, then the page in Bookings) and Scheduling access (who sees mine, who changes each person's hours, applied in Bookings).
  - Business (salon and restaurant only): business page, services or table bookings, staff and shifts, places and tables, menu.
  - Data: Objects have Configuration (names, API name, colour, record name, archive) and Access tabs; Lists have Settings (stages, each record once).
- [ ] Google photo sync on Profile (needs a real Google connection; left for the build).
- [ ] Member table columns (joined, two factor, calendar): TeamList has no column API yet; left for the build.

## Owner round, 11 Nov (Tasks, banners, forms, research)
- [x] Task rows: the record and day as plain grey text (red when overdue), the open arrow only on hover; Completed is its own open section at the bottom of Tasks.
- [x] Notes cards no longer run under each other; banners line up (the clash banner had a stray padding) and run full width with the action on the same line.
- [x] Form builder: the question settings stay beside the list (never under it), rows shrink instead of overlapping, the duplicate "Questions N" heading is gone, Required shows as a quiet word.
- [x] Question type picker: grouped (Text, Choices, Scores, Dates and times, Files and agreement, Layout and data) with type-to-find; Enter adds the first match.
- [x] Eleven new question types from the live app and industry: Website, Number (lowest/highest), Checkbox, Yes or no, Country, Time, Date and time, Scale (0-10 with end words), Hidden field (filled from the link), Consent (terms or marketing), Statement.
- [x] Forms › Records (new tab): what each response becomes (a person, company, deal or an owner-made object), how it finds the one to update (email, phone, domain, name), which field each answer fills (or a new field made from the question), tag with the form's name, open a deal for each new person, add to a list, and a plain sentence of what happens. A visitor's answer now files the person, their company and the deal (walk rt/formr.mjs).
- [x] Forms settings: last button's words, stop on a date or after N answers with a closed message, email each response to a member, a confirmation email to the visitor, and "Go to a website" after sending.
- [x] Forms share: QR code, and every question's link key with an example link that opens the form filled in (hidden fields read theirs from it).
- [x] Booking pages in a restaurant or salon also list meeting pages (New meeting page), so a business can take calls and visits without switching workspace; New service now makes a service.
- [x] Dish drawer: the photo has its own row (the drop zone was squeezed into a narrow column).
- [x] Restaurant: late parties keep their table; the host stand says who is late and offers No-show (a change earlier the same night released tables silently; industry and checklabs alert the host instead).
- [ ] Research for every module is in research/ (records, forms, restaurant, salon, meetings, links-insights, home-inbox-tasks-notes). Next waves, in order: Forms (responses table and export, analytics drop-off, endings, look), Restaurant (guest profile, shifts and pacing per 15 min, turn by party size, min party per table, waitlist history, reminders), Records (column menu, footer calculations, group by, board on any object, change timeline, related sections, deal probability and time in stage), Salon (service variants with prices, front-desk statuses, client record, service form), Meetings (guest time zone detection and full list, cancel reasons, longer notice and window, fixed plus rotating hosts), Link page and Insights (unpublish, booking block bound to a page, per-link clicks), Home/Tasks/Notes (several linked records, due time and reminders, notes keep formatting, delete asks first).

## Owner round, 11 Nov, batch 2 (modules doubled down, references)
- [x] Forms: duplicate form (a draft without responses), CSV export of responses (also listed in Settings › Imports and exports), previous/next inside a response, latest written answers on Results.
- [x] Restaurant: late parties raise a host alert with No-show (no silent release); "Fewest guests" per table so a couple doesn't take the 8-top online; where each booking came from (online, phone, walk-in, waitlist); waitlist keeps who was seated or left, with the average wait; returning guests read "3rd visit · 1 no-show before".
- [x] Records: deals carry a chance per stage, a weighted amount and days in stage (columns, board card, side panel); a deal with no move in 21 days reads Stale on the board; column totals show the weighted value; every field change lands on the record's timeline; column totals shrink so the add button always fits.
- [x] Salon: the booking asks for a mobile (reminder texts), Name across the top, Email and Mobile side by side; booking pages in a business list meeting pages too.
- [x] Meetings: the guest's own time zone is detected and offered first, with 21 zones; cancelling from a meeting asks first, with a reason and a note to the guest, and keeps who cancelled; minimum notice up to 2 weeks, booking window up to a year.
- [x] Link page: Take offline / Put back online (asks first, with Undo).
- [x] References (research/references-11nov.md): Tasks groups fold by their caret; Home numbers show the change against last week; Team day is a staff calendar (the workspace's real staff, bookings tinted by where they stand with a chip, service tag, striped breaks, hatched hours they don't work, a now line, the day's count); the link page, form page and booking rail have a cover band with the face or logo overlapping it.
- [ ] Still to do from the research: Forms analytics and drop-off, endings with buttons, look options; Restaurant shifts and pacing per 15 minutes, turn time by party size bands, guest profile notes carried forward, reminders; Records column menu, footer calculations, group by in the table, board on any object, related sections; Salon service variants with prices, Arrived and Started, client record, a service form for New service; Meetings fixed plus rotating hosts; Insights per-link clicks; Tasks several linked records, due time; references: Forms summary and publish settings card, setup steps rail, quick-create popover on the week.


## Owner round, 11 Nov, batch 3 (references applied, more depth)
- [x] Notes keep their formatting (the editor's document is saved, not flattened to text); Notes and Links have search.
- [x] Tasks: a time as well as a day ("Today 3:00 PM"); Inbox "Mark all done" with Undo.
- [x] Home: "Recently viewed" records; Forms: a summary card in Settings; Insights: form views with the answered rate; Links hub shows clicks.
- [x] Records: a board for every object (deals by stage or owner, companies by industry, people by owner), with weighted totals in the summary.
- [x] Public page headers (reference): link pages have a cover band with the avatar over it; booking pages have a cover strip on the wide layout; a link page's Booking block picks a real booking page.
- [x] Team day (Zendenta reference): headers show each person's count and the day total; breaks, closed hours and a now-line; Arrived, Start and Finish on a service visit today ("Here", "In progress").
- [x] Salon: a price per length (a 45 min cut ₹1,200, 60 min ₹1,500); the list reads "from" the lowest, the guest's total follows the length they pick. Returning guests get their last stylist when free; a closed venue says when it next opens.
- [x] Restaurant: turn time by party size bands in the editor.
- [ ] Still to do: Forms analytics and drop-off, endings with buttons, look options; Restaurant shifts and 15 minute pacing, reminders, guest profile; Records column menu and related sections; salon client record; meetings fixed plus rotating hosts; tasks linked to several records; setup steps rail and the week quick-create popover (references).

## Owner round, 11 Nov, wave 4 (forms results, column menu, references)
- [x] Forms › Results: "Where people stop" (Tally's drop-off): starts, each question's reach as a bar, the biggest drop flagged "Most leave here", and how many sent it; visits to the live form count views and reaches. "Of views" shows a decimal when under 1%.
- [x] Forms › Settings › Say thanks: an optional button under the message (words + link, opens in a new tab; hidden until the link is valid).
- [x] Records: a column menu on every header (Attio): Sort ascending/descending, Filter by this (opens the filter at that field's operators), Hide column with Undo, Edit field (Settings › Objects). The first column can't hide; the caret floats so names keep their width.
- [x] Business page (profile header reference): the photos are the cover, the logo (or initials tile) overlaps their edge, then name, kind and the meta line; at phone width the meta line drops its dots.
- [x] Week view (Totoro reference): a picked time opens a quick create: who it's with, then Book (or More options for the full dialog); Block, Hold and Time off stay below. Same on Team day.
- [x] Tasks can be about several records: "Also about" in the task, "+1" on the row, and the task shows on each record's page (merges carry the links over).
- [x] Library fix: Switch, Checkbox and Radio keep React Aria's hidden input inside the control; before, a Switch low in a scrolling pane stretched the whole page (found on Forms › Settings). A sweep now checks no screen or tab makes the page scroll.
- [x] Forms publish fix: visitors to a live form get the published after-send settings (thanks, button, booking, website), not the draft; a live form without a stored baseline (the seed) gets one when opened, so its settings edits wait for Publish and show "Edited, not published".
- [x] Setup steps rail (reference): onboarding already uses Steps with done ticks and the current halo; kept the approved split layout.
- [ ] Next wave: restaurant guest profile, salon client record, forms look options, restaurant shifts + 15 min pacing, meetings rotating hosts; marketing candidates (frosted rim, dot chart, boxed labels, dot week).

## Wave 5 (11 Nov)
- Guests (restaurant) / Clients (salon): BookingsFlow `guests.tsx`, `guestsOf`/`guestKey`/`guest/patch` in state, seeded history and profiles; opens from reservation row menu and salon booking drawer. Walk w5guests (light, dark), phone check w5phone.
- Fix: stats strip collapsed to 0 height in the drawer's flex body (flex-shrink 0).
- Chart: BarChart `look="dots"` (marketing dot columns), used on Insights per day and Bookings Insights. Walk w5dots.
- Fix: guest manage page showed the default cut-off line and the host's own too-late message together; the host's message now stands alone.
- regress "manage move" fails before ~10:00 local because the seeded 10:00 booking is inside the 4 hour cut-off; correct behaviour, time-dependent walk.

## Wave 6 (11 Nov)
- Restaurant shifts: `shifts` per table page (Lunch/Dinner/Service: own pacing, last seating), `shiftsOn`/`pacingAt` in state, editor rows behind a switch, PaceStrip under each shift on Reservations. Walk w6shift.
- Always joins: `alwaysWith` on round robin pages, `coHosts` on meetings, `isWith` used for clashes, limits, team day, roster; drawer says "with". Walk w6rr.
- Record Meetings section (person by email or name, deal contact, company people), opening the booking. Walk w6rec.
- w5guests dark flaked once under load, passed on rerun. regress "manage move" still time-dependent (before ~10:00).

## Wave 7 (11 Nov)
- Owner: task row hover was a box inside the card. TaskList `isFlush`; Tasks page cards drop their padding and clip, so hover fills the row.
- Form looks: AppForm `look` (published with the form), Look button in the preview bar opens GuestLook (`isPreviewHidden`) in a Popover; HostedForm `look` via `guestLookProps` (data-theme + accent as primary/accent, face). Walk w7look (incl. publish + visitor view).
- Reminders: REMINDERS (week, day, 2 h, hour), `remindByText` for service/table pages, sample text under the setting, drawer lists sent/next reminders (`remindersFor`). Walk w7remind.
- Dot week dropped: no real empty/loading moment in the week view to put it on.

## Wave 8 (11 Nov)
- Lost reasons: TimefixApp watches records/fields for deals moving to Lost (any screen) and asks once (LostReasonDialog in deals.tsx, Skip allowed); deal page shows Lost reason/note; timeline logs them.
- Meeting outcomes: past team meetings get How did it go? (Qualified, Follow up, Not a fit) in the drawer; record Meetings tag it.
- Table blocks: tableBlocks + tableblock/add|remove, heldTables treats them as taken (bookings, walk-ins, online), Floor tile/menu, BlockTableDialog warns about bookings on the table.
- Fix: board column names were squeezed to "L…"/"Qu…" by long amounts; title no longer shrinks.
- All walks green both themes (regress passes after 10:00). Walk w8.

## Wave 9 (11 Nov)
- Owner reference (Osmo opening hours): OpeningHours in VenuePage (live Open/Closed pill with closes/opens time, re-checks each minute and on tab return, today row aria-current, each range on its own line, closed days quiet). Classes tf-ophours (tf-hours belongs to HoursEditor; the collision check caught it). Walk w9hours.
- Tasks: priority (high flag, high first) and repeat (next task added on tick, once). Walk w9task.
- Owner reference (Osmo events calendar): held. Restyling the booking calendar touches every booking page; asked owner: embed restyle vs events calendar.
- Moved to wave 10: inbox snooze, Insights share link controls.
- Calendar embed (owner: "whatever is best"): BookingFlow month days become rounded-square tiles, today a dot, nearly full days (1-3 left) carry a corner count read as "N times left"; BookingPagePicture and GuestLook preview days match. Walk w9cal. regress "taken clears" needs two free times today: fails after ~11:00 (minimum notice), time-dependent like "manage move".

## Wave 10 (11 Nov)
- Inbox snooze: NotificationList onSnooze + snoozeTimes (later today rounded to the half hour, tomorrow 9, next Monday 9); InboxItem.snoozedUntil; Snoozed box with "Back …" times; comes back unread; Undo. Walk w10.
- Insights share: AppState.insightsLink (key, expiry 30 days or none), ShareInsights popover with Copy and Stop sharing (Undo). Walk w10.
- regress made clock-proof: manage move accepts the cut-off refusal; taken clears books a day ahead. Full suite green at 12:14.

## Wave 11 (11 Nov)
- Table requests: MenuPage onRequest/requested (Call a waiter, Ask for the bill from a table's QR), BookingsState.tableRequests + request/add|done (one open ask per kind per table), Reservations asks strip (Done with Undo) and Floor tile tags.
- No-show rebook: a no-show's drawer offers Send a link to book again once, logged on the meeting.
- Note templates: NOTE_TEMPLATES + noteFromTemplate (Meeting, Call, Discovery), Start from chips in New note.
- A machine restart wiped the scratch folders mid-wave 12: wave 11's source was re-applied from the session record; its artifacts had already been published (Timefix v23, Bookings v51, Business v25, DS v46).

## Wave 12 and cleanup (11 Nov)
- FilterBar and/or (`match`, `onMatchChange`; the word between chips switches it), SavedView.match; records apply some/every.
- DataGrid `onAddColumn` ("+ Add a field"), opening Settings straight on that object's attributes (`objects:<id>` start).
- Bug: "+ Filter" closed after the first pick (a menu inside a panel closes it on action). MenuList `keepOpen` for the field and operator steps.
- Bug: hidden screen-reader labels (`.tf-sr-only`) were placed against the page, so restaurant Availability made the window scroll 21px. Pinned to top/left of the containing block in base.css.
- Home "Copy link" no longer invents a meet.google.com address (uses the meeting's Timefix link like the drawer). Link page sign-up says what signing up means.
- Walks rewritten after the restart (walks/): smoke covers 58 pages per theme across team, salon and restaurant plus Bookings and Business; w11req, w11more, w12. All green both themes. Published Timefix v24, Bookings v52, Business v26, DS v47.
