# 0046. History and logs

**Date**: 2026-10-23
**Status**: Proposed; milestone 1 building on the recommended defaults (owner decisions 1 to 7 pending)
**Scope**: #36 Audit log and privacy tools, first slice ([Team and security](../../scope/team-and-security.md))
**Numbering**: 0046 confirmed by the coordinator on 23 October 2026. This spec owns AC-4600 to AC-4649.
**Ask**: A120 (the owner, 23 October 2026): "...with a tab to keep historys and logs".

## Owner decisions needed

Each has a recommendation, which the build follows unless the owner says otherwise, and a runner up.

1. **Where History lives.** *Recommended*: one new Settings page, **History**, in the Workspace group between Background jobs and Trash, open to every member. It has two tabs: **Workspace changes** (owners and admins, `audit.read`) and **Your sign ins** (everyone, their own account). A member without `audit.read` sees the page with the one tab's content and no tab bar. *Runner up*: an owners and admins only "Audit log" page in Workspace, with sign ins left only on Account › Sign in and devices (Notion, Linear and GitHub split it this way).
2. **Recent activity on Sign in and devices.** *Recommended*: it stays where it is, unchanged (the owner approved that page's anatomy on 22 October), and History › Your sign ins shows the same list through the same call. Two doors to one list, no copy of the data. *Runner up*: move it to History and leave a one line link on Sign in and devices.
3. **Background jobs and Trash.** *Recommended*: both stay where they are, as their own Settings entries, and History neither absorbs nor repeats them. They are working tools with actions (cancel, confirm, restore, delete forever) at their own addresses (the trash is reached from every delete's Undo and from ⌘K), not records of the past. History sits between them in the nav, so the three "what happened" pages read as one cluster. *Runner up*: a third History tab that embeds Background jobs.
4. **CSV export.** *Recommended*: not in this slice. It comes with the privacy tools slice of #36 as a background job (the export machinery of spec 0040), filtered as the screen is. *Runner up*: a browser side CSV of the rows loaded so far.
5. **IP address and request id.** *Recommended*: neither is shown. Both stay stored for support and incident work. Account › Recent activity already never shows an IP (spec 0033, AC-898), and an IP is personal data that an admin rarely needs. *Runner up*: show the IP to owners only, in the details panel.
6. **Retention.** *Recommended*: keep every row for the life of the workspace (today's behaviour: append only, removed only by the workspace purge), and show all of it. The volume is small. *Runner up*: delete rows after one year (Notion keeps 365 days, GitHub 180, Linear and Vercel 90), which needs a migration with a narrow `security definer` delete, owned like `crm_purge`.
7. **A member's own display preferences in the admin log.** *Recommended*: `member.preferences_changed` (time zone, date format, week start, start page) is left out of Workspace changes. It is one person's own display choice, not a workspace change, and it would be the noisiest row. It is still stored. *Runner up*: show it under People.

## Summary

Settings gains **History**. Owners and admins open **Workspace changes**: every audited change in the workspace (invitations, joining, roles, removals, ownership, workspace settings, sign in rules, round robin and booking admin), newest first, one plain sentence per row ("Ada Lovelace changed Grace Hopper's role from Member to Admin"), who did it and when. In milestone 2, filters narrow it by person, by kind of change and by date, and a row opens a details panel with what changed, before and after. Everyone opens **Your sign ins**: their own account's last 90 days of sign ins and sign in changes, the list Account › Sign in and devices already shows. One new read procedure, `audit.list`, behind `audit.read`. No migration.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

| Feature | What this spec needs | When it is missing |
|---|---|---|
| Spec 0031 `audit_events` | the table, `writeAudit`, `AUDIT_ACTIONS`, the `audit_events_at` index | hard prerequisite (landed) |
| Spec 0009 access | `audit.read` (owners and admins), the access table and its walk test | hard prerequisite (landed) |
| Spec 0033 account security | `account.activity.list` and `RecentActivitySection` | hard prerequisite (landed) |
| Spec 0026 settings | `settingsNav`, `visibleSettingsNav`, `SettingsPage` | hard prerequisite (landed) |
| Library | SettingsLayout, SettingsSection, Tabs, Table, Select, DateRangePicker, Panel, DescriptionList, Avatar, Badge, RelativeTime, EmptyState, Button, Toolbar | all exist |

## Requirements

**User stories**:
- As an owner, I want to see who changed what in my workspace and when, so I can answer "who removed Grace?" without asking around.
- As an admin, I want to narrow the log to one person, one kind of change or one week.
- As an owner, I want to see exactly what a change changed, before and after.
- As any member, I want one place for my own sign in history.
- As a member, I want nobody to learn my IP address from a log.

**Acceptance criteria** (AC-4600 to AC-4636 used; the rest of the range is spare):

*Where it lives*
- **AC-4600**: Settings › Workspace lists **History** (icon `clock` in milestone 1; the library has no `history` icon, and adding one changes the Icon Registry baselines) between Background jobs and Trash, for every member. Its address is `/w/$slug/settings/history`, which opens Workspace changes for a holder of `audit.read`, else Your sign ins. Each tab has its own address: `/settings/history/changes` and `/settings/history/sign-ins`.
- **AC-4601**: A holder of `audit.read` sees two Tabs, "Workspace changes" and "Your sign ins", in that order. Anyone else sees no tab bar, only the sign ins section. `/settings/history/changes` opened without `audit.read` replaces itself with `/settings/history/sign-ins` (hidden means absent, never shown locked).
- **AC-4602**: History doesn’t absorb Background jobs or Trash; Trash moved into the Settings frame at /settings/trash (A120). Account › Sign in and devices is unchanged (owner decisions 2 and 3). *Milestone 2*: ⌘K's Settings pages list History, with the synonyms "audit log", "log", "activity" and "changes" (spec 0039, AC-1082).

*Workspace changes: the rows*
- **AC-4603**: The tab lists the workspace's audit rows newest first (by `at`, then by id within one transaction), 50 at a time, with **Show more** under the table while there are more. Every action in `AUDIT_ACTIONS` except those in `AUDIT_NOT_LISTED` (`member.preferences_changed`, owner decision 7) is listed: 30 of the 31 in the catalog today.
- **AC-4604**: The table has three columns: **When** (RelativeTime, "2 hours ago", with the exact date and time in the member's time zone on hover and focus), **Who** (the actor, see AC-4606) and **Change** (the row header: the sentence of AC-4605 without the actor's name at its start). Screen readers hear each row as the whole sentence, actor included.
- **AC-4605**: Each listed action has exactly one sentence template, in `history-strings.ts`, with the variants the table in Feature design lists. The templates are typed per listed action, and a unit test walks `AUDIT_KINDS` (which `audit.test.ts` pins to `AUDIT_ACTIONS`), so a new audited action can't land without its sentence and its kind, or its place in `AUDIT_NOT_LISTED`.
- **AC-4606**: People are named as they are now, with what happened to them: an active member by name; a removed member by the name they had, with a quiet "Former member" badge; a deleted account as "Deleted user"; the system as "System"; an API key (once #34 writes rows) as "API key" and its name; an actor whose member row can't be read as "Someone removed from this workspace". A join request's asker, who is not a member, is named from the request, with "Asked to join".
- **AC-4607**: Targets are named as they are now: a member by name (as AC-4606); an invitation by its address, or "the invite link"; a join request by the asker's name; a round robin, form or booking page by its current name; a booking as "<page title> on <date, time>"; the workspace as "the workspace". A target that no longer exists is "a deleted round robin" (form, booking page, booking), never an id. A booking's record link names the booking only ("linked Intro call on 24 Oct, 3:30 pm to a record"), never the record.
- **AC-4608**: *Milestone 2.* A row opens its details in a Panel beside the table (Enter, or a click anywhere on the row; Esc closes it and focus returns to the row). The panel shows the full sentence, the exact time with its UTC offset, who (with "Former member" or "Deleted user" as in the row), and **What changed**: a DescriptionList with one line per changed field, its name and "before → after" ("Role: Member → Admin"; a field set for the first time reads "set to …", a cleared one "cleared"). A row with no field changes says "No other details." Values are formatted as the app formats them elsewhere (roles by their labels, time zones by their names, dates in the member's format).
- **AC-4609**: *Milestone 2 (the panel); milestone 1 already sends no IP or request id, AC-4624.* No IP address and no request id appear anywhere on the screen or in the API answer (owner decision 5). The details never show a token, a code or a secret (none is stored, spec 0031, AC-830).
- **AC-4610**: A deleted account's own profile change shows no values: for `member.profile_updated` whose target is a deleted account, What changed reads "Removed with the account." (the read leaves the values out; the stored row is untouched).
- **AC-4611**: *Milestone 2.* In the Who column, a member's name has a row menu action "Show only <name>'s changes", which sets the Person filter to them, a former member included.

*Workspace changes: filters*
- **AC-4612**: *Milestone 2.* A Toolbar above the table holds three Selects: **Person** ("Everyone", "System", then the active members by name, and a former member once chosen from a row), **Kind** ("All changes", "People and roles", "Invitations and joining", "Workspace settings", "Sign in rules", "Scheduling"; the mapping in Feature design) and **Date** ("Any time", "Today", "Last 7 days", "Last 30 days", "Last 90 days", "Custom range…", which opens a DateRangePicker). Days are read in the member's time zone.
- **AC-4613**: *Milestone 2.* Filters are kept in the address (`?person=`, `?kind=`, `?from=`, `?to=`), so Back, a reload and a shared link show the same list. Changing a filter reads the first page again; the previous rows stay, dimmed and busy, until the answer arrives, so the table never flashes empty.
- **AC-4614**: *Milestone 2.* With any filter set, a quiet **Clear filters** button sits at the Toolbar's end.

*Workspace changes: states*
- **AC-4615**: Loading: the Table's skeleton rows (after the loading delay), in the loaded layout, so nothing moves when rows arrive.
- **AC-4616**: Empty log: the EmptyState title "No changes yet" with the text "Invitations, role changes, removals and settings changes show here." *Milestone 2*: filtered to nothing, "No changes match these filters." with Clear filters.
- **AC-4617**: The first page failing shows the EmptyState error "Couldn’t load workspace changes", with the data layer's message and Try again. A later page failing keeps the rows, shows a row EmptyState under them ("Couldn't load more changes.") with Try again, as Recent activity does.
- **AC-4618**: A 403 (the member lost `audit.read` while on the page) shows EmptyState "Only workspace owners and admins can read the audit log." (the permission's own message) in place of the table, and the next visit to History opens Your sign ins.

*Your sign ins*
- **AC-4619**: The tab shows the member's own last 90 days of security events through `account.activity.list`, drawn by the existing `RecentActivitySection` (same rows, same states, same Show more), under the heading "Your sign ins" and one line: "In every workspace, for the last 90 days." (RecentActivitySection's optional `title` and `description`, from the account lane; until they land the section keeps its own heading). Workspace changes has no section line: the tab names it.
- **AC-4620**: Nobody ever sees another person's sign ins here, owners included (that stays with spec 0033's follow-up for an owner view).

*The API*
- **AC-4621**: `audit.list` (a workspace procedure, `member` base) takes `workspace`, `cursor?` (opaque, at most 200 characters), `limit?` (1 to 100, default 50), `person?` (`{ kind: 'member', memberId }` or `{ kind: 'system' }`), `actions?` (1 to `AUDIT_ACTIONS.length` distinct `AuditAction`s), `from?` and `to?` (ISO datetimes; `from` inclusive, `to` exclusive, `from` before `to`). It answers `{ entries: AuditEntryView[], nextCursor? }`. Milestone 1's input is `workspace`, `cursor?` and `limit?` only, strict, so the filter fields arrive with milestone 2 and nothing goes unused.
- **AC-4622**: It requires `audit.read`; anyone else gets 403 `FORBIDDEN` with the catalog's message, before any audit row is read. It is listed in the access table (`listAuditEvents: { permission: 'audit.read' }`), and the table walk test refuses it to a member.
- **AC-4623**: Entries are only ever the caller's workspace's: the read runs in `withWorkspace` under the forced row level security policy, and also filters on `workspace_id`.
- **AC-4624**: Each entry is resolved on the server: actor and target names (AC-4606, AC-4607), member and round robin names inside before and after (a reassigned seat's people, an adjusted member), and the field changes as typed display values. The browser never receives a raw `before` or `after` blob, an IP or a request id.
- **AC-4625**: One page is at most 4 statements inside its transaction, whatever its size and filters: the workspace setting, the read's 3 second statement timeout, the page of rows, and one statement resolving every name the page mentions (skipped when the page names nothing). An empty page is 3. (The draft counted 3 and 2: `withWorkspace` sets the workspace in a statement of its own, and a timeout set inside the page statement would cover only the statements after it, so the timeout is its own statement.)
- **AC-4626**: *The 100,000 row timing is milestone 2.* The page statement reads `audit_events_at` (`workspace_id, at desc, id`) in index order (`order by at desc, id asc`), keyset paged on (`at`, `id`), with the filters as conditions on the walk. On a workspace holding 100,000 audit rows, every page (unfiltered, a sparse person, a sparse kind, a date range) takes under 50 ms at p95 warm in the database call, under a 3 second statement timeout.
- **AC-4627**: The cursor carries `at` at the database's microsecond precision (as text from Postgres, never through a JavaScript `Date`) and the id, so rows written in one transaction (an invite of 20, which share one `at`) never repeat or drop across pages. A cursor that doesn't parse is 400 `INPUT_INVALID`.
- **AC-4628**: No migration. No outbox row, no write of any kind (a read never writes).

*Data layer and quality*
- **AC-4629**: Screens read through `data.audit` only (`packages/data`, loaded with `import()`, not in the first load). It keeps one paged list per open History tab (filters, entries, next cursor, status), read afresh on every visit and every filter change, and dropped when the page leaves. Nothing about it enters the record store.
- **AC-4630**: The list is not live: no change event refreshes it (the log changes rarely, and a fresh read on each visit is enough). Show more and filter changes are the only reads.
- **AC-4631**: History's routes load lazily, outside the first load, and the first load doesn't grow.
- **AC-4632**: *Milestone 2 in full; milestone 1 checks axe at 1280 and 375 in both themes on the Tabs, the Table and Show more.* Everything is keyboard usable and meets WCAG AA in both themes: the Tabs, the three Selects, the DateRangePicker, the Table (arrow keys, Enter opens details), the Panel (focus moves into it and back to the row on close), Show more. axe is clean at 1280 and 375 wide.
- **AC-4633**: *Milestone 2 in full; milestone 1's Table already scrolls in its own box.* At phone width the Table scrolls sideways in its own box (`isScrollable`), the Toolbar's Selects wrap, and the Panel covers the view.
- **AC-4634**: Guard: a member (no `audit.read`) calling `audit.list` gets 403 `FORBIDDEN`, and so does a principal whose role lost it; an API key without the `audit.read` scope too.
- **AC-4635**: Guard: two workspaces each with audit rows; each owner's `audit.list` returns only their own, with and without filters, and a cursor minted in one workspace, used in the other, still returns only the other workspace's own rows (a cursor is a position, never a key). The existing guard (every tenant table forces row level security with a policy) still covers `audit_events`.
- **AC-4636**: Every screen file opens with its Purpose, Main task and Leaves out brief, and `apps/web/src/features/settings/README.md` gains a History section.

## Decision

Build the recommendations: a History page in Settings › Workspace with two tabs, one new read procedure `audit.list` (`audit.read`) that pages `audit_events` newest first through its existing index and resolves every name in one more statement, a `data.audit` paged list read afresh on each visit, and a screen made from library parts only. Your sign ins reuses `account.activity.list` and `RecentActivitySection` as they are. No migration, no export, no IP. See [rationale.md](rationale.md).

## Feature design

### The kinds of change

`AUDIT_KINDS` in `packages/contracts/src/audit-kinds.ts` (`@crm/contracts/audit-kinds`, no Zod, re-exported by `audit.ts` and by `@crm/data`), one list the API, the screen and later the export share; `team.ts`, which holds `AUDIT_ACTIONS`, stays untouched:

| Kind | Label | Actions |
|---|---|---|
| `people` | People and roles | `member.role_changed`, `member.removed`, `member.left`, `workspace.ownership_transferred`, `account.deleted`, `member.profile_updated` |
| `joining` | Invitations and joining | `invitation.created`, `invitation.resent`, `invitation.revoked`, `invitation.accepted`, `invitation.link_set`, `invitation.link_revoked`, `workspace.domains_set`, `join_request.created`, `join_request.approved`, `join_request.declined` |
| `workspace` | Workspace settings | `workspace.updated`, `workspace.deleted`, `workspace.restored` |
| `security` | Sign in rules | `workspace_security.changed`, `workspace_security.signed_out_everyone` |
| `scheduling` | Scheduling | `rotation.adjusted`, `rotation.adjustment_undone`, `booking.reassigned`, `booking.no_show`, `booking.no_show_undone`, `routing.changed`, `form.owner_changed`, `booking.record_linked`, `booking.record_unlinked` |
| (none) | not listed (`AUDIT_NOT_LISTED`, owner decision 7) | `member.preferences_changed` |

A test pins that every action is in exactly one kind or in the not listed set: 30 listed and 1 not listed, 31 in all.

**Landing note**: `wip/profile-order` adds `booking_page.profile_reordered` (32 actions). Its kind and sentence can't be written before it lands, since a `Record` over the listed actions refuses an unknown key. Whichever of the two lands second adds it to `AUDIT_NOT_LISTED` (the safe default: one person's own page order, like preferences), or gives it a kind and a sentence if the owner says to list it (owner question 3). Otherwise `audit.test.ts` goes red.

### Sentence templates (the 30 listed actions of the 31 in the catalog)

`AUDIT_ACTIONS` holds 31 on land/r13 (24b5b05d): the 28 of the first draft, plus `form.owner_changed`, `booking.record_linked` and `booking.record_unlinked`. `{actor}` is the Who column's name (AC-4606); the Change column shows the sentence from the word after it, capitalised. `{member}` is a member target, named as AC-4606. Braces name the entry's `params`.

| Action | Sentence | What changed (details) |
|---|---|---|
| `invitation.created` | {actor} invited {email} as {role} | Role |
| `invitation.resent` | {actor} resent the invitation to {email}; with a role change: {actor} resent the invitation to {email}, now as {role} | Role, before → after, when it changed |
| `invitation.revoked` | {actor} cancelled the invitation to {email} (matching "Cancel invite") | none |
| `invitation.accepted` | by email: {actor} accepted the invitation and joined as {role}; by link (`via: 'link'`): {actor} joined through the invite link as {role}; already a member: {actor} used the invitation to {email} and was already a member | Role |
| `invitation.link_set` | made (`created`): {actor} turned on the invite link, joining as {role}; reset (`reset`): {actor} made a new invite link, and the old one stopped working; otherwise: {actor} changed the invite link's {fields} | Joins as, Expires, Uses allowed |
| `invitation.link_revoked` | {actor} turned off the invite link | none |
| `workspace.domains_set` | {actor} changed the email domains that can ask to join: added {added}, removed {removed} (either part left out when empty) | Domains, before → after |
| `join_request.created` | {asker} asked to join the workspace (Who: the asker, "Asked to join") | none |
| `join_request.approved` | {actor} let {member} join as Member; already a member: {actor} approved {member}'s request, and they were already a member | Role |
| `join_request.declined` | {actor} declined {asker}'s request to join; closed by the system (`reason: 'account_deleted'`): {asker}'s request to join closed when they deleted their account (Who: System) | none |
| `member.role_changed` | {actor} changed {member}'s role from {before} to {after} | Role |
| `member.removed` | {actor} removed {member} from the workspace | none |
| `member.left` | {actor} left the workspace | none |
| `workspace.ownership_transferred` | {actor} made {member} an owner, and became an admin | {member}'s role, {actor}'s role |
| `account.deleted` | {actor} deleted their account and left the workspace (Who reads "Deleted user") | none |
| `member.profile_updated` | own: {actor} changed their {fields}; another's: {actor} changed {member}'s {fields}. Fields: name, time zone, public handle, bio, joined as "name and time zone". With no field this screen knows left (photo-switch's `pictureHidden`): {actor} changed their profile, or {actor} changed {member}’s profile | each field, before → after (AC-4610 for a deleted account) |
| `member.preferences_changed` | not listed (owner decision 7); if the owner says show: {actor} changed their {fields} (time zone, date format, week start, start page, home sections) | each field |
| `workspace.updated` | name only: {actor} renamed the workspace from {before} to {after}; otherwise: {actor} changed the workspace's {fields} (name, time zone, address) | each field |
| `workspace.deleted` | {actor} deleted the workspace, to be gone for good on {purgeAfter} | Deleted, Removed for good on |
| `workspace.restored` | {actor} restored the workspace | none |
| `workspace_security.changed` | two factor only: {actor} turned on (off) required two factor sign in; session length only: {actor} set sessions to end after {days} days (removed the session limit); both: {actor} changed the sign in rules | Require two factor, Session length |
| `workspace_security.signed_out_everyone` | {actor} signed everyone out of the workspace | none |
| `rotation.adjusted` | {actor} adjusted {person}'s count in {rotation} by {units} ("+2", "−1") | Note, when one was given |
| `rotation.adjustment_undone` | {actor} undid a {units} adjustment to {person}'s count in {rotation} | none |
| `booking.reassigned` | one seat: {actor} reassigned {booking} from {from} to {to}; several: {actor} reassigned {count} seats of {booking} | each seat: before → after; Reason, when given |
| `routing.changed` | a form: {actor} published {form} with changed routing rules; a booking page: {actor} changed the routing rules of {page} | Rules, count before → after; Changed rules, a count |
| `booking.no_show` | {actor} marked {booking} as a no show | none |
| `booking.no_show_undone` | {actor} took back the no show on {booking} | none |
| `form.owner_changed` | {actor} changed who gets {form}’s leads | Leads go to, before → after (a member or a round robin) |
| `booking.record_linked` | {actor} linked {booking} to a record | none: the record is never named nor its id sent |
| `booking.record_unlinked` | {actor} unlinked a record from {booking} | none: the record is never named nor its id sent |

### Data model

None. `audit_events` (spec 0031) already has everything: `at`, the actor's three columns, `action`, `target_type`, `target_id`, `before` and `after` (changed fields only), `ip`, `request_id`, and the indexes `audit_events_at` (`workspace_id, at desc, id`) and `audit_events_target` (`workspace_id, target_type, target_id, at desc`). Rows stay append only; retention is unchanged (owner decision 6).

### Service (`packages/core/src/audit/`, new)

- `listAuditEvents(scope, input)`:
  1. `requirePermission(scope, 'audit.read')`, before any read (AC-4622).
  2. `inWorkspace(scope, tx => …)` under `statement_timeout = 3s`:
     - **The page**: `select id, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at, actor_type, actor_member_id, action, target_type, target_id, before, after from audit_events where workspace_id = $ws and action = any($listed) [and at <= $cAt and (at < $cAt or id > $cId)] order by at desc, id asc limit $limit + 1`, `$listed` being every action in `AUDIT_KINDS` (so an action the screen doesn't know yet never reaches it). Milestone 2 adds the filters as conditions on the walk. `ip` and `request_id` are never selected, and neither is `actor_id`.
     - **The names** (skipped for an empty page): one `union all` statement over `members` (ids from actors, member targets and member ids inside before and after: `memberId`, `from`, each seat's `memberId`), `invitations` (`email`, `kind`), `join_requests` (`name`), `rotations` (`name`), `forms` (`name`), `booking_pages` (`title`), and `bookings` joined to `booking_pages` (start and title), each branch `where workspace_id = $ws and id = any($ids)`, answering `(kind, id, name, state)`.
  3. Pure mapping per action (`toEntryView`, unit tested per action): the raw row plus the names into a strict `AuditEntryView` variant; unknown keys in `before` and `after` are dropped, never passed through; AC-4610's rule applies here.
- Access table: `listAuditEvents: { permission: 'audit.read' }`.

### API surface

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `audit.list` | `workspace`, `cursor?`, `limit?` (1 to 100, default 50), `person?`, `actions?`, `from?`, `to?` | `{ entries: AuditEntryView[], nextCursor? }` | `member` base, `audit.read` | 403 `FORBIDDEN`, 400 `INPUT_INVALID` |

Contracts (`packages/contracts/src/audit.ts`, new; joined into `contract` as `audit`):
- `AuditListInput` (`WorkspaceScoped.extend(…)`, strict; milestone 1: `workspace`, `cursor?` of at most 200 characters, `limit?` 1 to 100, default 50), `AuditPage`, `AuditKind`; and from `audit-kinds.ts`: `AUDIT_KINDS`, `AUDIT_NOT_LISTED`, `AUDIT_PAGE = 50`, `auditKindOf`.
- `AuditPerson`: `{ kind: 'member', memberId, name, state: 'active' | 'former' | 'deleted' }` | `{ kind: 'asker', name }` | `{ kind: 'system' }` | `{ kind: 'api_key', name? }` | `{ kind: 'unknown' }`.
- `AuditTarget`, discriminated on `type`: a member (`person: AuditPerson`), an invitation (`id`, `email?`, `isLink`), a join request (`id`, `name?`), the workspace (no more), a round robin, form or booking page (`id`, `name?`, `isGone`), a booking (`id`, `pageTitle?`, `startsAt?`, `isGone`). A booking target never carries the record it may be linked to.
- `AuditChange`: `{ field, before?: AuditValue, after?: AuditValue }`, `field` from the closed `AUDIT_FIELDS`; `AuditValue` is `{ kind: 'text', text }` | `{ kind: 'role', role }` | `{ kind: 'person', person: AuditPerson }` | `{ kind: 'rotation', name?, isGone }` | `{ kind: 'flag', on }` | `{ kind: 'number', value }` | `{ kind: 'time', at }` | `{ kind: 'zone', zone }` | `{ kind: 'list', items }`.
- `AuditEntryView`: a discriminated union on `action`, one strict variant per action (actions whose params match share one, `z.literal([...])`), each with `id`, `at` (UTC to the microsecond), `actor`, `target`, its own `params` (the braces in the sentence table) and `changes`.

### Client (`packages/data`)

`data.audit` (module loaded with `import()` on first use):
- `openLog(workspace)` (milestone 1; `filters` and `setFilters` come with milestone 2): a paged list with `getSnapshot`/`subscribe`: `{ entries, hasMore, status: 'loading' | 'ready' | 'more' | 'failed' | 'more-failed' | 'forbidden', message? }`, plus `more()`, `retry()`, `retain()` (the screen holds it while shown; let go, it is disposed a moment later unless held again, so a remount keeps it) and `dispose()`, which aborts an answer still out. The route loader opens it and its first page starts at once.
- Types re-exported for the screen (`AuditEntryView`, `AuditKind`, `AuditPerson`), as the AGENTS rule says.
- Your sign ins keeps `data.account.activity` as it is.

### Screens (`apps/web/src/features/settings/`)

- `nav.ts`: a `history` entry (icon `clock`, no `requires`) between `jobs` and `trash`, its label from `history-nav-strings.ts`, and `settingsPageOf` for `history`, `history/changes` and `history/sign-ins`. `history-href.ts` (no imports) holds `HISTORY_TABS`, `isHistoryTab` and `historyHref(slug, tab?)`, re-exported by `nav.ts`.
- Routes `w.$slug.settings.history.index.tsx` (redirects by permission, replacing the entry; a file named `w.$slug.settings.history.tsx` would be the parent of the two tabs and redirect them too), `….history.changes.tsx` and `….history.sign-ins.tsx`, their components split from the first load; the changes route reads `access.mine`, sends a reader without `audit.read` on to `/sign-ins`, and opens the log. No loader imports `nav.ts` or a strings module.
- `HistoryScreen.tsx`: `SettingsPage` (`hasTabs` for `audit.read` holders) with Tabs, then the tab's content.
- `WorkspaceChangesTab.tsx`: no section line (the tab names it): a Table labelled "Workspace changes" (When, Who, Change; Change the row header, read as the whole sentence; `isScrollable`), Show more, and EmptyState for every state. Milestone 2 adds the Toolbar with the three Selects (and DateRangePicker for a custom range) and the details Panel with DescriptionList.
- `history-lines.ts` (pure, unit tested): `entrySentence(entry, format)` (the full sentence and the Change column's), `whoOf(person)`, `kindOf(action)`; milestone 2 adds `changeLines(entry)` and the date presets resolved in the member's zone.
- `history-strings.ts`: every template and label.
- `SignInsTab`: `RecentActivitySection` with the tab's own heading ("Your sign ins") and line ("In every workspace, for the last 90 days.").

Library: no new component and no new variant. If the guardian finds the Table can't take a row menu in the Who cell (AC-4611), the action moves into the details Panel ("Show only <name>'s changes") rather than adding a variant.

### Value sourcing

| Shown | Value | Source |
|---|---|---|
| When | relative and exact time | `audit_events.at`; the member's zone and format (`PreferencesScope`) |
| Who | name and state | `members.name`, `members.status` (`removed` → Former member), deleted account (`user_id` null and the Deleted user name) → Deleted user; `actor_type = 'system'` → System |
| Asker | name | `join_requests.name` |
| Invitation | address or "the invite link" | `invitations.email`, `invitations.kind` |
| Round robin, form, booking page | name | `rotations.name`, `forms.name`, `booking_pages.title` |
| Booking | page title, start | `bookings` start joined to `booking_pages.title` |
| Role labels | Owner, Admin, Member | `ROLE_LABELS` |
| Time zone names | "India Standard Time" | the browser's `Intl` from the stored zone id |
| Person filter | active members | `data.members` (already loaded by Settings) |
| Kinds | labels and actions | `AUDIT_KINDS` |

### Key invariants

- Only `audit.read` holders ever receive an audit entry; the check runs before the read.
- No IP, request id, raw `before`/`after`, token or code leaves the server.
- One page is at most 3 statements, in index order, keyset paged.
- `audit.list` writes nothing.
- Every catalog action has a sentence and a kind (or is listed as not shown), pinned by tests.
- A record link row (`booking.record_linked`, `booking.record_unlinked`) never names the record and never sends its id: the record may be hidden from the reader (the fa9fe395 security fix). The service never reads `recordId` out of the row.

### Security model

`audit.read` is held by owners and admins (spec 0009). Admins see owners' actions too, including the sign in rules (owner only to change, readable by admins here): the log is for accountability, and spec 0009's catalog gives `audit.read` to admins. API keys may hold `audit.read` once #34 opens (it isn't in `KEY_FORBIDDEN_PERMISSIONS`). Row level security keeps every read in the workspace; the service filters on it too. Addresses of invitees and askers are shown to the same people who already see them on Members (`members.invite`, also owners and admins).

A person's own profile and preference changes reach them only through Workspace changes, so only owners and admins see them today (SA26). A "You" scope in History (your own profile and preference changes, failed sign in attempts) is a follow-up after milestone 2 (owner question 17).

### Critical test scenarios

- Happy path: invite two people, change a role, rename the workspace, adjust a rotation; the owner's `audit.list` answers five entries newest first with resolved names and changes; verifies **AC-4603**, **AC-4621**, **AC-4624**.
- Every action: one fixture row per catalog action through `toEntryView` and `entrySentence`, snapshot of the 28 sentences; verifies **AC-4605**, **AC-4607**.
- Names: a removed member, a deleted account, a deleted rotation, a system decline; verifies **AC-4606**, **AC-4607**, **AC-4610**.
- Paging: an invite of 20 (one `at`) across pages of 7 returns each row once; verifies **AC-4627**.
- Filters: person, system, kind, date range, and all at once; verifies **AC-4612**, **AC-4621**.
- Guards: member 403, another workspace's rows never returned; verifies **AC-4634**, **AC-4635**.
- Statements: counted from the statement log; EXPLAIN on 100,000 seeded rows; verifies **AC-4625**, **AC-4626**.
- Browser: the flow opens History as owner and as member, filters, opens details, Esc returns focus; axe both themes, 1280 and 375; verifies **AC-4600**, **AC-4601**, **AC-4608**, **AC-4632**, **AC-4633**.

## Build plan

Tracer Bullet: milestone 1 is a thin, real thread to production.

**Milestone 1: the log, end to end** (no filters; building now). It claims AC-4600, AC-4601, AC-4603 to AC-4607, AC-4610, AC-4615 to AC-4625, AC-4627 to AC-4631 and AC-4634 to AC-4636. Moved to milestone 2: AC-4602's ⌘K synonyms, AC-4608 to AC-4614, AC-4616's filtered empty half, AC-4626's 100,000 row timing, and the full AC-4632 and AC-4633.
1. Contracts: `audit.ts` (`AuditListInput`, `AuditEntryView` per action, `AuditPage`, `AUDIT_KINDS`), the contract namespace, satisfies **AC-4621**.
2. Core: `listAuditEvents` with the page and names statements, `toEntryView` per action, the access table entry; unit and guard tests, satisfies **AC-4603**, **AC-4606**, **AC-4607**, **AC-4610**, **AC-4622** to **AC-4625**, **AC-4627**, **AC-4628**, **AC-4634**, **AC-4635**.
3. API: `audit.list` on the `member` base, satisfies **AC-4621**.
4. Data layer: `data.audit.openLog`, satisfies **AC-4629**, **AC-4630**.
5. Screens: the History nav entry and routes, the Tabs (Your sign ins reusing `RecentActivitySection`), the Table with sentences and Show more, every state; `history-lines.ts` and its tests; `history.flow.ts` and a loading-shape entry, satisfies **AC-4600**, **AC-4601**, **AC-4603** to **AC-4605**, **AC-4615** to **AC-4620**, **AC-4631**, **AC-4636**. Reviewers: `security-access-reviewer` and `state-performance-reviewer` on the server pass; all four on the screen pass.

**Milestone 2: details and filters**
6. The details Panel with What changed, satisfies **AC-4608**, **AC-4609**.
7. The Toolbar filters in the address, Clear filters, "Show only <name>'s changes", the date presets in the member's zone, satisfies **AC-4611** to **AC-4614**, **AC-4626** (filtered pages).
8. ⌘K synonyms; a `history` icon with its Icon Registry baselines; a field label for `pictureHidden`; README; `state-performance-reviewer`; EXPLAIN on the 100,000 row seed into `verify.md`; `/check verify`, satisfies **AC-4602**, **AC-4626**, **AC-4632**, **AC-4633**.

## Consequences

**Positive**:
- The audit rows written since spec 0031 become useful, with no schema change.
- One place to look for what happened, for every role, without moving pages the owner just approved.
- The per action sentence test keeps the log readable as new actions arrive.

**Negative / tradeoffs**:
- Admins can't yet export the log or see changes to records, views, objects or access rules: those aren't audited yet (see Follow-up).
- Names are as they are now, not as they were then: a renamed form shows its new name. The details keep the old values where the row stored them.
- A filter on a rare person or kind walks the workspace's log from the newest row; fine at today's volumes, measured in `verify.md`, with an index as the fallback.

**Neutral**:
- Your sign ins shows the same list as Account › Sign in and devices, from the same call.

## Follow-up

- [ ] CSV export of the filtered log as a background job (owner decision 4), with the export itself audited (`audit.exported`).
- [ ] Audit the remaining #36 subjects: objects and attributes (`schema.*`), access rules (`access.*`, spec 0032), teams, API keys and webhooks (#34, #35), imports and exports (spec 0040), trash purges (`records.purged`), support access (#39). Each lands its sentence and kind with its action.
- [ ] Privacy tools (#36's second slice): export everything about one person; a narrow, audited scrub of a deleted person's values inside `before` and `after`.
- [ ] Retention, if the owner picks the runner up of decision 6.
- [ ] An index `(workspace_id, actor_member_id, at desc)` only if AC-4626 misses on a real workspace.
- [ ] An owner view of members' two factor state and sign ins (spec 0033 follow-up).

## Open questions

- Is "History" the right nav label beside "Background jobs" and "Trash", or should it read "Audit log" (Notion, GitHub, Linear and Vercel all say audit log)? Recommendation: "History", the owner's own word, with "audit log" as a ⌘K synonym.
- The catalog holds 31 actions on land/r13; `booking_page.profile_reordered` (profile-order) makes 32 (see the landing note under the kinds). Any further action needs its sentence and kind, or its place in `AUDIT_NOT_LISTED`, before it merges (AC-4605 enforces it).
- `booking.reassigned`'s `reason` is the closed `AssignmentReason` list (`fair`, `manual`, `reassigned` and the rest), so it is shown as a value, never free text.

## Rationale

See [rationale.md](rationale.md).
