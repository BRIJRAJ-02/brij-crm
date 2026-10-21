# 0031. Workspaces, members and teams

**Date**: 2026-10-20
**Status**: Proposed
**Scope**: #23, Slice 6 ([Team and security](../../scope/team-and-security.md))
**Numbering**: handed out by the coordinator on 20 October: 0029 round robin and 0030 team calendar (another lane), 0031 to 0033 this slice, 0034 app shell and sidebar, 0035 availability schedules. AC-728 to AC-800 are left for 0029 and 0030; this spec owns AC-801 to AC-840.

## Owner decisions needed

The owner accepted every recommendation below on 20 October 2026; each is now a decision.

Short questions, each with my recommendation and the runner up. The spec is written to the recommendations; a different answer changes only the lines that name it.

1. **The fourth role.** Recommended: `guest`, read only on the objects an admin shares with the Guest role (spec 0032), sees members by name only, and takes no seat. Runner up: no fourth role until a customer asks.
2. **Ways in.** Recommended: an email invitation (on), plus an invite link and "people at @acme.com may ask to join" (both off by default, an admin turns each on; a join request waits for an admin's approval). Runner up: email invitations only for now.
3. **Who gets past `SIGNUP_ALLOWLIST`?** Recommended: a valid email invitation opens sign up for that one email only; invite links and domain requests do not (they need an existing account, or the list). Runner up: every valid invite route opens sign up.
4. **Owners.** Recommended: several owners allowed (spec 0009 supports it), plus a one step "Transfer ownership" that makes someone owner and the caller an admin in one transaction. Runner up: exactly one owner, transfer as the only way to change it.
5. **Teams.** Recommended: flat teams, no nesting, no team leads; a member in any number of teams; managed by `teams.manage` (owners and admins). Runner up: teams with leads who manage their own membership.
6. **Removing someone.** Recommended: automatic effects (their booking pages paused or they leave round robin pools, their calendar connections in this workspace disconnected with tokens revoked, their meetings kept and flagged), and an optional "Reassign their records and open tasks to" in the remove dialog, run as a background job. Runner up: no reassignment; bulk edit (#22) does it afterwards.
7. **Workspace address (slug).** Recommended: fixed in this slice; a slug once used is never reused, and links in emails would break. Runner up: allow a change with a permanent redirect.
8. **Audit storage.** Recommended: one append only tenant table, `audit_events`, written in the same transaction as each change, starting here and reused by specs 0032 and 0033; #36 builds its screens. Runner up: wait for #36 and rebuild history from the outbox (pruned after 24 hours, so history is lost).
9. **Deleting a workspace.** Recommended: owners only, typing the slug to confirm; the workspace is soft deleted at once (nobody can open it) and purged 30 days later by a job; an owner can restore it within those 30 days. Runner up: leave delete to #36 and #37.
10. **Where "last used workspace" lives.** Recommended: on the server (`auth.user_prefs.last_workspace_id`), so it follows the person to every device. Runner up: this browser's storage only.
11. **Seats.** Recommended: seats used = active non guest members + open non guest email invitations; a `seatsUsed` hook and a `SEAT_LIMIT` check that allows everything until #38 sets plan limits. Runner up: count only active members (an invite can then overshoot the plan).
12. **Pictures (workspace logo, member avatar).** Recommended: store the columns now, show initials on a colour (and Google's photo where the account has one) until file storage (#32, R2) arrives, then add upload. Runner up: build a small image upload now in Postgres.

## Summary

This brings the team in. A person in several workspaces gets a switcher and lands where they last were. Owners and admins invite by email (and, when turned on, by link or by email domain with approval), set roles (owner, admin, member, guest), transfer ownership, remove people with clear effects on their bookings, calendars and records, and group people into teams that access rules (spec 0032) target. Members edit their own name, picture and time zone per workspace, owners can delete a workspace with a 30 day window, and every change is written to a new audit table. Screens live under spec 0026's Settings (Workspace › General, Members, Teams; Account › Profile), plus `/invite/:token` and `/join`.

Reasoning and options: see [rationale.md](rationale.md).

## What exists today

- `packages/core/src/members/members.ts`: `listMembers`, `getMyAccess`, `setMemberRole`, `removeMember` with spec 0009's owner rules; the contract exposes only `members.list` (and `access.mine`).
- Migration 0022: `members_keep_an_owner` (the last owner trigger, SQLSTATE `CRM01`).
- Spec 0009 reserved `workspace.manage`, `workspace.delete`, `members.invite`, `members.manage`, `teams.manage`, `billing.manage`.
- One person can already be in several workspaces (`me.get` answers an array; routes are `/w/:slug`), but there is no switcher, no "create another", and `/` always opens the oldest. There are no invitations at all; the only way in is creating a workspace.

## Requirements

**User stories**:
- As someone in several workspaces, I want to switch in two clicks and land where I last worked, on any device.
- As an owner or admin, I want to invite people with a role, so they join with the right access.
- As an invited person, I want the link to bring me in after I sign in with that address, and nobody else to be able to use it.
- As an owner, I want to hand the workspace to someone else, or delete it, without risk of losing it by accident.
- As an admin, I want removing someone to stop their bookings and calendar sync cleanly and let me hand their work to someone else.
- As a member, I want my name, picture and time zone right in each workspace.
- As an admin, I want teams that rules and reports can use, and guests who see only what I share.
- As an owner, I want every membership, role, team and workspace change recorded.

**Acceptance criteria** (this spec owns AC-801 to AC-840):

*Switcher and last used (slice 1)*
- **AC-801**: The sidebar's workspace menu lists every workspace in `me.get`, marks the current one, opens another's home on click, and ends with "Create workspace" (the existing create flow). Keyboard and screen reader usable.
- **AC-802**: Opening any `/w/:slug` page stores it as `auth.user_prefs.last_workspace_id` (at most once a minute per user). `/` and the post sign in redirect go there; a workspace the person has left or that was deleted falls back to their oldest, else to create workspace.

*Invite and accept (slice 2)*
- **AC-803**: Holders of `members.invite` invite 1 to 20 emails with one role. Admins invite as admin, member or guest; only owners invite as owner. An address that is already an active member is refused per address ("Already a member"); the rest still go. One open email invitation per address per workspace (a second invite resends).
- **AC-804**: An invitation link carries a random 32 byte token; only its SHA-256 is stored (`invitations.token_hash` and `auth.invitation_lookup`). Email invitations expire 7 days after their last send, are single use, and can be resent (new token, old link dead) or revoked.
- **AC-805**: `/invite/:token` shows "Ada invited you to Acme as a Member". Accepting an email invitation needs a signed in user with `emailVerified` true and the same email (lowercased); any other user sees "This invitation is for a***@example.com. Sign in with that address to accept." and joins nothing. Expired, revoked, used up and unknown tokens all answer the same `INVITE_INVALID` ("This invitation is no longer valid. Ask for a new one.").
- **AC-806**: Accepting, in one transaction: an active `members` row with the invitation's role (a returning removed person gets a new row; the old one stays `removed`), the `auth.workspace_membership` row, the invitation marked used, a `members` outbox row, an audit event; then the workspace home. Two tabs accepting join once.
- **AC-807**: An email that is not on `SIGNUP_ALLOWLIST` may create an account while it holds an open email invitation; the sign in page reached from the invitation prefills and locks the email (owner decision 3).
- **AC-808**: Invitation sends are limited to 50 an hour per workspace and 20 an hour per inviter (429 `RATE_LIMITED` with the wait), and 100 open invitations per workspace (409 `INVITES_LIMIT`). Emails go through `Mailer` with an idempotency key of invitation id plus send count. `invitations.peek` is limited to 20 a minute per IP.
- **AC-809**: Seats: `seatsUsed(workspace)` = active non guest members + open non guest email invitations. Every invite, accept, link join, approved request and role change from guest checks `SEAT_LIMIT` (unlimited until #38) and refuses 409 `SEAT_LIMIT` with "Your plan has no free seats." Guests never count.

*Members page (slice 3)*
- **AC-810**: Settings › Workspace › Members shows tabs "Members (N)" and "Invitations (N)", and "Join requests (N)" when any exist. Member rows: picture, name, email, teams, role, joined date; search by name or email; cursor paginated. Invitation rows: email or "Invite link", role, invited by, expiry, uses for a link. Guests see names only, no emails and no invitation tab; members see the list read only.
- **AC-811**: Owners and admins change roles with a Select offering only the roles they may grant (spec 0009's owner rules); a change to one's own role and "Leave workspace" confirm first; `LAST_OWNER` shows its message by the control. `members.setRole` and `members.remove` are new procedures over the existing services.
- **AC-812**: "Leave workspace" sits in the workspace menu for everyone, calls the removal on oneself, and lands on the next workspace (AC-802's fallback).

*Transfer ownership (slice 4)*
- **AC-813**: An owner's row menu on another active non guest member offers "Transfer ownership": a confirm naming the person, then one transaction that makes them owner and the caller admin, with one audit event `workspace.ownership_transferred`. Several owners stay allowed (owner decision 4).

*Removal effects (slice 5)*
- **AC-814**: Removing a member (or a member leaving), in the same transaction: `members.status = 'removed'`, `left_at`, `removed_by`; their team memberships deleted; booking pages where they are the only host set to paused (`paused_reason = 'host_removed'`); they leave every round robin host pool (`booking_page_members`); their calendar connections in this workspace marked `revoked`; an audit event; a `members` and an `access` outbox row.
- **AC-815**: After that commit, a job revokes each removed connection's tokens with the provider and deletes the stored tokens; a failure retries (spec 0008) and never blocks the removal. Their synced meetings stay, flagged `organizer_removed`, and their existing bookings stay with a "Host removed" badge for admins to reassign.
- **AC-816**: The remove dialog lists what will happen (counts of paused pages, calendars, open tasks, records they own) and offers an optional "Reassign their records and open tasks to" member picker. When picked, a background job (spec 0008, run as the remover through `enterAsActor`) moves every member typed value naming them on live records, and the assignee of their open tasks, to the chosen member, with normal value history; its progress shows in Background jobs.
- **AC-817**: A removed person's sessions stay (they keep their other workspaces); their live connection to this workspace is cut and their next request answers `NOT_FOUND` (spec 0009, AC-146).

*Invite link and domain join (slice 6)*
- **AC-818**: An admin can turn on one invite link per workspace with a role (member or guest), an optional expiry and an optional maximum uses; reset makes a new token; off revokes it. A signed in user with a verified email opening it joins (seat check, AC-809); the allowlist still applies to new accounts (owner decision 3).
- **AC-819**: An admin can add email domains to `workspace_domains`, only domains of their own verified email and never a public mail domain (a fixed list: gmail.com, outlook.com and similar). With a domain on, a signed in user whose verified email matches sees the workspace on `/join` with "Ask to join"; that creates a `join_requests` row and emails the workspace's admins. Both settings are off by default.
- **AC-820**: An admin approves (as member or guest, seat check) or declines a request from the Join requests tab; approval joins the person and emails them; a decline is silent to the requester beyond "Your request is pending" until 30 days pass. One open request per person per workspace.

*Profile (slice 7)*
- **AC-821**: Settings › Account › Profile edits the caller's member name (1 to 80 characters) and time zone in this workspace (`updateMyMemberProfile`); the picture shows Google's photo or initials on a colour (owner decision 12). The change reaches other members' screens through a `members` row.

*Workspace settings and delete (with slice 7)*
- **AC-822**: Settings › Workspace › General edits the workspace name (`workspace.manage`, 1 to 64 characters) and default time zone, shows the address read only with copy, and the logo as initials until #32. A rename updates `workspaces.name` and `auth.workspace_directory.name` in one transaction.
- **AC-823**: An owner deletes the workspace from a danger section by typing its slug: `workspaces.deleted_at` and `purge_after = now() + 30 days` are set, every member loses access at once (the door refuses a deleted workspace with `NOT_FOUND`), and members are emailed. Owners see "Acme will be deleted on 19 November. Restore" when they open it within the window; restore clears both columns. A daily job purges workspaces past `purge_after` in batches.

*Teams (slice 8)*
- **AC-824**: Holders of `teams.manage` create, rename and delete teams and add or remove members. A team has a name (1 to 64 characters, unique per workspace ignoring case), an icon and a colour from the existing pickers. Teams are flat. Guests may be in teams.
- **AC-825**: The door fills `teamIds` from `team_members` inside its one `withWorkspace` call (spec 0009's AC-149 budget still holds), and `access.mine` returns them. A team membership change stores an `access` outbox row naming the members whose teams changed.
- **AC-826**: Deleting a team is refused 409 `TEAM_IN_USE` while an access rule (spec 0032) names it, listing the objects; otherwise it deletes the team and its memberships with an `access` row.
- **AC-827**: Every active member can list teams and their members (`teams.list`); guests see team names only.

*Guest (slice 9)*
- **AC-828**: The role enum gains `guest`. `ROLE_PERMISSIONS.guest` is empty, `ROLE_LABELS.guest` is "Guest", and a guest's default object level is `none`; spec 0032's rules may grant the Guest role `read` on an object, never `write`. A guest with nothing shared sees "Nothing has been shared with you yet. Ask an admin."
- **AC-829**: No procedure or event gives a guest another member's email, an invitation, a join request, or anything under `members.invite` or `teams.manage`; a guest's writes there answer 403 `FORBIDDEN`. The pinned role table test is updated in the same change.

*Across all slices*
- **AC-830**: `audit_events` is an append only tenant table under forced row level security: the app role may insert and select, never update or delete (a guard test tries both). Every action in this spec writes one row in its own transaction, with actor, action (from a catalog in contracts), target, and `before` and `after` of only the changed fields. No token, code or secret is ever stored in it.
- **AC-831**: Every new procedure has an access table entry (spec 0009, AC-139); a non member gets `NOT_FOUND`. `invitations.peek`, `invitations.accept`, `join.list`, `join.request` and `me.setLastWorkspace` join the door test's bootstrap list, and the two accept paths mint their scope inside `packages/core`.
- **AC-832**: Settings navigation (spec 0026) gains Workspace › General, Members, Teams (before Objects) and Account › Profile (before Preferences). A page the caller can't open is left out.
- **AC-833**: Every screen here is keyboard usable, labelled ("Role for Ada Lovelace"), and meets WCAG AA; `ux-interaction-reviewer` reviews each slice's screens.

## Decision

**Chosen option**: Option 1: membership stays in our own tenant `members` table (spec 0004 and 0009), with invitations, join requests, domains and teams as tenant tables beside it, and a global token lookup in the `auth` schema so acceptance can find its workspace before a scope exists.

**Implementation skills**: `crm-data-model-access` (house, `.claude/skills/crm-data-model-access/`) · `crm-api-backend` (house, `.claude/skills/crm-api-backend/`) · `crm-frontend-state` (house, `.claude/skills/crm-frontend-state/`) · `crm-design-system` (house, `.claude/skills/crm-design-system/`) · `security-and-hardening` (`addyosmani/agent-skills`, `.claude/skills/security-and-hardening/`) · `domain-modeling` (`mattpocock/skills`, `.claude/skills/domain-modeling/`) · `drizzle` (`.claude/skills/drizzle/`) · `resend` (`.claude/skills/resend/`) · `react-email` (`.claude/skills/react-email/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Dependencies

- **Spec 0009** (built): roles, owner rules, the trigger, `setMemberRole`, `removeMember`, `access` rows, the 4500 disconnect, `teamIds` (empty until slice 8).
- **Spec 0026**: the settings navigation and row pattern.
- **Spec 0008**: jobs for token revocation, reassignment and the purge.
- **Specs 0024 and 0025** (calendar sync, booking pages): the tables removal touches. **0029** (round robin, another lane) owns host pools; AC-814 only deletes the removed member's pool rows.
- **Spec 0032**: gives guests and teams their meaning; `TEAM_IN_USE` reads its rules (none until it lands).
- **Spec 0034** (app shell and sidebar, another lane): owns the sidebar; the switcher here is the workspace menu's content, placed wherever 0034 puts that menu.

### Data model sketch

Tenant tables carry `workspace_id`, audit columns and forced row level security unless marked `auth`. One migration per slice that needs it.

| Table | Change or columns | Rules | Slice |
|---|---|---|---|
| `auth.user_prefs` | `user_id` pk, `last_workspace_id` null, `updated_at` | global; written only by `me.setLastWorkspace` for the caller | 1 |
| `invitations` | `id`, `kind` (`email`, `link`), `email` null, `role`, `status` (`open`, `used`, `revoked`), `token_hash` bytea, `expires_at` null, `max_uses` null, `uses` int, `send_count`, `last_sent_at` | email kind: `email` set and lowercase, `max_uses = 1`; link kind: `email` null, role in (member, guest); unique (`workspace_id`, `email`) where open; unique (`workspace_id`) where `kind = 'link'` and open | 2, 6 |
| `auth.invitation_lookup` | `token_hash` pk, `workspace_id`, `invitation_id` | global, no row level security; written and deleted with the token in the same transaction | 2 |
| `audit_events` | `id` uuidv7, `at`, actor (`type`, `id`, `member_id`), `action`, `target_type`, `target_id`, `before` jsonb, `after` jsonb, `ip` inet null, `request_id` | insert and select only for the app role, plus a trigger refusing update and delete; indexes (`workspace_id`, `at` desc), (`workspace_id`, `target_type`, `target_id`) | 2 |
| `members` | add `avatar_url` null, `time_zone` null, `left_at` null, `removed_by` actor columns null | check: `left_at` set when status is `removed` | 3, 5, 7 |
| `booking_pages` | add `paused_reason` null | spec 0025 owns the table | 5 |
| `meetings` | add `organizer_removed` bool default false | spec 0024 owns the table | 5 |
| `workspace_domains` | `domain` (lowercase), `added_by` | unique (`workspace_id`, `domain`); a global index on `domain` for `/join` lives in `auth.workspace_domain_lookup` (`domain`, `workspace_id`) | 6 |
| `join_requests` | `id`, `user_id`, `email`, `status` (`open`, `approved`, `declined`), `decided_by` null, `decided_at` null | unique (`workspace_id`, `user_id`) where open | 6 |
| `workspaces` | add `logo_url` null, `time_zone` text default `'UTC'`, `purge_after` null | `deleted_at` exists | 7 |
| `teams` | `id`, `name`, `icon`, `color` | unique (`workspace_id`, `lower(name)`) | 8 |
| `team_members` | `team_id`, `member_id`, `created_at`, creator actor | pk (`workspace_id`, `team_id`, `member_id`); index (`workspace_id`, `member_id`) | 8 |
| `member_role` enum | add `guest` | its own migration step | 9 |

### State transitions

- invitation (email): `open` → `used` (accept) · `open` → `revoked` · `open` → `open` with a new token and expiry (resend).
- invitation (link): `open` (uses below `max_uses`, before `expires_at`) → `revoked` (off or reset; reset creates a new open row).
- join request: `open` → `approved` · `open` → `declined`.
- workspace: live → deleted (`deleted_at`, `purge_after`) → live (restore) or purged (job).
- member: `active` → `removed` (remove or leave; `left_at`, `removed_by`).

### Services (packages/core) and procedures

| Service → procedure | Key inputs | Outputs | Auth | Key errors |
|---|---|---|---|---|
| `setLastWorkspace` → `me.setLastWorkspace` (bootstrap) | `slug` | none | session, and an active member of it | 404 |
| `inviteMembers` → `invitations.create` | `emails[1..20]`, `role` | `created`, `refused[]` | `members.invite`; owner role needs owner | 403, 409 `INVITES_LIMIT`, 409 `SEAT_LIMIT`, 429 |
| `listInvitations` → `invitations.list` | cursor | open invitations | `members.invite` | 403 |
| `resendInvite`, `revokeInvite` → `invitations.resend`, `.revoke` | `invitationId` | the invitation | `members.invite` | 404, 429 |
| `createInviteLink` → `invitations.link.set` | `enabled`, `role`, `expiresAt?`, `maxUses?`, `reset?` | `{ url? }` | `members.invite` | 403 |
| `peekInvite` → `invitations.peek` (bootstrap) | `token` | `{ workspaceName, role, invitedEmailMasked? }` | none; rate limited | 404 `INVITE_INVALID` |
| `acceptInvite` → `invitations.accept` (bootstrap) | `token` | `{ slug }` | session | 404 `INVITE_INVALID`, 403 `INVITE_EMAIL_MISMATCH`, 409 `SEAT_LIMIT` |
| `listJoinable` → `join.list` (bootstrap) | none | workspaces whose domain matches the caller's verified email, with request state | session | none |
| `requestToJoin` → `join.request` (bootstrap) | `workspaceId` | the request | session, verified matching email, domain on | 404 |
| `decideJoinRequest` → `joinRequests.decide` | `requestId`, `approve`, `role?` | none | `members.invite` | 404, 409 `SEAT_LIMIT` |
| `setWorkspaceDomains` → `workspace.domains.set` | `domains[]` | domains | `workspace.manage` | 422 `DOMAIN_NOT_YOURS`, 422 `DOMAIN_PUBLIC` |
| `listMembers` → `members.list` (changed) | cursor, search | members with role, teams, joined, picture, time zone; no emails for guests | member | 404 |
| `setMemberRole` → `members.setRole` | `memberId`, `role` | member | spec 0009 rules | 403, 404, 409 `LAST_OWNER`, 409 `SEAT_LIMIT` |
| `removeMember` → `members.remove` | `memberId`, `reassignTo?` | `{ jobId? }` | spec 0009 rules | 403, 404, 409 `LAST_OWNER` |
| `leaveWorkspace` → `members.leave` | none | `{ next? }` | member | 409 `LAST_OWNER` |
| `transferOwnership` → `members.transferOwnership` | `memberId` | none | owner | 403, 404 |
| `updateMyMemberProfile` → `members.updateMe` | `name?`, `timeZone?` | member | member | 422 |
| `updateWorkspace` → `workspace.update` | `name?`, `timeZone?` | summary | `workspace.manage` | 403, 422 |
| `deleteWorkspace` → `workspace.delete` | `confirmSlug` | none | `workspace.delete` (owner) | 403, 422 `CONFIRM_MISMATCH` |
| `restoreWorkspace` → `workspace.restore` | none | summary | owner of a deleted workspace (a bootstrap read of the owner row) | 404 |
| `listTeams` → `teams.list` | none | teams with member ids | member | 404 |
| `createTeam`, `updateTeam`, `deleteTeam`, `setTeamMembers` → `teams.*` | as named | team | `teams.manage` | 403, 404, 409 `TEAM_NAME_TAKEN`, 409 `TEAM_IN_USE` |

Every list is cursor paginated.

### Value sourcing

| Action | Value | Source |
|---|---|---|
| `/` redirect | target workspace | `auth.user_prefs.last_workspace_id` if still an active membership, else oldest in `me.get` |
| invite | token, link | 32 random bytes, base64url; `APP_URL` + `/invite/<token>` |
| invite | expiry | `INVITE_DAYS = 7` in contracts |
| invite email | inviter, workspace | the inviter's `members.name`, `workspaces.name` |
| accept | matching email | the session's `email` and `emailVerified` against `invitations.email` |
| accept | new member's name | `auth.user.name`, else the email's local part |
| masked email | `a***@example.com` | first character of the local part, `***@`, the domain |
| seats | count | AC-809's formula; limit from `SEAT_LIMIT` (unlimited until #38) |
| domain join | public domains | `PUBLIC_EMAIL_DOMAINS` list in contracts |
| removal dialog | counts | booking pages by host, calendar connections, open tasks, live values naming the member |
| reassignment | target | `reassignTo`, an active non guest member |
| delete | purge date | `deleted_at + 30 days` (`WORKSPACE_PURGE_DAYS`) |
| profile picture | image | `auth.user.image` (Google), else initials and a colour from the member id |
| door | `teamIds` | `team_members`, in the door's query |
| audit | actor, request id, IP | the scope's actor, the request id, the edge's trusted client IP |

### Key invariants

- A live workspace always has an active owner (the trigger); transfer happens in one transaction.
- Only owners grant the owner role, by invite, role change or transfer.
- A token is never stored or logged in clear; used, revoked or expired ones grant nothing.
- An email invitation joins only the person whose verified email it names; link and domain joins need a verified email too.
- Guests take no seat and never see emails.
- A deleted workspace refuses every request except an owner's restore and the purge.
- `audit_events` rows never change.

### Security model

- Acceptance and join run before a workspace scope exists: they read only the `auth` lookups, then mint a bootstrap scope inside `packages/core`, as `createUserWorkspace` does.
- `invitations.peek` returns only a workspace name, a role and a masked email, at 20 a minute per IP; every invalid case answers the same.
- Invitation emails carry a link only; nothing joins on a click without the signed in Accept (mail scanners can't join anyone).
- Domain join needs an admin to opt in, a domain the admin's own verified email proves, never a public domain, and an approval per request.
- Calendar tokens of a removed member are revoked with the provider, not just deleted.
- STRIDE: spoofing (verified email match), tampering (hash lookup, server side seat checks), repudiation (audit row per action), disclosure (masked email, uniform invalid answer, no emails to guests), denial of service (caps and rate limits), elevation (owner only owner grants in core, guest capped at read in spec 0032).
- `security-access-reviewer` on every slice; `state-performance-reviewer` on slices 5 and 8 (the reassignment job, the door's team read).

### Configuration required

No new environment variables (`APP_URL`, `RESEND_API_KEY`, `MAIL_FROM` exist). Constants in contracts: `INVITE_DAYS`, `INVITES_LIMIT`, the send limits, `WORKSPACE_PURGE_DAYS`, `PUBLIC_EMAIL_DOMAINS`, `SEAT_LIMIT` (unlimited until #38).

### Screens

- **Workspace menu** (sidebar, spec 0034's placement): the workspace list with the current one checked, Create workspace, then Settings, Leave workspace, Sign out.
- **Workspace › General**: name row, time zone row, address (read only, copy), logo (initials), danger section with Delete workspace (a dialog asking for the slug, as Attio does).
- **Workspace › Members**: "Invite people" opens a dialog (an email tag input that takes pasted lists; a role Select with one line descriptions per role, as Obvious shows; a seat line when #38 sets limits). Tabs Members, Invitations, Join requests. Member row menu: Change role, Transfer ownership (owners), Remove from workspace (a dialog with the effects list and the optional reassign picker). An "Invite link" card (off by default: toggle, role, expiry, Copy, Reset) and an "Email domains" card (off by default) sit under the tabs, like Linear's Security page.
- **Workspace › Teams**: teams list (icon, name, count); a team page with rename, members (Add members picker, remove per row), Delete team.
- **Account › Profile**: name, time zone, picture (read only until #32).
- **`/invite/:token`** and **`/join`**: outside the workspace frame, in the sign in page's layout.

### Deleting a workspace, in detail (owner, 21 October 2026)

AC-823 stands, with these settled where it left them open. Each open point takes the safest default.

- **Confirm.** The owner types the workspace's name, not its slug (owner, 21 October). It must match exactly after trimming, else 422 `CONFIRM_MISMATCH`. The Modal says what happens in one sentence. Its InfoTip covers the 30 day restore window, says other members lose access at once, and suggests exporting what they want to keep first.
- **Where.** A danger section at the bottom of Settings › Workspace › General, for owners only. Others don't see it.
- **In the window.** The door refuses the workspace with `NOT_FOUND` for everyone. Booking pages and forms answer not found, since their lookups already skip deleted workspaces. A calendar sync for a deleted workspace stops without touching the provider. Restore clears both columns, audits it, and queues each connection's sync again. Every active member gets one email after the delete commits.
- **The purge.** The daily cleanup lists workspaces past `purge_after` through `crm_workspaces_to_purge`, owned by `crm_sweep`. For each one, the worker does three things in order:
  1. It marks the calendar connections `revoked` and queues their syncs, so each grant ends with the provider. It waits up to a day for that, then goes on.
  2. It deletes every tenant table's rows in foreign key order, children first, in batches of 5,000 inside `withWorkspace`.
  3. It calls `crm_purge_workspace_finish`, owned by a new `crm_purge` role and executable by the worker alone. That function removes what the worker can't: the audit rows (the append only trigger lets `crm_purge` alone through), the outbox, the milestones, the directory, the memberships and last workspace pointers, and finally the workspace row. It acts only on a workspace past `purge_after`.

  Counts per table go to the worker log, as ids and numbers only. An unfinished purge resumes in the next call.
- **Audit.** `workspace.updated` (name and time zone, before and after), `workspace.deleted`, `workspace.restored`, and `member.profile_updated`. The purge writes no audit row, because the audit goes with the workspace.
- **Not here.** Account (user) deletion belongs to the account lane. CSV export isn't on this base yet, so the dialog suggests it in words only.

### Critical test scenarios

- Switcher: two workspaces; switch on one device, sign in on another, `/` lands on the last one; leave it, `/` falls back, verifies **AC-801**, **AC-802**, **AC-812**.
- Invite happy path: an admin invites two emails; one signs up through the link with the allowlist closed and lands as member; the other is revoked and its link answers invalid, verifies **AC-803** to **AC-807**.
- Invite abuse: another signed in user opens the link and is refused; only the hash is stored; random tokens on peek answer identically and hit the IP limit; two tabs accept once, verifies **AC-804**, **AC-805**, **AC-806**, **AC-808**.
- Seats: with `SEAT_LIMIT` set to 2 in a test, the third non guest invite is refused, a guest invite isn't, verifies **AC-809**.
- Ownership: the only owner can't leave or demote themself; transfer makes the other owner and the caller admin in one audit event, verifies **AC-811**, **AC-813**.
- Removal: a member who hosts a booking page and has a connected calendar is removed with reassignment; the page is paused, the pool row gone, the connection revoked and its tokens revoked by the job, meetings flagged, records and open tasks reassigned with history; their next request is `NOT_FOUND`, verifies **AC-814** to **AC-817**.
- Link and domain: the link joins a verified user until `max_uses`; a gmail.com domain is refused; a domain request is approved and the person joins, verifies **AC-818** to **AC-820**.
- Delete: wrong slug refused; delete locks every member out; owner restores within the window; the purge job removes an expired one, verifies **AC-823**.
- Teams: the door's `teamIds` in one round trip (query count test); delete while a rule names it refused, verifies **AC-824** to **AC-827**.
- Guest: no emails in `members.list` or events; writes refused; empty state with no rules, verifies **AC-828**, **AC-829**.
- Audit: each action writes exactly one row; app role update and delete on `audit_events` fail, verifies **AC-830**.

## Build plan

Tracer Bullet, in the coordinator's slice order. Each slice ends with something you can click in production.

**Slice 1: switcher and last used**
1. Migration `auth.user_prefs`; `me.setLastWorkspace`; `/` and post sign in redirect use it, satisfies **AC-802**, **AC-831**
2. Workspace menu list, current mark, Create workspace, satisfies **AC-801**, **AC-833**

**Slice 2: invite and accept**
3. Migration: `invitations`, `auth.invitation_lookup`, `audit_events` with grants and guard tests; contracts, error codes, audit action catalog, satisfies **AC-804**, **AC-830**
4. Core: `inviteMembers`, `resendInvite`, `revokeInvite`, `peekInvite`, `acceptInvite`, `seatsUsed` and the `SEAT_LIMIT` check, audit rows; allowlist opening for invited emails; the invitation email; rate limits, satisfies **AC-803** to **AC-809**
5. Web: `/invite/:token`, the Invite dialog (from the current settings page until slice 3), satisfies **AC-805**, **AC-833**
6. Deploy; invite a second real address in production and accept; `security-access-reviewer`

**Slice 3: members page**
7. Migration: `members.avatar_url`, `time_zone`; `members.list` changed; `members.setRole` and `members.remove` (without effects yet), Leave workspace, settings navigation entries, satisfies **AC-810** to **AC-812**, **AC-832**

**Slice 4: transfer ownership**
8. `transferOwnership` with its audit event and the row menu action, satisfies **AC-813**

**Slice 5: removal effects**
9. Migration: `members.left_at`, `removed_by`, `booking_pages.paused_reason`, `meetings.organizer_removed`; the effects in the removal transaction; the token revoke job; the reassignment job; the dialog's effects list and picker, satisfies **AC-814** to **AC-817**

**Slice 6: invite link and domain join**
10. Migration: link columns, `workspace_domains`, `auth.workspace_domain_lookup`, `join_requests`; services and procedures; the two cards; `/join`; the Join requests tab and emails, satisfies **AC-818** to **AC-820**

**Slice 7: profile, workspace settings and delete**
11. `updateMyMemberProfile` and Account › Profile, satisfies **AC-821**
12. Migration: `workspaces.logo_url`, `time_zone`, `purge_after`; `updateWorkspace`, `deleteWorkspace`, `restoreWorkspace`, the purge job, Workspace › General, satisfies **AC-822**, **AC-823**

**Slice 8: teams**
13. Migration: `teams`, `team_members`; door `teamIds`; `access.mine`; team procedures with audit and `access` rows; Workspace › Teams, satisfies **AC-824** to **AC-827**

**Slice 9: guest**
14. Migration: `guest` in the role enum; contracts; guest rules in members, invitations and events; the empty state; the pinned table; `/check verify`, results in `verify.md`, satisfies **AC-828**, **AC-829**, all

## Consequences

**Positive**:
- Every way into a workspace is single use or admin controlled, and every change is audited from day one.
- Teams and guests exist before spec 0032 needs them, and the door already carries `teamIds`.
- Removing a person cleanly stops their bookings and calendar sync instead of leaving them half alive.

**Negative / tradeoffs**:
- Nine slices and about eight migrations; the biggest surface in Slice 6.
- A guest sees nothing until spec 0032 ships its rules screen.
- The door's query gains a team join, measured against AC-149's 5 ms.
- Pictures wait for #32; logos are initials until then.
- Domain join trusts the email provider's verification of the address; a company with shared inboxes should leave it off.
- Removal touches tables owned by specs 0024, 0025 and 0029; their owners must review slice 5.

**Neutral**:
- No new dependencies or environment variables.
- The door test's bootstrap list grows by five handlers, each named in AC-831.

## Follow-up

- [ ] #38: real `SEAT_LIMIT` per plan and the seat line in the Invite dialog.
- [ ] #32: logo and avatar upload.
- [ ] Slug change with redirects, if asked.
- [ ] Private views of a removed member (spec 0009's #20 follow up).
- [ ] `/sync`: `packages/db/AGENTS.md` names `audit_events` as append only; `apps/api/AGENTS.md` names the new bootstrap handlers.
