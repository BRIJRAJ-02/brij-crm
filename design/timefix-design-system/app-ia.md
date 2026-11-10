# Timefix app structure (prototype rebuild)

## What's wrong with main's structure
- **Captures** is a container label that mixes booking pages and forms. People look for "Forms", and booking pages already live in Bookings.
- **Reports** is hidden: it's only reachable from Home and ⌘K, while Insights sits in the sidebar. These are two analytics homes, and one of them can't be browsed to.
- **Settings › Scheduling** repeats Bookings' own Availability and Routing pages. **Settings › Business** repeats the restaurant and salon pages.
- **Ten or more items at the top level**, with member-ordered sections and a stored but unused Favourites, make the sidebar hard to scan.

## Sidebar

**Header**
- The workspace menu: workspaces, Create workspace, Shortcuts, Leave workspace, Sign out.
- A **Search ⌘K** button.

**You** (personal):
- **Home**: today's agenda, my tasks, the setup checklist, a few numbers.
- **Inbox**: mentions, replies, assignments and booking notices, with an unread badge.
- **Tasks**
- **Notes**

**Records** (folds open):
- People, Companies, Deals, and any custom objects.
- **+ New object** for owners.

**Lists** (folds open):
- Each list, and **+ New list**.

**Bookings** (folds open; the module already built):
- Meetings (Reservations for a restaurant), Booking pages, Availability, Roster (teams), Routing (teams).
- Restaurants add Menu; a salon gets Team day.

**Forms**: the form list. Each form opens its editor (Questions, Share, Responses, Results).

**Links**: everything you share in one place (your link or business page, booking pages, the menu, forms), each with Copy, QR code, Open and its numbers. **Link page** is its editor, opened from Links.

**Insights** (one analytics home):
- **Pages**: forms, booking pages, the link page.
- **Reports**: saved CRM charts and New report.
- Bookings' own Insights moves here.

**Foot**: Settings and Help.

Members can hide or reorder items, and the rail mode stays. The Records and Lists folds remember whether they're open. On a phone, a tab bar shows Home, Inbox, Records, Bookings and More.

## Labels
- **Captures** is gone. Booking pages live in Bookings, Forms is its own item.
- **Submissions** becomes **Responses**: it's the guest's word, as in Tally and Typeform.
- **Objects** stay **Records** in the sidebar and **Objects** in Settings › Data, where they're defined.
- **Business** becomes **Bookings** for salons and restaurants too. It is one module, as the owner asked on 10 Nov.

## Settings (with "Find a setting")
**Account**:
- **Profile**: name, photo, Delete account.
- **Preferences**: theme, time zone, date format, week start, start page, Home sections.
- **Notifications**: email switches, daily digest.
- **Sign in and security**: two factor, devices, sign-ins.
- **Calendars**: connected calendars, where bookings go.

**Workspace**:
- **General**: name, address, time zone, currency, country, Brand (logo and colour) in the same page, Delete workspace.
- **Members**: members, invitations, invite link, email domain and join requests, plus a Teams tab.
- **Roles and access**: roles, "What can X do", Sign in rules.
- **Apps and connections**: business apps (Menu, Table seating, Appointments) and connected apps.
- **History**: changes and sign-ins.

**Data**:
- **Objects**: attributes, configuration, access.
- **Lists**: general, fields.
- **Trash**

**Bookings**: only workspace-wide rules.
- Round robin groups, Scheduling access, Business profile (places, page, services, staff, shifts).
- Everyday pages (availability, routing, tables) stay in the Bookings module. Each setting here links to its page there.

**Developer**: API keys, webhooks, automations. Parked on main, so they're shown as "Coming soon".

**Super admin**: operators only.

## Build order in the prototype
1. App shell (sidebar, ⌘K, phone tab bar) and Home.
2. Records: table, board, filters, views, bulk, record panel, record page (tabs), new record, import, duplicates, trash.
3. Lists.
4. Inbox, Tasks, Notes.
5. Forms: gallery, editor, share, responses, results, and the public form.
6. Link page: the editor and the public page.
7. Insights and Reports.
8. Settings, the whole tree.
9. Auth (sign in, verify, two factor), first run, invite and join, the deleted workspace, the public extras.

Bookings slots into the shell as the Bookings section. Every module gets one pass with the design skills (journey, ux-heuristics, subtractive-design, impeccable, interaction-design) before it's built.

## Built so far (10 Nov, the Timefix artifact)
All nine steps have a first pass: the shell, ⌘K and Home; Records (views, table and board, filters, bulk, the record panel, the record page with its tabs); Lists; Inbox, Tasks and Notes; Forms (gallery, builder and preview, settings, share, responses, results, the public form); the Link page; Insights and Reports; Settings (the whole tree with "Find a setting"); the doors (sign in, two factor, first run, invitation, join request, deleted workspace, email preferences, all from ⌘K › Screens).
Then (10 Nov night): CSV import into People (match, fix values, check, Undo import), Find duplicates with a side-by-side merge and a banner on People, Settings › Objects with the full attribute editor and New object (it shows under Records), and one Insights home (Bookings' own Insights leaves the app sidebar). The guest's Manage booking page was already in Bookings. The prototype now covers every module and flow in app-inventory.md; next is building it into the app in phases.

## Bullet-proof pass (10 Nov night)

Four reviewers read every screen; their findings and state are in `review-ledger.md`. This pass:
- Settings stores everything in the app's data (members, invitations, teams, two factor, devices, apps, API keys, theme, workspace name and address) and it reaches the sidebar, doors and links.
- Records, lists, merges and imports undo only their own change; deleting a record hides its list entries until it is restored; the record page has Owner, Company and Lists, each edit with Undo.
- Inbox, Tasks and Notes: nothing lost when leaving mid-undo or mid-typing; empty notes are discarded; mentions open the comments.
- Forms file answers by email (no duplicate person), preview of a draft records nothing, Results show real answers, and "Book a meeting" hands the visitor to the booking page with their name filled in.
- Links hub; Insights from real bookings and answers; Reports saved, renamed and deleted.
- Bookings: the guest's own bookings hold their time and table, cut-offs hold on Manage, moves check the host is free, Confirm re-checks, walk-ins outside services show, sold out applies at once, table QR codes are unique and safe.
- First run asks one question (Meetings, Appointments or Tables) and lands in that workspace; the phone has a More page with every section.

Then a second review round and an improvement pass (10 Nov, late): reasons instead of "busy" when reassigning, deadlines as dates for guests, next free times on staff tiles, totals on the deals board, results per question, a direct Edit on Links and calmer form settings. The details are in `review-ledger.md`.

## Settings tree (10 Nov, night)

Account (Profile, Preferences, Notifications, Sign in and security, Calendars) · Workspace (General, Brand, Members and teams, Roles and access, Apps and connections, History, Imports and exports) · Scheduling (Availability or Opening hours, Round robin, Routing, Scheduling access) · Business, for salons and restaurants (Business page, Services or Table bookings, Staff and shifts, Places and tables, Menu) · Data (Objects, Lists, Trash) · Developer (API keys). Scheduling and Business pages show what's set and open the page in Bookings, where it's used every day; Scheduling access and Calendars change Bookings directly from Settings.

