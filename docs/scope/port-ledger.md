# Port ledger

Every line of the prototype's parity ledger (`design/timefix-design-system/parity-gaps.md`, owner, 11 Nov), copied for the port of the prototype into the real app ([handover](../handover/prototype-port.md), specs 0071 onwards). There a tick meant the prototype had it; here a tick means the real app has it: ported, walked in both themes, and landed on main.

Each line carries the phase that ports it, then the PR or commit that landed it. A phase is done only when all its lines are ticked. Phases: 0 tokens (spec 0071), 1 library parity (0072), 2 library additions (0073), 3 shared behaviour (0074), 4 shell and sign in, 5 CRM core, 6 scheduling, 7 forms, link page and insights, 8 hospitality and business, 9 settings, admin and public pages.

## Breakage sweep (rt/every.mjs, 45 pages x 3 workspaces, 278 popups opened)
- [ ] **P6** Salon › Meetings team day: "Haircut and blow dry" cut off vertically in a short block · PR: 
- [ ] **P2** Stacked toasts: the overlap is the stack itself (older toasts sit behind the newest by design); nothing to fix · PR: 
- No page scrolls, nothing off screen, no popup outside the window (light, dark, 1440)

## Wave A: house rules (shows everywhere)
- [ ] **P0** No press scale: remove every [data-pressed]/:active transform (Button.css:10,18, Checkbox.css:6, Card.css:54, BookingsFlow.css:117,179,441 and ~50 more); --scale-press: 1; fix CONVENTIONS.md · PR: 
- [ ] **P0** No blur in motion (48 CSS files: Drawer, Toast, StepDialog pages, BookingsFlow accordion/page slides/icon swaps, AuthLayout, Onboarding...): opacity + translate only · PR: 
- [ ] **P1** Undefined tokens: --warning-text (BookingsFlow.css:891,899), --text-muted (Board.css:12) · PR: 
- [ ] **P2** Create sheet (BF/create.tsx:183, BookingsFlow.css:85-103) is a hand-made modal: use Dialog (add a divider-footer variant if needed) · PR: 
- [ ] **P4** Sign-in door (TimefixApp/auth.tsx:58) is a hand-made modal with no focus trap: full-screen Dialog size at --z-modal · PR: 
- [ ] **P1** Three link styles (.tf-rec__link, .tf-bkf__textbtn, Link): one Link with onPress · PR: 
- [ ] **P1** Choice tiles copied (.tf-bkf-tile, .tf-door__choice, .tf-forms__tpl): TileGrid (+ compact variant) · PR: 
- [ ] **P1** Section cards differ (.tf-bkf-card radius-xl, .tf-you__card): Card / SettingsSection · PR: 
- [ ] **P6** Team day events: second event design with a coloured stripe and hand-made chip; also .tf-bkf-svc::before, .tf-bkf-profile__dot stripes · PR: 
- [ ] **P1** Hand-drawn bar charts (forms.tsx:401,440, insights.tsx:149,172): BarList / Meter · PR: 
- [ ] **P1** Empty / no-match states in four styles: EmptyState size="sm" and NoResults · PR: 
- [ ] **P1** Toolbars two sizes (records small vs you/availability/menu medium); availability saved hours in a SegmentedControl -> Select · PR: 
- [ ] **P3** Hand copies: .tf-bkf-guestmode__back pill -> Button secondary sm; Settings › Brand redraws a booking page -> GuestLook · PR: 
- [ ] **P1** Screen CSS reaching into library parts: BookingsFlow.css:536-547 (.tf-btn__label, .tf-seg__item), TimefixApp.css:108-112 (.tf-qbuilder), :352 (.tf-hform--look), BookingsFlow.css:652 hides the service Switch below 46rem · PR: 
- [ ] **P1** Raw values: z-index 40/2/30/1, opacity .7/.8/.85/.4, 1px borders/shadows, 56px logo, bare font-size, color: var(--surface) on danger/brand fills · PR: 
- [ ] **P1** :hover without (hover: hover) guard (TimefixApp.css:52,100,123,208,239,259,329; BookingsFlow.css:178,224,632,677,697,746,817,852) · PR: 
- Note for the port: the prototype's token set (tokens.json v2) has 53 tokens packages/tokens lacks; sync through the artifact before porting

Wave A notes: bar charts done for form answers (funnels keep their own drop-off rows, a different chart); empty states done for notes, links, roster, reservations, teams; toolbars small in Inbox, Tasks, Menu, Availability; guest-mode back is the library Button.
Wave A left: choice tiles to TileGrid, Brand preview to GuestLook, phone-only reach-ins (.tf-btn__label, .tf-seg__item, .tf-qbuilder, .tf-hform--look).

## Wave B: CRM core
- [ ] **P5** Automations: list with on/off, builder (When / Only if / Then: create task, set field, notify), runs history (R/automations) · PR: 
- [ ] **P5** Table: group rows by a status/select field; footer calculations per column (count, empty, sum, avg, min, max); multi-cell paste/clear with Undo; reorder columns; column widths saved to the view · PR: 
- [ ] **P5** Filters: nested and/or groups, filter through a relationship, between, date operators · PR: 
- [ ] **P5** Bulk edit: several fields, add/remove/replace for multi-select, select all matching, delete confirm · PR: 
- [ ] **P5** New record: "Add more fields", owner-made attributes, required enforced · PR: 
- [ ] **P5** Owner-made attribute types show/edit with their real field (date, checkbox, rating...) in the table · PR: 
- [ ] **P5** Saved views: who can see it after creation, lock, copy link, move up/down, private views list · PR: 
- [ ] **P5** Board: group by any status/select field, "Show total of" any currency field, card fields picker, show empty columns · PR: 
- [ ] **P5** Custom objects: record page + peek, in ⌘K, views/filters/sorts/board/bulk/import/duplicates, delete goes to Trash · PR: 
- [ ] **P5** Record page: Activity filter (All/Changes/Notes/Calls/Tasks/Comments/Meetings); duplicate banner (Merge / Not a duplicate); related sections add/remove/create linked; stat strip (Last activity, Last contacted, Next meeting, Entered stage); Add/Manage attribute from Details · PR: 
- [ ] **P5** Log call/meeting: date/time, duration, outcome, several records, edit/delete · PR: 
- [ ] **P5** Comments: edit (with history), delete with confirm, collapsed Resolved threads, deep link · PR: 
- [ ] **P5** Inbox: Form submissions kind, link to notification settings · PR: 
- [ ] **P5** Tasks: "Created by me" filter, Copy link · PR: 
- [ ] **P5** Notes: link several records, Copy link · PR: 
- [ ] **P5** Duplicates for Deals and custom objects · PR: 
- [ ] **P5** Import: Deals and custom objects; match key, when matched fill/overwrite/skip, when no match create/skip; row preview with errors and likely duplicates; download error rows; sample CSV; per-import detail page; Undo for 7 days · PR: 
- [ ] **P5** Computed attributes (Formula, Lookup, Rollup) via FormulaEditor (can't change kind after creation) · PR: 
- [ ] **P5** Relationship attributes wired to RelationshipSettings (target, cardinality, other side) · PR: 
- [ ] **P5** Archived attributes list with Restore + impact warning · PR: 
- [ ] **P5** Status stages: won/lost outcome per stage, target time in stage (Home and the lost-reason flow still read the names Won/Lost) · PR: 
- [ ] **P5** "Required when" rules; reorder objects (enforced in New record and flagged on the record page, not blocked on table cell edits) · PR: 
- [ ] **P5** Trash: filter by object, multi-select bulk restore/delete, top-level Trash page, open trashed record read-only, custom-object records · PR: 
- [ ] **P5** Reports: any object, sum/avg any number, group by any field incl. date by month/week, filter from a saved view, chart type bars/line/number, Forecast (pipeline, won, weighted, win chance per stage) · PR: 
- [ ] **P5** ⌘K: saved views, custom records, create any object, New note/Log call/Log meeting on the open record, theme switch, export view, create view, invite members, import companies, open trash · PR: 

Wave B also fixed: every popup (menus, selects, popovers, tooltips) opened about 20% short of its trigger under the 80% zoom. The app and each overlay layer are now zoomed on their own, and a build-time patch to React Aria's placement divides by the popover's zoom (rt/popalign.mjs checks it).

## Wave C: scheduling
- [ ] **P6** Meetings: Day view; go to a date (month calendar); filter by booking page; filter by calendar (side panel show/hide); calendar events in the list; sort + Show more; team day filters (people, only with bookings, order); issues menu (outside hours, clashes, host left) · PR: 
- [ ] **P6** Block time weekly (repeat); remove a block / release reserved time; reserve time for a chosen link-only page; open a calendar event ("About this event") · PR: 
- [ ] **P6** New meeting: their time zone, which calendar, message to guest, email for someone not in People · PR: 
- [ ] **P6** Meeting drawer: copy guest link, add/change meeting link (emails guest), why it went to this host, chat transcript, "calendar event couldn't be made" warning, link to any object · PR: 
- [ ] **P6** Booking pages: invitation-only ("Book only through these links"); search pages; per-page time zone; days off on page hours; "Checks for conflicts in"; redirect with booking details; profile section/position on link page; location "Somewhere else" + own video link; custom duration 5–480; per-question "Save answer to"; page's own Bookings/Insights tabs; workspace link editable; team link per team; share times "Copy text"; confirm-first auto-decline after a day · PR: 
- [ ] **P6** Questions: show-only-if, steps, jumps, points; ready-made presets; "How did you hear" for Insights · PR: 
- [ ] **P6** Availability: duplicate schedule; per-schedule time zone; days off on a schedule; edit time off, time off for a colleague · PR: 
- [ ] **P6** Round robin groups: create/rename/delete; weekly cap per member; returning guests setting; distribution panel (fair share, 12 weeks, admin adjust with note, undo); share with editors · PR: 
- [ ] **P6** Routing: overview of routed forms/pages; decision filters and "What happened" steps; skill groups, rename/delete with usage · PR: 
- [ ] **P6** Calendars: disconnect, Sync now; per calendar conflicts/show on week/log to CRM/colour; what teammates see; "Add people from meetings" (admins); fallback notice · PR: 
- [ ] **P6** Scheduling access: give a colleague See/Manage, see whose you reach, remove (asks first) · PR: 
- [ ] **P6** Guest: invitation-only state wired to the page setting · PR: 
- [ ] **P6** Embedded partner link-page frames · PR: 

Wave C notes: on the week, other calendars show as hatched events you can open (Filter › Show replaces the old switch); teammates' calendars stay busy-only; disconnecting a calendar asks first (no Undo, since reconnecting needs the provider sign-in); workspace and team links are made the first time they are opened.

## Wave D: forms, link page, insights, hospitality
- [ ] **P7** Forms list: card ⋯ (Pause asks, Resume, Duplicate, Delete naming submissions), Copy link, Open; "New" submissions badge; templates Demo request, Booking intake, Customer onboarding; arrow keys · PR: 
- [ ] **P7** Builder: Steps layout (page breaks, step headers, add/rename/merge); show-only-if + "Shown if" chip; logic to steps/endings, Otherwise line, warnings, Logic filter; several endings + "After they send" routes; points/score; per-question Save answer to / overwrite / Use in Insights; type settings (date earliest/latest, scale range, multi fewest/most + Other, choice type switch); consent record; headline/subheading/button text on the preview; Look corners + workspace brand; form language; save progress · PR: 
- [ ] **P7** Settings: owner can be round-robin group; email to several; keep submissions (asks before shortening); spam row + threshold · PR: 
- [ ] **P7** Publish: Live dialog (Copy, Email, WhatsApp, More, QR PNG/SVG, Put it on your site, answers go to X); sync earlier submissions dialog; embed options (clear background, hide title, button words, colour, live preview); developers (own HTML form, allowed sites, signed posts, rotate secret); QR SVG; full-page preview Desktop/Phone · PR: 
- [ ] **P7** Submissions table: multi-select bulk (Not spam, Add to CRM, Spam, Delete), export selected, load more; state filter (Needs review, Release, Retry, Not in CRM, Kept); where it came from (source, UTM, page), "3 of 9 saved"; copy raw value · PR: 
- [ ] **P7** Form analytics: period, median time, started, views over time, sources; drop-off for every layout; answers for scale/yes-no/multi with unpicked choices · PR: 
- [ ] **P7** Link page: blocks Next times, Video/music, Picture, Gallery, Banner, folding heading; per block schedule, size, link picture, ask first (sensitive/18+/21+); archive/restore; import from Linktree etc.; profile photo + cover with crop, title, photo shape; design templates, colour, cover/background photo; details (site, closing line, share image, indexing); link page insights; share tools; team pages; claim handle; Live/Private switch; links list row ⋯ + Managed pages group · PR: 
- [ ] **P7** Insights: public shared page; named share links with scope, expiry, list, revoke; sessions table; sources; visits/finishes/finish rate/avg time/drop-off per step; link page in picker · PR: 
- [ ] **P8** Menus: Design screen (presets, colours with AA check, fonts, corners, cover crop); sub sections; Items tab (all items, Available switch); search; publish review with checks; setup checklist; serving times per day per menu/section; places served; preview at day/time; item photo upload/crop, Add another, ⌘↵ · PR: 
- [ ] **P8** Table QR: print sheet (A4 tiles, tent cards); zone chips + selection; scans per table; table seats fewest–most + new zones; resource kinds, drag order, bulk, archive with Undo, cap 300 · PR: 
- [ ] **P8** Reservations: day timeline (pick time -> new booking), month picker, switch place · PR: 
- [ ] **P8** Business: several businesses (switch, add, remove, copy, setup card); several places, place page, special days; business page gallery, amenities, listing, draft/publish; profile email/website/description/currency/time zone; apps turning off asks, dependencies, admins only · PR: 
- [ ] **P8** Services: categories, drag order, bulk, archived/restore, starter service; "what it needs" (room/chair), cancellation note · PR: 
- [ ] **P8** Staff list + profile (photo, title, colour, bio, places, services, member link, archive); Appointments setup checklist · PR: 
- [ ] **P8** Shifts: per place, copy to all weeks, copy to others, block time per person · PR: 
- [ ] **P8** Managed pages: group in Links, people count, remove person, delete template, the real eight lockable parts · PR: 

- [ ] **P7** Owner asks 11 Nov (added to D1): link page profile + background editing as a full feature (photo crop/shape, cover/background, name, title, bio); team and company link pages ("New page" asks Me / a team / the company); copy a form, booking page or link page to another workspace, or copy just its look (new feature, not in the real app) · PR: 
- [ ] **P3, 7** Owner asks 11 Nov, later (added to D1): redesign the Add question picker (two panes with live preview, distinct ready-made icons, compact rows, unclipped search); one publish system everywhere (PublishBar on every editor incl. menus and business page, one status tag set, one ShareSheet dialog for every Share) · PR: 

Wave D1 notes: form language translates the form's own words only (answer-check messages stay English); Import reads pasted links (the prototype can't fetch Linktree, and says so); booking page switch now says Live / Off.

Wave D2 notes: every drag list goes through src/lib/drag.ts (dnd-kit, zoom-safe); Business, Services and Staff and shifts are full Settings screens; the menu design offers Geist and Geist Mono only (no serif token); business and reservation pages don't take the menu look yet.

## Wave E: settings, auth, admin
- [ ] **P9** Webhooks screen (endpoint, events, secret shown once, rotate, test, on/off, delivery log + resend, delete, limit 10) · PR: 
- [ ] **P9** Super admin: gate (2FA + code every 12h), Overview, Users (+ one user), Booking pages, Website, Partners · PR: 
- [ ] **P9** Partner connect (OAuth) page; status page; one-click unsubscribe; email prefs expired state · PR: 
- [ ] **P9** Usage meters and plan limits (Objects/Attributes at limit) · PR: 
- [ ] **P4** Sign in: rate-limit waits, sign-up closed, Google errors, signed-out reasons; two-factor expired + different email; Opening / Still opening / Can't open screens · PR: 
- [ ] **P4** Welcome: your name + photo step, link-page handle step, free-address suggestions, calendar result messages · PR: 
- [ ] **P4** Invite: your name for new person, masked sent-to, page-only invite; Join: list of workspaces for @domain, none state · PR: 
- [ ] **P9** Email preferences per workspace (New form submissions, Mentions, always-sent note) · PR: 
- [ ] **P9** Profile: claim/change handle, Google photo sync · PR: 
- [ ] **P9** Security: step-up check before sensitive changes, copy setup key, download codes, show more, session counts · PR: 
- [ ] **P9** Calendars: per-calendar options inside each account, account limit, "Add people from meetings" admins only · PR: 
- [ ] **P9** Preferences: "Same as the workspace" time zone, "Automatic" date format · PR: 
- [ ] **P9** Members: search, bulk role change, 2FA/calendar/scheduling columns, "What can X do", invited by/expires, works in, guest-demotion impact · PR: 
- [ ] **P9** Roles: ~33 powers, description, read-only data access, scheduling reach, People tab, move people on delete, Viewer template, impact confirm · PR: 
- [ ] **P9** Sign-in rules: need it yourself first, count without 2FA, No limit, last done, step-up; drop the extra Google sign-in switch · PR: 
- [ ] **P9** Object Access: team rows, which records (all/own/team), field-level hide/lock, Preview as, impact chips · PR: 
- [ ] **P9** Objects list: reorder, icon picker, copy object ID, standard/custom column · PR: 
- [ ] **P9** Jobs: bulk jobs with progress, Review, cancel, summary, only yours for members · PR: 
- [ ] **P9** API keys: last used, API reference link, Undo on revoke · PR: 
- [ ] **P9** General: address suggestions, copy address, export-first note, confirm before shortening retention · PR: 
- [ ] **P9** Teams: warning that scheduling access is lost on delete · PR: 
- [ ] **P9** History: sign-ins move to Account (as the real app) · PR: 

Wave E notes: Webhooks sits under Settings › Developer (the real app parks it out of the nav); the real app has 36 role powers; there is no plans UI in the real app, so "ask for more room" opens an email dialog; public pages and Super admin are in the Demo menu. House rules: no screen CSS reaches into a library part (SettingsLayout narrowPane/contentInset, WeekCalendar fillHeight/narrowScroll, HostedFormPreview showBar, PoweredByFoot, BrandCard variant, DoneMark, WeekPopActions, TileGrid compact); Breadcrumbs and AppShell carry their own phone rules.

## Finishing pass (12 Nov)
- [ ] **P7** Form question settings calm: type, words, choices, Required up front; Answer rules, Logic and points, Saves to, Help text behind More options; chips for every rule that's set open its group. Link blocks fold the same way. · PR: 
- [ ] **P7** Form language covers answer checks and the guest's own words (placeholders, Other, pickers, dates) in English, Hindi, Spanish, French, German. · PR: 
- [ ] **P7** Link import: "Paste the page" (HTML or text), reviewed with ticks; the address field says the real app fetches it. · PR: 
- [ ] **P7, 8** Fonts: the real app's nine faces (Host Grotesk, Fraunces, Newsreader, Bricolage Grotesque, Outfit, Instrument Serif via Google Fonts) on menu and link page Design. · PR: 
- [ ] **P5** Formula kind stays fixed, as in the real app, and the dialog says why. · PR: 
- [ ] **P5** Won/Lost read from each stage's outcome everywhere. · PR: 
- [ ] **P5** "Required when" enforced on table cell edits, paste and bulk clear. · PR: 
- [ ] **P3** Menu look carries to business and reservation pages and their popups; link page and form popups wear their look. · PR: 
- [ ] **P5, 7, 8** Insights seeded 180 days (realistic deltas); table QR item says "View menu"; a double-click edit no longer opens the record panel. · PR: 

- [ ] **P5** Computed attributes change kind (formula, lookup, rollup) after creation, the owner's call: the ask sits in the attribute dialog (no dialog on a dialog), every value is worked out again, unfit view parts are named and dropped, Undo restores them; an open table sets aside stale unsaved view changes with Undo. · PR: 
- [ ] **P7** Phone country picker, Country names and the thank-you readback follow the form's language (Intl.DisplayNames); stored values stay canonical. "Powered by Timefix" stays English on purpose. · PR:
