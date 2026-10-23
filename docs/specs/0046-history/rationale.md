# 0046. History and logs: rationale

## Context

Since spec 0031 every membership, invitation, role, workspace setting and (from specs 0033, 0037 and 0043) sign in rule and scheduling admin change writes one `audit_events` row in its own transaction: append only, changed fields only in `before` and `after`, with the actor, the IP the edge vouched for and the request id. Nothing reads them yet. `audit.read` (owners and admins) has existed since spec 0009 with no screen.

Other logs already exist, each where its job is:
- **Account › Sign in and devices › Recent activity** (spec 0033, AC-898): the person's own security events, 90 days shown, a year kept, never an IP; a Card of SettingsRows with Show more.
- **Settings › Background jobs** (spec 0008): live work with progress, cancel and confirm; everyone's for `jobs.manage`, else your own.
- **Trash** (spec 0022): deleted records for 30 days, restore and delete forever, at its own address that Undo toasts and ⌘K reach.
- **A record's timeline** (spec 0017): value history per record, through the door.
- **Import summaries** (spec 0040), the emails table's statuses (queued, sent, skipped, failed; 30 days), calendar connection statuses (syncing, connected, expired, revoked, failed): operational state, each shown or due to be shown where it is acted on.

Forces:
- The owner asked for "a tab to keep historys and logs" (A120), and every setting lives in Settings (owner rule, 20 October).
- The owner approved Sign in and devices' anatomy, Recent activity included, on 22 October.
- Hidden means absent: a control someone can't use is not shown locked (spec 0026, AC-682).
- One client data layer; screens never fetch; lists are paged (crm-frontend-state).
- Every read goes through the door; no N+1; cursor pagination (crm-api-backend, crm-data-model-access).
- An IP is personal data, and the app has never shown one.

## Options considered

### Option 1: one History page, two tabs, workspace changes for `audit.read` and your sign ins for everyone (chosen)

**Pros**: answers the ask in its own words, one place to look; every member gets something there, so the entry never hides and appears by role; reuses Recent activity as is; no migration.
**Cons**: one tab is workspace scoped and the other account wide, under the Workspace group (the tab's description says so).

### Option 2: an "Audit log" page for owners and admins only (Notion, Linear, GitHub, Vercel)

**Pros**: the industry's name and placement; one scope per page.
**Cons**: members get nothing from the ask; the entry appears and disappears by role; sign ins stay only on Sign in and devices, so "history" is in two unrelated places.

### Option 3: fold Background jobs and Trash into History as tabs

**Pros**: every log behind one entry.
**Cons**: both are working tools with actions, not records of the past; Trash's address is reached from Undo toasts and ⌘K; Jobs is live. Moving them reopens two finished screens for no new capability.

### Option 4: a generic activity feed (the record timeline's ActivityFeed) instead of a table

**Pros**: an existing module with actors, before and after values and period headings.
**Cons**: its entries are typed for records (attribute displays, links, meetings); the audit rows need a new entry kind, and a feed is harder to scan by person than a Who column. Every audit log researched uses a table with a Who column.

### API options

- **A new `audit.list` that resolves names on the server (chosen)**: the browser never sees raw `before`/`after`, IPs or request ids; three statements a page.
- **Raw rows plus a client side name lookup**: leaks the raw blobs and needs the browser to know every table's names, including removed members it can't list.
- **Reusing the outbox or the record history**: the outbox is pruned after 24 hours (spec 0007) and carries ids only; record history covers records only.

## Rationale

Option 1 meets the ask for every role without moving anything the owner just approved, and it turns rows the product has written for weeks into something an owner can read. The table plus a details panel is how every researched product presents an audit log, and the sentence per action is how the best ones (Vercel's Activity, PlanetScale, Customer.io, Deputy) make it readable without a reference sheet. Resolving names on the server keeps privacy rules (no IP, no raw values, nothing from a deleted account's profile) in one place, under the permission check.

Calls made without a question, each with its runner up:
- **Newest first by `at`, then id ascending** (runner up: id descending), so the order matches `audit_events_at` exactly and needs no sort step; rows of one transaction share `at`.
- **50 a page with Show more** (runner up: Pagination with page numbers), as Recent activity already pages, and because a cursor log has no page count.
- **Names as they are now** (runner up: as they were), because only the current name is stored for most targets; the details keep the old values where the row has them.
- **Filters in the address** (runner up: component state), so a link to "Ada's changes last week" works and Back restores it.
- **Person filter lists active members, plus a former member reached from a row** (runner up: a distinct query over every actor ever), which would scan the whole log on each visit.
- **No live updates** (runner up: refresh on a `members` event), because audit rows change rarely and the page is read when visited.
- **A sentence template per action, pinned by a test** (runner up: show the raw action key, as GitHub and PlanetScale do beside the sentence), since this product's admins are not developers.

## Milestone 1's calls (23 October 2026, the settings plan, A120)

- **Milestone 1 only, in two reviewed passes**: the server (contracts, core, the access entry, the API, the guard tests), then the screen (data layer, nav entry, routes, screens, states, docs and the flow). Filters, the details panel and ⌘K's synonyms wait for milestone 2, so the input takes only `workspace`, `cursor?` and `limit?`, strict, and no field goes unused.
- **The kinds live in their own Zod free module** (`@crm/contracts/audit-kinds`), not in `team.ts`: the screen names a row's kind without loading Zod, and History never edits the file holding `AUDIT_ACTIONS`, which profile-order also edits.
- **The redirect lives in `w.$slug.settings.history.index.tsx`**: a file named `w.$slug.settings.history.tsx` would be the parent of `/changes` and `/sign-ins`, and its redirect would fire for them too.
- **The `clock` icon**: the library has no `history` icon, and adding one changes the Icon Registry baselines; a `history` icon is milestone 2's.
- **Record links stay unnamed**: rows for `booking.record_linked` and `booking.record_unlinked` never name the record and never send its id, since the record may be hidden from the reader (the fa9fe395 security fix). The service never reads `recordId` out of the row.
- **Unknown profile keys fall back to the profile**: only known keys leave the server, and a change with none left (photo-switch's `pictureHidden`) reads "changed their profile", never "changed their " and nothing.
- **Four statements, not three**: `withWorkspace` sets the workspace in a statement of its own, and a statement timeout set inside the page statement covers only the statements after it, so the 3 second timeout is a statement of its own: 4 for a page, 3 when empty. The count still holds whatever the page's size.
- **Your sign ins reuses Recent activity as it is**, taking its tab's heading and line through the optional `title` and `description` the account lane adds; nothing about the list is copied.

## Evidence

Research on 23 October 2026, from the vendors' docs and real screens on Mobbin:

- **Notion**: workspace Settings › Audit log, and an organization log under Manage organization › Data & Compliance; Enterprise, owners. Filters: date (any range in the past year), person or agent (removed users stay searchable, labelled "Removed"), event (grouped by category: page, teamspace, workspace, account…), teamspace, and "Related" events. CSV export of the filtered view. Kept 365 days; IP shown where available. Model for: grouped kinds, labelling removed people, filters.
- **Linear**: Workspace settings › Administration › Audit log (account Security & access holds your own Sessions separately, seen on Mobbin). Enterprise, owners only. Filter by event type, hide session events; API by type, actor, IP and date. Kept 90 days; streaming to a SIEM, no file export. Model for: separating the person's own sessions from the workspace log.
- **Vercel**: two surfaces. Team Settings › Activity (all plans, seen on Mobbin): rows of an avatar and one sentence with the names in bold ("You invited jdoe to the Team as Viewer"), grouped by month, relative time at the end, filters for project, user, time ("All Time") and event. Security & Privacy › Audit Log (Enterprise, owners): pick a timeframe, Export CSV (emailed link, 24 hours), up to 90 days, with `previous` and `next` JSON per event, IP, user agent and request id. Model for: the sentence row; and for keeping IP and request id out of the readable view.
- **GitHub**: organization Settings › Archive › Logs › Audit log (owners; 180 days; default view three months; filters as qualifiers `actor:`, `action:`, `created:`, `country:`, `operation:`; export JSON or CSV, capped at 100 MB or 10 minutes). Personal Settings › Archives › Security log (90 days, same rows: avatar, actor and action key, a sentence, IP and country, time, an expand button). Model for: the personal security log beside the org log; expanding a row for details.
- **Attio**: settings groups Account, Workspace (General, Members, Plans, Billing, Developers, Security, …), Data (Objects, Lists, Import history), Automations (seen on Mobbin). No audit log screen captured; third party sources place audit logs on Enterprise only. Model for: logs as a plain Settings entry ("Import history") beside the things they log.
- **Other captured audit logs** (Mobbin): PlanetScale (Actor column, a sentence with the action key, IP and date; "Add filter" with Actor), Customer.io (sentence rows that expand into a "Log entry"; date range, team member, IP and event type filters; Export CSV), Front (date range, updated by, resource, event; Export), Dropbox admin Security › Monitoring (Activity and External sharing tabs; date, activities, people filters), Circle (Event, Performed by, Date chips; Previous and Next), Deputy (sentence rows with field rows "before → after" beneath), Zoom version history (Before → After columns). Model for: before → after lines in the details, and the three filters every product converges on (who, what, when).

Retention and export across them: Notion 365 days with CSV; GitHub 180 days (90 for the personal log) with JSON and CSV; Linear and Vercel 90 days, Vercel by emailed CSV. Every one gates the workspace log to owners (and admins), and most to a paid plan.

Sources: https://www.notion.com/help/audit-log, https://linear.app/docs/audit-log, https://vercel.com/docs/audit-log, https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization, https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/reviewing-your-security-log, https://attio.com/help/reference/workspace-settings-billing/attio-plans-and-features. Mobbin screens: Vercel Activity (https://mobbin.com/screens/a111dca7-48a2-4456-bba7-acec68ff70f0), GitHub Security log (https://mobbin.com/screens/0a54f53c-2276-4628-92cc-a170af40fb43), Linear Security & access (https://mobbin.com/screens/13e6c6f5-0ec6-49d8-83e4-921de2120ae1), Attio settings (https://mobbin.com/screens/9542aa91-30f9-49a0-997d-aa3efe0c72f9), PlanetScale (https://mobbin.com/screens/d7448333-6400-49dd-b11f-e48e4e229200), Customer.io (https://mobbin.com/screens/5e4f44d9-4c65-4381-8681-d2921df2591e), Front (https://mobbin.com/screens/0c2efddc-d2d9-4a17-b589-34523d08e1d8), Dropbox (https://mobbin.com/screens/99f74382-4244-40e8-bc02-a1c8664b381a), Deputy (https://mobbin.com/screens/fd1a02ca-3bc4-47eb-bd05-a63926f531a3).

## References

**Project sources**: spec 0009 (the `audit.read` row and #36 in the code shape table), spec 0031 (AC-830, owner decision 8, the purge and the append only trigger), spec 0033 (AC-898, Recent activity, account deletion), spec 0039 (format, ⌘K synonyms), `packages/db/src/schema/team.ts` (`auditEvents`), `packages/contracts/src/team.ts` (`AUDIT_ACTIONS`), `packages/core/src/members/audit.ts` (`writeAudit`) and its 28 call sites, `packages/contracts/src/access.ts`, `apps/web/src/features/settings/nav.ts`, `RecentActivitySection.tsx`, `JobsScreen.tsx`, `features/trash/README.md`, `docs/scope/team-and-security.md` (#36).
