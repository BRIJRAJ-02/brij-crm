# Team and security

Who is in a workspace, what each person may see and do, how accounts are protected, and the record of who changed what. See [index.md](index.md) for the house rules and the full order.

## Slice 6: Team and access

### 63. Sign in and first run · done
The way in: sign in by email code or Google, then a short first run that creates the workspace with a live preview and invites the team.
**Done when:** a new person signs in with a code or Google, names the workspace and its address on a stepped card with a live preview, invites teammates with one plus to add form, and lands on Home; every state (wrong code, expired link, taken address) has a clear message.
- [x] Design it (spec): `/architect sign in and first run`
- [x] Build it: `/develop sign in and first run` (the About you questions were removed on purpose)
   - [x] The entry, the code and Google
   - [x] First run
   - [x] Polish and every state
- [x] Test it: `/test sign in and first run`
Spec [0036](../specs/0036-sign-in-and-first-run.md) · code in `apps/web/src/features/auth/`, `apps/web/src/features/welcome/`

### 23. Workspaces, members and teams · in-progress
Bring the team in, group people into teams, and let one person work across several workspaces.
**Done when:** an admin invites by email and only a verified matching address can accept; the four roles can be assigned and changed; admins create teams (groups of members) that access rules and reports can use; members can be removed but the last owner cannot; one person belongs to many workspaces and switches between them; workspace name and settings are editable.
- [x] Design it (spec): `/architect workspaces, members and teams`
- [ ] Build it: `/develop workspaces, members and teams`
   - [x] The switcher, invite and accept, the members page, transfer ownership and removal effects
   - [x] Invite link and domain join
   - [x] Profile, workspace settings and delete
   - [ ] Teams
   - [ ] The guest role (with #24)
- [x] Test it: `/test workspaces, members and teams`
Spec [0031](../specs/0031-workspaces-members-teams/index.md) · code in `apps/api/src/modules/members/`, `apps/api/src/modules/invitations/`, `apps/web/src/features/invite/`

### 24. Access rules · planned · GA
The fine grained half of the access model: who can see or edit each object, which fields are hidden or read only per role, and which records each person can see.
**Done when:** an admin restricts an object, hides or locks a field, and limits a role to records they or their team own; each restriction holds in tables, boards, record pages, live events, search, notifications, export and the API; a hidden field or record is simply absent, never shown as locked.
- [x] Design it (spec): `/architect access rules`
- [ ] Build it: `/develop access rules` (waits on #7's per audience channels and #9's last milestone, which ship together)
   - [ ] One stored rule, end to end (object level only)
   - [ ] Fields
   - [ ] Records
   - [ ] The roles page, preview and guests
Spec [0032](../specs/0032-access-rules/index.md)

### 25. Account security · done · GA
Protect each account, and let owners enforce it for everyone.
**Done when:** a member turns on two factor sign in, sees their active sessions and signs out of any or all of them; an owner can require two factor for the whole workspace; a sign in from a new device is emailed to the account.
- [x] Design it (spec): `/architect account security`
- [x] Build it: `/develop account security`
   - [x] Sessions you can see and end
   - [x] Authenticator app and backup codes
   - [x] Passkeys: built, then taken out on purpose (they now return 404)
   - [x] The workspace requirement and new device alerts
   - [x] Deleting your own account
- [x] Verify it: `/check verify account security`
- [x] Test it: `/test account security`
Spec [0033](../specs/0033-account-security/index.md) · code in `apps/web/src/features/settings/`, `apps/api/src/modules/security/`

## Slice 10: Trust and launch

### 36. Audit log and privacy tools · in-progress · GA
A full record of who changed what, and the tools to answer a person's request for their data.
**Done when:** admins filter every change (records, members, teams, roles, access rules, keys, imports, support access) by person, object and date; all data about one person can be exported, or deleted everywhere including notes and files; privacy and terms pages are reachable from signup.
- [x] Design it (spec): the history half is spec 0046; the privacy half (one person's data out or erased) still needs `/architect audit log and privacy tools`
- [ ] Build it: `/develop history`
   - [x] The log, end to end (Settings › History: changes and sign ins)
   - [ ] Details and filters
   - [ ] One person's data exported or erased everywhere, and privacy and terms links from sign up
- [x] Verify it: `/check verify history` (milestone 1)
Spec [0046](../specs/0046-history/index.md) · code in `apps/api/src/modules/audit/`, `apps/web/src/routes/w.$slug.settings.history.*`
