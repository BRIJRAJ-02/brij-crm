# 0031. Workspaces, members and teams: rationale

## Context

Today a workspace has exactly the people a local script put there. Spec 0009 gave members roles and the services to change them, but no procedure, no screen, no way to invite, and no teams; the door's `teamIds` is always empty. Slice 6 needs all of that before access rules (spec 0032) mean anything, since rules target roles and teams.

Sign in is password less (an email code, or Google) through Better Auth, with an allowlist that keeps previews and production closed to strangers. Members live in the tenant `members` table under forced row level security; `auth.workspace_membership` is a global mirror used only to list a person's workspaces. An invitation has to cross that boundary: the person accepting has no workspace scope yet.

Two forces shape the rest. Security: an invitation is a bearer credential to a workspace, so it must be single use, unguessable, tied to one verified address, and never readable in the database. Durability: the scope says every membership, role and team change is audited, but #36 (the audit log screens) is four slices away, and the outbox that records changes today is pruned after 24 hours.

Coordinator research (20 October) is folded in: today there are no invitations at all, `members.list` is the only exposed members procedure though `setMemberRole` and `removeMember` exist in core, the last owner trigger exists (migration 0022), and multi workspace membership exists without a switcher.

## Options considered

### Option 1: own tables, beside the existing members (recommended)

Invitations and teams as tenant tables next to `members`; a global `auth.invitation_lookup` keyed by token hash so acceptance finds its workspace; acceptance mints a bootstrap scope inside `packages/core` like workspace creation does.

**Pros**: one source of truth for membership (the table the door already reads); row level security on everything tenant; fits spec 0009's services and owner trigger unchanged.
**Cons**: we write invitation and team code ourselves.

### Option 2: Better Auth's organization plugin

Better Auth 1.7.7 ships `organization` with members, invitations, teams and roles.

**Pros**: invitations, teams and role checks come ready made.
**Cons**: it keeps its own `member` and `team` tables in the global identity database with no row level security, duplicating `members`; its roles and access control would compete with spec 0009's door; and the API would grow routes we have deliberately closed (`AUTH_ROUTES`). Two sources of truth for who is in a workspace is the exact drift the door exists to prevent.

### Option 3: invite by adding the member row directly (no invitation entity)

Create a `members` row with status `invited` and the email; the person becomes active on first sign in with that email.

**Pros**: fewest tables.
**Cons**: an unaccepted person would already count as a member to every query of `members`, can't be expired or resent cleanly, and the "verified address accepts" step becomes implicit; the unique email index on active members also fights it.

## Rationale

Option 1 keeps the door's single source of membership, which is the property spec 0009 spent most of its effort on; Option 2 would bring a second model of roles into the global database. Option 3 is cheaper but makes "pending" a member state that every member query must remember to exclude.

The other choices follow from the forces: hashed single use tokens and a uniform invalid answer for security; an append only `audit_events` table now, because the outbox is pruned and #36 would otherwise launch with no history; flat teams because spec 0009's `team` record rule only needs membership, and nesting would make "my team's records" ambiguous. Several owners plus a one step transfer, because spec 0009 already supports several and the last owner trigger keeps the workspace safe. Guests start with no data and can only ever be granted read, so the safe default holds before spec 0032's screens. Invite links and domain join are built but off by default, because each is a standing way in that an admin should choose. Removal effects are automatic because a removed person's booking page that still takes bookings, or a calendar still syncing their mail, is a real leak; reassignment is offered, not forced, so removal stays quick. The last workspace lives on the server so it follows the person across devices, and seats count open invitations so an invite can't overshoot a plan.

**Owner decision runners up, in short**: no guest role (simpler, but clients and contractors get member access or nothing); email invitations only (fewer doors, slower onboarding for big teams); every invite route opens sign up (convenient, but a leaked link becomes an open sign up); a single owner with transfer only (clear, but no safety gain over the trigger); team leads (useful later, adds a role inside a role); no reassignment (removal is simpler, cleanup moves to bulk edit); slug change (nice, breaks links); audit later from the outbox (history lost); delete left to #36 and #37 (less now, but an owner has no way out); browser storage for the last workspace (no table, but every new device opens the oldest); seats counting only members (simpler, overshoots); image upload in Postgres (works now, thrown away when R2 arrives).

## References

**Project sources**:
- Spec 0009 (access model): roles, owner rules, the door, `teamIds`, `access` rows.
- Spec 0026 (settings area): where the pages live.
- `packages/db/src/schema/auth.ts`, `workspaces.ts`; `apps/api/src/auth/auth.ts`, `allowlist.ts`.
- House skill `crm-data-model-access` ("membership, role, team, rule and key changes are all written to the audit log").

**Practices and standards**:
- OWASP: bearer tokens stored hashed, uniform errors to prevent enumeration, rate limits on unauthenticated endpoints.
- Attio's model: workspace members with roles, teams that permissions target.

**Links** (screens seen through Mobbin while writing this):
- Attio settings navigation and General page: https://mobbin.com/screens/fdf5ad8e-8d4f-4062-ac84-95f05ffecb2d
- Attio workspace delete confirm: https://mobbin.com/screens/ea34fb11-bf9a-4da7-8f2f-f68047f4c56b
- Vercel members with invite form, tabs and pending invitation state: https://mobbin.com/screens/053a9399-ee8c-4cda-962d-9b0e8c679897
- Obvious invite with role descriptions (Guest, Member, Admin, Owner): https://mobbin.com/screens/7e43776a-22eb-433a-b8a8-66c09235280a
- Linear Security page (invite links, allowed domains, auth methods): https://mobbin.com/screens/ad90d0fb-7dbf-4978-8364-13468223ec00
- Midday members and pending invitations tabs: https://mobbin.com/screens/2a0175dc-f318-461f-85bb-c6e46fd71cbb
- Attio invite step (emails with a role each): https://mobbin.com/screens/f2732d27-ad67-44ea-9b36-5ebf6bcc4a68
- Attio typed confirmation pattern: https://mobbin.com/screens/e5c58f38-7f1c-43b2-8236-f0b5d8f781a8
