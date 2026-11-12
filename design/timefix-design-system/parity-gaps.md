# Parity and rules ledger (owner, 11 Nov night)

Owner: "do one thorough check each screen everything", "nothing and no functionality from the existing code should be missed", "no screen, part or popup should be out of rule or breaking".

Five read-only audits (CRM core, scheduling, grow + hospitality, settings + auth, design rules) compared the real app (apps/web, packages/contracts) with the prototype. Every line below is a gap to build or fix. Tick it when it lands and is walked in both themes.

Real app paths: R = apps/web/src/features. Prototype paths: P = tfds/src/components.

## Breakage sweep (rt/every.mjs, 45 pages x 3 workspaces, 278 popups opened)
- [x] Salon › Meetings team day: "Haircut and blow dry" cut off vertically in a short block
- [x] Stacked toasts: the overlap is the stack itself (older toasts sit behind the newest by design); nothing to fix
- No page scrolls, nothing off screen, no popup outside the window (light, dark, 1440)

## Wave A: house rules (shows everywhere)
- [x] No press scale: remove every [data-pressed]/:active transform (Button.css:10,18, Checkbox.css:6, Card.css:54, BookingsFlow.css:117,179,441 and ~50 more); --scale-press: 1; fix CONVENTIONS.md
- [x] No blur in motion (48 CSS files: Drawer, Toast, StepDialog pages, BookingsFlow accordion/page slides/icon swaps, AuthLayout, Onboarding...): opacity + translate only
- [x] Undefined tokens: --warning-text (BookingsFlow.css:891,899), --text-muted (Board.css:12)
- [x] Create sheet (BF/create.tsx:183, BookingsFlow.css:85-103) is a hand-made modal: use Dialog (add a divider-footer variant if needed)
- [x] Sign-in door (TimefixApp/auth.tsx:58) is a hand-made modal with no focus trap: full-screen Dialog size at --z-modal
- [x] Three link styles (.tf-rec__link, .tf-bkf__textbtn, Link): one Link with onPress
- [x] Choice tiles copied (.tf-bkf-tile, .tf-door__choice, .tf-forms__tpl): TileGrid (+ compact variant)
- [x] Section cards differ (.tf-bkf-card radius-xl, .tf-you__card): Card / SettingsSection
- [x] Team day events: second event design with a coloured stripe and hand-made chip; also .tf-bkf-svc::before, .tf-bkf-profile__dot stripes
- [x] Hand-drawn bar charts (forms.tsx:401,440, insights.tsx:149,172): BarList / Meter
- [x] Empty / no-match states in four styles: EmptyState size="sm" and NoResults
- [x] Toolbars two sizes (records small vs you/availability/menu medium); availability saved hours in a SegmentedControl -> Select
- [x] Hand copies: .tf-bkf-guestmode__back pill -> Button secondary sm; Settings › Brand redraws a booking page -> GuestLook
- [x] Screen CSS reaching into library parts: BookingsFlow.css:536-547 (.tf-btn__label, .tf-seg__item), TimefixApp.css:108-112 (.tf-qbuilder), :352 (.tf-hform--look), BookingsFlow.css:652 hides the service Switch below 46rem
- [x] Raw values: z-index 40/2/30/1, opacity .7/.8/.85/.4, 1px borders/shadows, 56px logo, bare font-size, color: var(--surface) on danger/brand fills
- [x] :hover without (hover: hover) guard (TimefixApp.css:52,100,123,208,239,259,329; BookingsFlow.css:178,224,632,677,697,746,817,852)
- Note for the port: the prototype's token set (tokens.json v2) has 53 tokens packages/tokens lacks; sync through the artifact before porting

Wave A notes: bar charts done for form answers (funnels keep their own drop-off rows, a different chart); empty states done for notes, links, roster, reservations, teams; toolbars small in Inbox, Tasks, Menu, Availability; guest-mode back is the library Button.
Wave A left: choice tiles to TileGrid, Brand preview to GuestLook, phone-only reach-ins (.tf-btn__label, .tf-seg__item, .tf-qbuilder, .tf-hform--look).

## Wave B: CRM core
- [x] Automations: list with on/off, builder (When / Only if / Then: create task, set field, notify), runs history (R/automations)
- [x] Table: group rows by a status/select field; footer calculations per column (count, empty, sum, avg, min, max); multi-cell paste/clear with Undo; reorder columns; column widths saved to the view
- [x] Filters: nested and/or groups, filter through a relationship, between, date operators
- [x] Bulk edit: several fields, add/remove/replace for multi-select, select all matching, delete confirm
- [x] New record: "Add more fields", owner-made attributes, required enforced
- [x] Owner-made attribute types show/edit with their real field (date, checkbox, rating...) in the table
- [x] Saved views: who can see it after creation, lock, copy link, move up/down, private views list
- [x] Board: group by any status/select field, "Show total of" any currency field, card fields picker, show empty columns
- [x] Custom objects: record page + peek, in ⌘K, views/filters/sorts/board/bulk/import/duplicates, delete goes to Trash
- [x] Record page: Activity filter (All/Changes/Notes/Calls/Tasks/Comments/Meetings); duplicate banner (Merge / Not a duplicate); related sections add/remove/create linked; stat strip (Last activity, Last contacted, Next meeting, Entered stage); Add/Manage attribute from Details
- [x] Log call/meeting: date/time, duration, outcome, several records, edit/delete
- [x] Comments: edit (with history), delete with confirm, collapsed Resolved threads, deep link
- [x] Inbox: Form submissions kind, link to notification settings
- [x] Tasks: "Created by me" filter, Copy link
- [x] Notes: link several records, Copy link
- [x] Duplicates for Deals and custom objects
- [x] Import: Deals and custom objects; match key, when matched fill/overwrite/skip, when no match create/skip; row preview with errors and likely duplicates; download error rows; sample CSV; per-import detail page; Undo for 7 days
- [x] Computed attributes (Formula, Lookup, Rollup) via FormulaEditor (can't change kind after creation)
- [x] Relationship attributes wired to RelationshipSettings (target, cardinality, other side)
- [x] Archived attributes list with Restore + impact warning
- [x] Status stages: won/lost outcome per stage, target time in stage (Home and the lost-reason flow still read the names Won/Lost)
- [x] "Required when" rules; reorder objects (enforced in New record and flagged on the record page, not blocked on table cell edits)
- [x] Trash: filter by object, multi-select bulk restore/delete, top-level Trash page, open trashed record read-only, custom-object records
- [x] Reports: any object, sum/avg any number, group by any field incl. date by month/week, filter from a saved view, chart type bars/line/number, Forecast (pipeline, won, weighted, win chance per stage)
- [x] ⌘K: saved views, custom records, create any object, New note/Log call/Log meeting on the open record, theme switch, export view, create view, invite members, import companies, open trash

Wave B also fixed: every popup (menus, selects, popovers, tooltips) opened about 20% short of its trigger under the 80% zoom. The app and each overlay layer are now zoomed on their own, and a build-time patch to React Aria's placement divides by the popover's zoom (rt/popalign.mjs checks it).

## Wave C: scheduling
- [x] Meetings: Day view; go to a date (month calendar); filter by booking page; filter by calendar (side panel show/hide); calendar events in the list; sort + Show more; team day filters (people, only with bookings, order); issues menu (outside hours, clashes, host left)
- [x] Block time weekly (repeat); remove a block / release reserved time; reserve time for a chosen link-only page; open a calendar event ("About this event")
- [x] New meeting: their time zone, which calendar, message to guest, email for someone not in People
- [x] Meeting drawer: copy guest link, add/change meeting link (emails guest), why it went to this host, chat transcript, "calendar event couldn't be made" warning, link to any object
- [x] Booking pages: invitation-only ("Book only through these links"); search pages; per-page time zone; days off on page hours; "Checks for conflicts in"; redirect with booking details; profile section/position on link page; location "Somewhere else" + own video link; custom duration 5–480; per-question "Save answer to"; page's own Bookings/Insights tabs; workspace link editable; team link per team; share times "Copy text"; confirm-first auto-decline after a day
- [x] Questions: show-only-if, steps, jumps, points; ready-made presets; "How did you hear" for Insights
- [x] Availability: duplicate schedule; per-schedule time zone; days off on a schedule; edit time off, time off for a colleague
- [x] Round robin groups: create/rename/delete; weekly cap per member; returning guests setting; distribution panel (fair share, 12 weeks, admin adjust with note, undo); share with editors
- [x] Routing: overview of routed forms/pages; decision filters and "What happened" steps; skill groups, rename/delete with usage
- [x] Calendars: disconnect, Sync now; per calendar conflicts/show on week/log to CRM/colour; what teammates see; "Add people from meetings" (admins); fallback notice
- [x] Scheduling access: give a colleague See/Manage, see whose you reach, remove (asks first)
- [x] Guest: invitation-only state wired to the page setting
- [x] Embedded partner link-page frames

Wave C notes: on the week, other calendars show as hatched events you can open (Filter › Show replaces the old switch); teammates' calendars stay busy-only; disconnecting a calendar asks first (no Undo, since reconnecting needs the provider sign-in); workspace and team links are made the first time they are opened.

## Wave D: forms, link page, insights, hospitality
- [x] Forms list: card ⋯ (Pause asks, Resume, Duplicate, Delete naming submissions), Copy link, Open; "New" submissions badge; templates Demo request, Booking intake, Customer onboarding; arrow keys
- [x] Builder: Steps layout (page breaks, step headers, add/rename/merge); show-only-if + "Shown if" chip; logic to steps/endings, Otherwise line, warnings, Logic filter; several endings + "After they send" routes; points/score; per-question Save answer to / overwrite / Use in Insights; type settings (date earliest/latest, scale range, multi fewest/most + Other, choice type switch); consent record; headline/subheading/button text on the preview; Look corners + workspace brand; form language; save progress
- [x] Settings: owner can be round-robin group; email to several; keep submissions (asks before shortening); spam row + threshold
- [x] Publish: Live dialog (Copy, Email, WhatsApp, More, QR PNG/SVG, Put it on your site, answers go to X); sync earlier submissions dialog; embed options (clear background, hide title, button words, colour, live preview); developers (own HTML form, allowed sites, signed posts, rotate secret); QR SVG; full-page preview Desktop/Phone
- [x] Submissions table: multi-select bulk (Not spam, Add to CRM, Spam, Delete), export selected, load more; state filter (Needs review, Release, Retry, Not in CRM, Kept); where it came from (source, UTM, page), "3 of 9 saved"; copy raw value
- [x] Form analytics: period, median time, started, views over time, sources; drop-off for every layout; answers for scale/yes-no/multi with unpicked choices
- [x] Link page: blocks Next times, Video/music, Picture, Gallery, Banner, folding heading; per block schedule, size, link picture, ask first (sensitive/18+/21+); archive/restore; import from Linktree etc.; profile photo + cover with crop, title, photo shape; design templates, colour, cover/background photo; details (site, closing line, share image, indexing); link page insights; share tools; team pages; claim handle; Live/Private switch; links list row ⋯ + Managed pages group
- [x] Insights: public shared page; named share links with scope, expiry, list, revoke; sessions table; sources; visits/finishes/finish rate/avg time/drop-off per step; link page in picker
- [x] Menus: Design screen (presets, colours with AA check, fonts, corners, cover crop); sub sections; Items tab (all items, Available switch); search; publish review with checks; setup checklist; serving times per day per menu/section; places served; preview at day/time; item photo upload/crop, Add another, ⌘↵
- [x] Table QR: print sheet (A4 tiles, tent cards); zone chips + selection; scans per table; table seats fewest–most + new zones; resource kinds, drag order, bulk, archive with Undo, cap 300
- [x] Reservations: day timeline (pick time -> new booking), month picker, switch place
- [x] Business: several businesses (switch, add, remove, copy, setup card); several places, place page, special days; business page gallery, amenities, listing, draft/publish; profile email/website/description/currency/time zone; apps turning off asks, dependencies, admins only
- [x] Services: categories, drag order, bulk, archived/restore, starter service; "what it needs" (room/chair), cancellation note
- [x] Staff list + profile (photo, title, colour, bio, places, services, member link, archive); Appointments setup checklist
- [x] Shifts: per place, copy to all weeks, copy to others, block time per person
- [x] Managed pages: group in Links, people count, remove person, delete template, the real eight lockable parts

- [x] Owner asks 11 Nov (added to D1): link page profile + background editing as a full feature (photo crop/shape, cover/background, name, title, bio); team and company link pages ("New page" asks Me / a team / the company); copy a form, booking page or link page to another workspace, or copy just its look (new feature, not in the real app)
- [x] Owner asks 11 Nov, later (added to D1): redesign the Add question picker (two panes with live preview, distinct ready-made icons, compact rows, unclipped search); one publish system everywhere (PublishBar on every editor incl. menus and business page, one status tag set, one ShareSheet dialog for every Share)

Wave D1 notes: form language translates the form's own words only (answer-check messages stay English); Import reads pasted links (the prototype can't fetch Linktree, and says so); booking page switch now says Live / Off.

Wave D2 notes: every drag list goes through src/lib/drag.ts (dnd-kit, zoom-safe); Business, Services and Staff and shifts are full Settings screens; the menu design offers Geist and Geist Mono only (no serif token); business and reservation pages don't take the menu look yet.

## Wave E: settings, auth, admin
- [x] Webhooks screen (endpoint, events, secret shown once, rotate, test, on/off, delivery log + resend, delete, limit 10)
- [x] Super admin: gate (2FA + code every 12h), Overview, Users (+ one user), Booking pages, Website, Partners
- [x] Partner connect (OAuth) page; status page; one-click unsubscribe; email prefs expired state
- [x] Usage meters and plan limits (Objects/Attributes at limit)
- [x] Sign in: rate-limit waits, sign-up closed, Google errors, signed-out reasons; two-factor expired + different email; Opening / Still opening / Can't open screens
- [x] Welcome: your name + photo step, link-page handle step, free-address suggestions, calendar result messages
- [x] Invite: your name for new person, masked sent-to, page-only invite; Join: list of workspaces for @domain, none state
- [x] Email preferences per workspace (New form submissions, Mentions, always-sent note)
- [x] Profile: claim/change handle, Google photo sync
- [x] Security: step-up check before sensitive changes, copy setup key, download codes, show more, session counts
- [x] Calendars: per-calendar options inside each account, account limit, "Add people from meetings" admins only
- [x] Preferences: "Same as the workspace" time zone, "Automatic" date format
- [x] Members: search, bulk role change, 2FA/calendar/scheduling columns, "What can X do", invited by/expires, works in, guest-demotion impact
- [x] Roles: ~33 powers, description, read-only data access, scheduling reach, People tab, move people on delete, Viewer template, impact confirm
- [x] Sign-in rules: need it yourself first, count without 2FA, No limit, last done, step-up; drop the extra Google sign-in switch
- [x] Object Access: team rows, which records (all/own/team), field-level hide/lock, Preview as, impact chips
- [x] Objects list: reorder, icon picker, copy object ID, standard/custom column
- [x] Jobs: bulk jobs with progress, Review, cancel, summary, only yours for members
- [x] API keys: last used, API reference link, Undo on revoke
- [x] General: address suggestions, copy address, export-first note, confirm before shortening retention
- [x] Teams: warning that scheduling access is lost on delete
- [x] History: sign-ins move to Account (as the real app)

Wave E notes: Webhooks sits under Settings › Developer (the real app parks it out of the nav); the real app has 36 role powers; there is no plans UI in the real app, so "ask for more room" opens an email dialog; public pages and Super admin are in the Demo menu. House rules: no screen CSS reaches into a library part (SettingsLayout narrowPane/contentInset, WeekCalendar fillHeight/narrowScroll, HostedFormPreview showBar, PoweredByFoot, BrandCard variant, DoneMark, WeekPopActions, TileGrid compact); Breadcrumbs and AppShell carry their own phone rules.

## Finishing pass (12 Nov)
- [x] Form question settings calm: type, words, choices, Required up front; Answer rules, Logic and points, Saves to, Help text behind More options; chips for every rule that's set open its group. Link blocks fold the same way.
- [x] Form language covers answer checks and the guest's own words (placeholders, Other, pickers, dates) in English, Hindi, Spanish, French, German.
- [x] Link import: "Paste the page" (HTML or text), reviewed with ticks; the address field says the real app fetches it.
- [x] Fonts: the real app's nine faces (Host Grotesk, Fraunces, Newsreader, Bricolage Grotesque, Outfit, Instrument Serif via Google Fonts) on menu and link page Design.
- [x] Formula kind stays fixed, as in the real app, and the dialog says why.
- [x] Won/Lost read from each stage's outcome everywhere.
- [x] "Required when" enforced on table cell edits, paste and bulk clear.
- [x] Menu look carries to business and reservation pages and their popups; link page and form popups wear their look.
- [x] Insights seeded 180 days (realistic deltas); table QR item says "View menu"; a double-click edit no longer opens the record panel.

- [x] Computed attributes change kind (formula, lookup, rollup) after creation, the owner's call: the ask sits in the attribute dialog (no dialog on a dialog), every value is worked out again, unfit view parts are named and dropped, Undo restores them; an open table sets aside stale unsaved view changes with Undo.
- [x] Phone country picker, Country names and the thank-you readback follow the form's language (Intl.DisplayNames); stored values stay canonical. "Powered by Timefix" stays English on purpose.
