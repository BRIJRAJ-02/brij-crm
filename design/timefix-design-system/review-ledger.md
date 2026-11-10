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


## Second pass (11 Nov)
Everything above is closed except these, kept on purpose or left for the build:
- [ ] Forms "Steps" layout (Classic and One at a time are built)
- [ ] Team members' own link pages (needs per-person data; the workspace link page is built)
- [ ] Visits and traffic sources in Insights (no visit tracking in a prototype; bookings, answers and form opens are real)
- [ ] Edit clash "use mine" (needs two people editing at once)
- [ ] Menu reorder by drag (Move up/down in each row's menu, keyboard friendly)
- [ ] Home loading skeleton (records lists have one)

A second review round (four reviewers) ran after this; its findings and the improvement pass follow.
