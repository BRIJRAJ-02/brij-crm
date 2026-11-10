# Timefix app inventory (origin/main, 10 Nov 2026)

Everything the web app has, by module, to rebuild the whole app in the design-system prototype in the new design language. Bookings, restaurant (host stand, menu, table QR) and salon are already built in the prototype.

## Sidebar (per member: hide, move, fold, Customise › Reset)
- Header: workspace menu (workspaces, Create workspace, Keyboard shortcuts, Leave workspace, Sign out); collapse to a rail with `[`.
- Fixed: Home, Insights.
- Sections, in the member's order: Records (objects), Lists, Scheduling (Bookings and Captures), Business (only when its apps are on).
- Top pages: Link page, Inbox (unread badge), Tasks, Notes.
- Foot: Settings (⌘,), Help and shortcuts (?).

## Modules
1. **Home**
   - Greeting and a setup checklist.
   - Sections in a registry, some hidden from Preferences: Today agenda, link page, My tasks, metrics, team metrics.
   - Link to Reports.
2. **Insights**
   - Covers forms, booking pages and link pages.
   - Picker for kind or page; ranges of 7, 30 or 90 days, 12 months, all time or custom, compared with the period before.
   - Tiles, visits against finishes, finish rate, where people drop off, sources, sessions.
   - Export CSV; Share makes a link. Public page `/public/insights` shows the numbers only.
3. **Records (objects)**
   - Views:
     - Table or Board, with sort and filter chips; Save, or Discard with Undo.
     - View menu: rename, duplicate, copy link, reorder, share or make private, lock.
     - Create view; a clash dialog when the view changed; Group by.
   - Grid editing:
     - Inline edit, paste, ⌘Z.
     - Add, edit or archive columns; create an option inline.
     - New record, with "Create more".
   - Bulk bar:
     - Tick rows or select all matching.
     - Edit (Set, Clear, Add, Remove, Replace), Delete with Undo, Add to list.
     - Large jobs: count, review, confirm, progress, Cancel.
   - Import / Export. Object ⋯ menu: Open trash, Find duplicates.
   - Record page:
     - Tabs: Overview, Activity, Notes, Tasks, Comments, Files.
     - Details sidebar with inline edit and the record's lists.
     - Related sections, Log activity (call or meeting), merged-record banner.
   - Record panel: `?record=`, with Previous/Next (↑/↓).
   - Import: CSV, map columns, fix values, preview, start. A summary page has a 7-day undo.
   - Duplicates: a list of pairs and a side-by-side merge.
   - Archived object, with Restore.
4. **Lists**
   - New list: Name, Of (which object), Pipeline or Blank.
   - Entries in a table or board with the list's own fields; cards drag between stages.
   - Add entry; bulk actions with Undo; list import; archived list with Restore.
5. **Scheduling**: Bookings (done in the prototype).
6. **Captures**
   - Two tabs, Links and Forms.
   - Forms list: a card grid with Search and New form.
   - Form editor:
     - Status: Draft, Live, Live · edited, Paused. Copy link, Preview, Publish.
     - Form tab: title and subtitle; Layout (Classic, Steps, One at a time); 20 answer types, up to 50 questions; logic rules written as sentences; "After they send" rules.
     - Settings tab: name, link, Save answers to (which object), owner.
     - Share tab: link, three embed styles, a prefill link.
     - Submissions tab: table with a side panel, review states, Add to CRM, Delete with Undo.
     - Analytics tab.
     - Sync earlier submissions; Desktop or Phone preview.
   - Public pages: `/f/<address>` and the embed.
7. **Business**: menus, tables and QR, reservations (done in the prototype). Shown only when its apps are on; a switcher for workspaces with several businesses.
8. **Link page**
   - Block editor (booking page, link, heading) beside a live phone preview; saves as you go.
   - Team pages: edit anyone's page, claim a handle for someone, QR codes.
   - Public `/<handle>` and an embed.
9. **Inbox**
   - Inbox / Done; a filter for All, Mentions, Replies, Assignments; Unread only.
   - A row opens the thread, the task or the booking. The unread count shows in the browser tab title.
10. **Tasks**
    - My tasks, grouped by due date.
    - Task dialog: title, description, due date, assignee, linked records.
    - On a record: a Tasks tab and an Open tasks card.
11. **Notes**
    - Every note you can see. New note picks a record first.
    - A centred note window that autosaves and links records.
12. **Reports**: reached from Home and ⌘K.
    - One tab per saved report: object, measure, group, filter; save the chart.

## Public and guest pages
- Booking: `/b/<key>`, book by chat, manage booking, business page.
- Restaurant: menu, reserve, manage reservation, newsletter confirm and unsubscribe.
- `/email-preferences`, `/invite/$token`, `/join` (by email domain), `/oauth/partner/authorize`, `/status`, Not found, embed start.

## Auth and onboarding
- `/sign-in`: Google, or email code. `/verify`: 6-digit code. `/two-factor`: authenticator or backup code, plus "Remember this device".
- `/welcome`: a split card in 6 steps (Your name, Workspace, Booking page, Link page, Connect calendar, Invite team).
- Deleted workspace (Restore within 30 days); sign-in rules held back.

## Gates
- Roles: Owner, Admin, Member, Guest, or custom, with permissions such as `schema.manage`, `audit.read`, `workspace.manage`, `booking.manage`, `routing.manage`, `security.manage`, `teams.manage`, `access.manage`, `hospitality.manage`.
- Guests don't see scheduling or data. Super admin is for operators only.
- Parked: API keys, Webhooks and Automations (a sentence-style builder with a run log).

## Cross-cutting
- App shell, a calendar-health banner, the `?` shortcut sheet.
- ⌘K: search records, views, notes, tasks and pages; Recent; go to any page or setting; create things; import and export; invite; theme; switch business; connect a calendar.
- Comments with @mentions and Resolve; activity timeline; Files tab; Undo toasts everywhere; live changes from others.

## Settings (with "Find a setting")
- **Account**:
  - Profile, with Delete account.
  - Preferences: theme, time zone, date format, week start, landing page, hidden Home sections.
  - Notifications: email switches and a daily digest.
  - Sign in and security: 2FA, devices, recent sign-ins.
  - Calendars.
- **Workspace**:
  - General: name, URL, time zone, currency, country, delete.
  - Brand: logo, colour, preview.
  - History: changes and sign-ins.
  - Apps; Connected apps.
- **People**:
  - Members: search, roles, invite, invite link, email domain, join requests, Remove with handover, Teams.
  - Roles and access: role list, role page, "What can X do", Sign in rules.
- **Scheduling**: Availability, Round robin, Routing, Scheduling access.
- **Business**: Places (profile, hours, tables), Page, Services, Staff (profile), Shifts.
- **Data**:
  - Objects: create, reorder, archive. Each object has Attributes (17 types), Configuration and Access tabs (per-team and per-record rules, Preview as).
  - Lists: General and Fields tabs.
  - Trash: restore, delete forever, empty.
- **Super admin**: Overview, Users, Booking pages, Website analytics, Partners.
