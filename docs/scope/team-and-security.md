# Team and security

Who is in a workspace, what each person may see and do, how accounts are protected, and the record of who changed what. See [index.md](index.md) for the house rules and the full order.

## Slice 6: Team and access

### 23. Workspaces, members and teams
Bring the team in, group people into teams, and let one person work across several workspaces.
**Done when:** an admin invites by email and only a verified matching address can accept; the four roles can be assigned and changed; admins create teams (groups of members) that access rules and reports can use; members can be removed but the last owner cannot; one person belongs to many workspaces and switches between them; workspace name and settings are editable.
- [ ] Build it: `/develop workspaces, members and teams`

### 24. Access rules · GA
The fine grained half of the access model: who can see or edit each object, which fields are hidden or read only per role, and which records each person can see.
**Done when:** an admin restricts an object, hides or locks a field, and limits a role to records they or their team own; each restriction holds in tables, boards, record pages, live events, search, notifications, export and the API; a hidden field or record is simply absent, never shown as locked.
- [ ] Build it: `/develop access rules`

### 25. Account security · needs a decision · GA
Protect each account, and let owners enforce it for everyone.
**Done when:** a member turns on two factor sign in, sees their active sessions and signs out of any or all of them; an owner can require two factor for the whole workspace; a sign in from a new device is emailed to the account.
- [ ] Design it (spec): `/architect account security`

## Slice 10: Trust and launch

### 36. Audit log and privacy tools · needs a decision · GA
A full record of who changed what, and the tools to answer a person's request for their data.
**Done when:** admins filter every change (records, members, teams, roles, access rules, keys, imports, support access) by person, object and date; all data about one person can be exported, or deleted everywhere including notes and files; privacy and terms pages are reachable from signup.
- [ ] Design it (spec): `/architect audit log and privacy tools`
