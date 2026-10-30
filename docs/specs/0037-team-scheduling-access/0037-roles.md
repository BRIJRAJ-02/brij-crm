# 0037 · Roles: custom roles built from the permission catalog

**Part of**: [index.md](index.md) (owner decisions 1 to 5, 12 and 31). **ACs**: AC-1226 to AC-1248. **Status**: decisions accepted 21 October 2026; **amended 31 October 2026**: the catalog is built (J1) with five owner only permissions and the four `schedule.*` kept from API keys; custom roles are lane L4, after the guest role (lane P2, spec 0031 slice 9), so Guest is on the Roles screen from its first day.
**Extends**: spec 0009 (the catalog, flat roles, the door), spec 0031 (Members page, invitations, guests, audit), spec 0032 (rule subjects, the Roles page).

## Summary

Admins can make roles of their own. A custom role is a name, a description and a set of permissions picked from the catalog, and it is always based on Member: its holders take a seat and start from Member's data access, or read only data access for a Viewer style role. Owner, Admin, Member and Guest stay as built in roles whose permissions are pinned in code and can't be edited. The catalog gives every permission a plain label, a one line description, a group and a grant level, so the role editor can explain each one and refuse the ones only built in roles may hold. Every member still holds exactly one role, read by the door in the same statement as the member row.

## User stories

- As an owner, I want a "Receptionist" who manages every doctor's hours and bookings but can't change the CRM's objects or invite people.
- As an owner, I want a "Sales lead" who sees and manages their team's calendars and runs the team's booking pages.
- As an owner, I want a "Doctor" role whose hours are set by the practice manager.
- As an admin, I want to see at a glance what each role can do, side by side.
- As an admin, I want new people to join with the role most of my team has.
- As an owner, I want a read only "Viewer" for a manager who only looks, as timefix had.

## The catalog

`packages/contracts/src/access.ts`, `PERMISSIONS`: each entry gains `label`, `description`, `group` and `grant`, beside its refusal `message`. **Grant levels**: `owner` (only the Owner role), `admin` (Owner and Admin only), `any` (built in roles as the table says, and any custom role may hold it). The pinned role table test (spec 0009, AC-133) covers the new fields.

| Permission | Label | Description | Group | Grant | Owner | Admin | Member |
|---|---|---|---|---|---|---|---|
| `workspace.manage` | Change workspace settings | Rename the workspace and change its time zone, email domains and calendar settings. | Workspace | admin | yes | yes | |
| `workspace.delete` | Delete the workspace | Delete the workspace and everything in it. | Owner only | owner | yes | | |
| `workspace.export` | Export the whole workspace | Download a full copy of the workspace. | Owner only | owner | yes | | |
| `billing.manage` | Manage billing | Change the plan and payment details. | Owner only | owner | yes | | |
| `support.grant` | Let support in | Give support staff access to the workspace. | Owner only | owner | yes | | |
| `security.manage` (spec 0033) | Change how people sign in | Require two factor sign in, set how long sessions last and sign everyone out. | Owner only | owner | yes | | |
| `audit.read` | Read the audit log | See who changed what across the workspace. | Workspace | admin | yes | yes | |
| `jobs.manage` | Manage everyone's background jobs | See, stop and confirm background jobs anyone started. | Workspace | admin | yes | yes | |
| `members.invite` | Invite people | Invite people into any role but Owner (owners invite owners too). | People | admin | yes | yes | |
| `members.manage` | Change roles and remove people | Change anyone's role and remove people, within the owner rules. | People | admin | yes | yes | |
| `teams.manage` | Manage teams | Create teams and change who is in them. | People | admin | yes | yes | |
| `access.manage` | Manage roles and access | Make and change roles, and set who sees which objects, fields and records. | People | admin | yes | yes | |
| `schema.manage` | Change objects and attributes | Add and change objects, attributes, options and relationships. | Data | any | yes | yes | |
| `views.manage` | Manage shared views | Lock shared views and change locked ones. | Data | any | yes | yes | |
| `records.export` | Export records | Export the records and fields you can see. | Data | any | yes | yes | yes |
| `records.purge` | Delete records forever | Empty the trash and delete records for good. | Data | any | yes | yes | |
| `forms.manage` | Build forms | Build, publish and pause forms, and handle their submissions. | Data | any | yes | yes | |
| `automations.manage` | Build automations | Build and run automations. | Data | any | yes | yes | |
| `comments.manage` (spec 0038) | Delete anyone's comments | Delete comments other people wrote. | Data | any | yes | yes | |
| `booking.manage` | Take bookings | Make your own booking pages, take bookings and block your own time. | Scheduling | any | yes | yes | yes |
| `booking.admin` | Manage every booking page | Change any booking page, team pages and rotations. | Scheduling | any | yes | yes | |
| `availability.own` | Change your own hours | Change your own schedules and date overrides. | Scheduling | any | yes | yes | yes |
| `schedule.view` | See everyone's scheduling | See every member's calendar column, hours, time off and bookings. | Scheduling | any | yes | yes | |
| `schedule.view.team` | See their teams' scheduling | The same, for people who share a team with them. | Scheduling | any | yes | yes | |
| `schedule.manage` | Manage everyone's scheduling | Change anyone's hours, time off and limits, and book, move or reassign their meetings. | Scheduling | any | yes | yes | |
| `schedule.manage.team` | Manage their teams' scheduling | The same, for people who share a team with them. | Scheduling | any | yes | yes | |
| `routing.manage` | Set up routing | Change the routing setup, skills and learning, and see every routing decision. | Scheduling | admin | yes | yes | |
| `api_keys.manage` | Manage API keys | Create and revoke API keys. | Integrations | admin | yes | yes | |
| `webhooks.manage` | Manage webhooks | Subscribe and manage webhooks. | Integrations | admin | yes | yes | |

Guest holds nothing (spec 0031, AC-828). Four permissions are `admin` grant for security, after the review of 21 October 2026: `members.invite` (an invite can bring in a wider role or a second account with wider data access), `jobs.manage` (it confirms admins' prepared purges and exports), `audit.read` (audit rows hold time off reasons and every rule change) and `routing.manage` (its Test and Decisions show what the CRM knows about any email, whatever the viewer's own access rules). New refusal messages: `availability.own` "Your hours are set by the people who manage your scheduling."; `schedule.view` "Your role can't see other people's scheduling."; `schedule.view.team` "Your role can't see your teams' scheduling."; `schedule.manage` "Your role can't change other people's scheduling."; `schedule.manage.team` "Your role can't change your teams' scheduling."; `routing.manage` "Only people who set up routing can change it."

## Acceptance criteria

*The catalog*
- **AC-1226**: Every permission in `PERMISSIONS` carries a label, a one line description, a group (Workspace, People, Data, Scheduling, Integrations, Owner only) and a grant level (`owner`, `admin`, `any`) exactly as the table above; the pinned role table test covers them, and a test fails when a permission has no grant level.
- **AC-1227**: The catalog gains `availability.own`, `schedule.view`, `schedule.view.team`, `schedule.manage`, `schedule.manage.team` and `routing.manage`. Owner holds every permission, Admin every one but the five owner only ones (`workspace.delete`, `workspace.export`, `billing.manage`, `support.grant` and, since spec 0033, `security.manage`: every permission of grant `owner`, so a later one needs no change here), Member `records.export`, `booking.manage` and `availability.own`, Guest none. `members.invite`, `jobs.manage`, `audit.read` and `routing.manage` are grant `admin`, so no custom role holds them. `access.manage` also covers custom role definitions.

*Making roles*
- **AC-1228**: A holder of `access.manage` creates a custom role from Settings › Workspace › Roles: a name (1 to 40 characters, unique in the workspace ignoring case, never Owner, Admin, Member or Guest: 422 `ROLE_NAME_RESERVED`), an optional description (up to 200 characters), "Start from" (Member by default, or a custom role) and its permissions, only among grant `any` permissions (any other answers 422 `PERMISSION_NOT_ALLOWED`, naming its label). At most 20 custom roles per workspace (409 `ROLE_LIMIT`), counted under a workspace advisory lock.
- **AC-1229**: A custom role is based on Member: its holders take a seat (spec 0031, AC-809) and no rule ever treats them as owners or admins (the owner rules, the rule exemption of spec 0032 decision 2, the last owner guard). Each custom role has a Data access choice, `default_object_level`: Read and write (`write`, the default) or Read only (`read`). The policy uses it as the role view's default object level, before and after spec 0032 exists, so a Read only role can't create, edit or delete any record, and every field shows the library's read only state with "Your role can view records but not change them.". New role's Start from offers a "Viewer" preset: Read only and no permissions (timefix's Viewer role).
- **AC-1230**: Access rules (spec 0032) may target a custom role: the Access tab lists custom roles as subjects after Member and Guest, "Applies to N people" counts their holders, and Preview as works for any holder. Creating a role copies, in the same transaction, the object, field and record rules of its "Start from" role (`workspace_roles.started_from`: `member`, a custom role id, or `viewer`) to the new role as its own rules; afterwards the two roles' rules are independent. The copy ships with its backfill: J10 lands in the same release as spec 0032's milestone 1, and its migration copies, for every custom role made before, the rules its Start from role has at that moment (none yet in a workspace that never had rules), so no custom role ever misses a Member rule that existed when rules began. A Start from role deleted since falls back to Member.
- **AC-1231**: Saving a role's name, description or permissions is one transaction with one audit row (`role.updated`, with the permissions added and removed) and one `access` outbox row naming every active holder, so their screens reload within spec 0009's AC-146 timing. The save asks first, saying who is affected: "This changes what 7 people can do."
- **AC-1232**: Duplicate makes "<name> copy" (with " 2", " 3" on clashes) with the same permissions and a copy of the rules; it counts toward the 20.

*Holding a role*
- **AC-1233**: Each member holds exactly one role: Owner, Admin, Member, Guest, or one custom role, stored as `members.custom_role_id` with `members.role = 'member'` (a check constraint). `members.setRole` takes `{ memberId, role }` or `{ memberId, customRoleId }`; setting a built in role clears `custom_role_id` in the same update; spec 0009's owner rules are unchanged; holders of `members.manage` may grant any custom role; moving a guest into a custom role checks `SEAT_LIMIT`.
- **AC-1234**: The door reads the member's custom role (its permissions and name) in the same statement as the member row (a left join, no extra round trip). The member's permissions are the role's stored list kept to catalog names with grant `any`; any other stored name grants nothing and is logged once per role id per process. Spec 0009's AC-149 budget holds, measured with 20 custom roles.
- **AC-1235**: `access.mine` answers `role`, `roleLabel` (the custom role's name for a custom role), `customRoleId` when there is one, and the permissions; the workspace menu shows the role's name.
- **AC-1236**: Invitations (spec 0031) may name a custom role (`invitations.custom_role_id`, with `role = 'member'`). Only holders of `members.invite` invite, and that is only owners and admins (grant `admin`): admins into Admin, Member, Guest or any custom role, owners into Owner as well. Accepting an invitation (spec 0031, AC-806) rechecks, inside the accept transaction, that the sender is still an active member holding `members.invite` (their current built in role; a sender moved into a custom role no longer qualifies) and that a named custom role still exists; otherwise it answers `INVITE_INVALID`.
- **AC-1237**: One role may be "Default for new people": the Invite dialog preselects it, the invite link offers it, and approving a join request suggests it. At most one (a partial unique index); none means Member; the default can be a custom role or Member only.
- **AC-1238**: Deleting a custom role asks which role its holders move to (Member by default, or another custom role). In one transaction: the holders and open invitations move, the role's rules are deleted, the default falls back to Member if it was this role, one audit row (`role.deleted`, with the count moved) and `access` rows naming the moved members.

*Screens*
- **AC-1239**: Settings › Workspace › Roles (spec 0032's AC-857 page, now editable; not built yet, so L4 makes it) lists Owner, Admin, Member and Guest (Guest from P2, which lands first), each with a "Built in" badge, then custom roles in their order, each with its description, its number of people and a "Default for new people" badge where it applies; New role sits in the header; a List or Compare switch shows, on Compare, every permission (rows, grouped, with labels) against every role (columns), read only.
- **AC-1240**: A role's page has Permissions and People tabs. Permissions starts with Data access (a SegmentedControl: Read and write, Read only), then shows each group as a section of checkbox rows (label and description); permissions a custom role can't hold show as disabled rows with "Only built in roles can do this"; built in roles show everything read only with "Built in roles can't be changed. Make a custom role instead." Scheduling reach shows as two Selects instead of four checkboxes: "See other people's scheduling" and "Manage other people's scheduling", each Only their own, Their teams, or Everyone. One Save for the page, disabled until something changes; leaving with changes asks first. People lists the role's holders with Change role per row. A menu holds Duplicate, Make default for new people and Delete.
- **AC-1241**: The two scheduling Selects write the catalog: Their teams writes `schedule.view.team` or `schedule.manage.team`, Everyone writes `schedule.view` or `schedule.manage`. Choosing a Manage wider than See widens See to match, and narrowing See narrows Manage to match, so a stored role never manages people it can't see.
- **AC-1242**: Settings › Workspace › Members' role Select lists Owner, Admin, Member and Guest, then custom roles under a "Custom" label, offering only the roles the actor may grant; choosing several members offers "Change role" for all at once (one transaction and one audit row per member).
- **AC-1243**: A member's row menu offers "What can Priya do", a panel listing their role, every permission it holds by label and group, their scheduling reach (from [0037-scheduling-access.md](0037-scheduling-access.md): whom they may see and manage, and why) and who may manage their scheduling. Visible to the member themself and to holders of `members.manage`.

*Safety and quality*
- **AC-1244**: Fail closed: a `members.custom_role_id` whose role can't be read refuses the door as an unknown role (`NOT_FOUND`, logged with the member id only, spec 0009 AC-134); a catalog entry without a grant level is treated as `owner`.
- **AC-1245** (amended 31 October 2026, as built): API keys hold scopes, never roles (spec 0009, AC-148). The four `schedule.*` permissions are in `KEY_FORBIDDEN_PERMISSIONS` (`packages/contracts/src/access.ts`), so a key never reaches anyone's time: reach over owners and admins comes only from their built in roles or their own grants (decision 7), and a key has no person behind it. `availability.own` and `routing.manage` stay key scopes.
- **AC-1246**: Every screen here is keyboard usable, labelled per row ("Delete records forever, for Support"), meets WCAG AA in both themes, and uses the library only (DataTable, Checkbox, Select, SegmentedControl, the SaveBar, Modal, Badge); `design-system-guardian` and `ux-interaction-reviewer` review it.
- **AC-1247**: `audiences` (spec 0009) reads custom role permissions in its one query, so a `jobs` event reaches a custom role holder with `jobs.manage` exactly as it reaches an admin (a test with two audiences).
- **AC-1248**: The policy's unit grid covers: a custom role with each grant level permission stored (only `any` ones grant), a role with an unknown name stored, a custom role holder under Member rules (they don't apply) and under their own role's rules (they do), and a custom role holder in a team with a grant (most open wins, spec 0032).

## Design

### Data model

**`workspace_roles`** (tenant table; forced row level security with the standard policy; audit columns)
- `workspace_id`, `id` (uuidv7), `name` (text), `description` (text, default empty), `permissions` (text[], default empty; each name checked in core against the catalog and its grant level; text, so an unknown name fails closed at read), `is_default` (boolean, default false), `position` (smallint), `default_object_level` (text, `write` or `read`, default `write`; any other value reads as `read`, failing toward less access), `started_from` (text: `member`, `viewer` or a custom role id, kept for J10's backfill).
- Primary key (`workspace_id`, `id`). Unique (`workspace_id`, `lower(name)`). Partial unique (`workspace_id`) where `is_default`. Checks: `char_length(name) between 1 and 40`; `lower(name) not in ('owner', 'admin', 'member', 'guest')`; `char_length(description) <= 200`; `cardinality(permissions) <= 64`; `position between 0 and 19`.

**`members.custom_role_id`** (uuid, nullable): foreign key (`workspace_id`, `custom_role_id`) to `workspace_roles` with `on delete restrict` (core moves holders first, AC-1238); check `custom_role_id is null or role = 'member'`; index (`workspace_id`, `custom_role_id`) where not null, for holder counts and the move.

**`invitations.custom_role_id`** (uuid, nullable): the same foreign key and check, against spec 0031's `invitations.role`.

**`access_rules.subject_custom_role_id`** and **`record_rules.subject_custom_role_id`** (spec 0032's tables, nullable, foreign key with `on delete cascade`): `subject_type` gains `custom_role`, and the "exactly one subject column" check covers three columns.

### Policy and the door

- `Principal` (member kind) gains `customRoleId?: string`. `roleAccess(principal, rules, customRole?)`: with a custom role, permissions are `customRolePermissions(stored)`, the stored names kept to catalog names whose grant is `any`, and the data policy's `defaultObject` is the role's `default_object_level`; without one, `ROLE_PERMISSIONS[role]` as today.
- Rule subjects (spec 0032's `subjectMatches`): `role` subjects match only members without a custom role; `custom_role` subjects match holders of that role; team subjects as before. The custom role view's default object level is Member's (`write`). Owners and admins stay exempt.
- The door's `activeMember` query selects `members.custom_role_id` and left joins `workspace_roles` for `permissions` and `name` in the same statement; `RuleSource` receives `{ memberId, role, customRoleId? }`.
- `enterAsActor` and `audiences` use the same read, so jobs and live events see the custom role (AC-1247).

### Services and procedures

| Service → procedure | Key inputs | Key outputs | Access | Key errors |
|---|---|---|---|---|
| `listRoles` → `roles.list` (built by the members lane, slice 3, AC-1439) | none | `{ roles: [{ id, label, description, builtIn? }], defaultRole }`: the picker list, its shape unchanged; J9 adds custom roles to it (id the role's uuid, no `builtIn`) | any member | 404 |
| `roleOverview` → `roles.overview` (new, J9) | none | every role with its permissions, data access, holders count, position and default flag, for the Roles page and Compare | any member; guests get names only | 404 |
| `getRole` → `roles.get` | `id` | the role; holders (cursor) with `access.manage` | any member for the definition | 404 |
| `createRole` → `roles.create` | `name`, `description?`, `permissions[]`, `dataAccess: 'write' \| 'read'`, `startFrom: 'member' \| 'viewer' \| customRoleId`, `mutationId` | role | `access.manage` | 403, 409 `ROLE_LIMIT`, 409 `NAME_TAKEN`, 422 `ROLE_NAME_RESERVED`, 422 `PERMISSION_NOT_ALLOWED` |
| `updateRole` → `roles.update` | `id`, `name?`, `description?`, `permissions?`, `dataAccess?`, `updatedAt` | role, `affectedMembers` | `access.manage` | 403, 404, 409 `STALE`, 409 `NAME_TAKEN`, 422 as above |
| `duplicateRole` → `roles.duplicate` | `id` | role | `access.manage` | 409 `ROLE_LIMIT` |
| `deleteRole` → `roles.delete` | `id`, `moveTo: 'member' \| customRoleId` | `{ moved }` | `access.manage` | 403, 404, 422 `MOVE_TO_INVALID` |
| `setDefaultRole` → `roles.setDefault` | `id \| null` | none | `access.manage` | 404 |
| `moveRole` → `roles.move` | `id`, `position` | none | `access.manage` | 404 |
| `setMemberRole` → `members.setRole` (changed) | `memberId`, `role` or `customRoleId` | member | spec 0009 owner rules plus `members.manage` | 403, 404, 409 `LAST_OWNER`, 409 `SEAT_LIMIT` |
| `inviteMembers` → `invitations.create` (changed) | adds `customRoleId?` | as spec 0031 | `members.invite` with AC-1236 | 403 |

Errors are `{ code, message }` with plain messages: `PERMISSION_NOT_ALLOWED` "Custom roles can't hold Manage webhooks. Only built in roles can."; `ROLE_LIMIT` "A workspace can have at most 20 custom roles."; `ROLE_NAME_RESERVED` "Owner, Admin, Member and Guest are built in roles. Pick another name."; `MOVE_TO_INVALID` "Pick Member or another custom role." Audit actions added to `AUDIT_ACTIONS`: `role.created`, `role.updated`, `role.deleted`, `role.default_changed`, and spec 0031's role change action gains the custom role in its before and after.

### Screens

- **Settings › Workspace › Roles** (`/w/$slug/settings/roles`): the TopBar's title and one line description ("What each role can do. Built in roles can't be changed."), New role, and a SegmentedControl List | Compare. List is a DataTable (name with Badge, description, people, default). Compare is a read only DataTable with grouped rows.
- **Role page** (`/w/$slug/settings/roles/$roleId`): back, the name (renamed in place for custom roles), the menu, then tabs Permissions | People. Permissions are SettingsStack sections of Checkbox rows; Scheduling has the two Selects then `booking.manage`, `booking.admin`, `availability.own` and `routing.manage` as rows; the SaveBar at the foot; the save confirm Modal. People is a DataTable with Change role.
- **New role** Modal: Name, Description, Start from (Select), Create; then the role page opens.
- **Delete role** Modal: "Move its 7 people to" (Select), Delete (danger).
- **Members page**: the role Select grouped Built in and Custom; a multi select with Change role in the selection bar.
- References (Mobbin): PandaDoc's built in roles beside "Create a new role", Shopify's grouped permission checklist with counts per group, StackAI's and Vanta's roles against permissions matrix, Workable's "saving updates every member with this role" confirm. All drawn from the library; no new component is expected (if the Compare matrix needs one, `design-system-guardian` decides between a DataTable variant and a new module).

### Value sourcing

| Action | Value | Source |
|---|---|---|
| Door | a custom role holder's permissions | `workspace_roles.permissions` kept to catalog names with grant `any` |
| Door | role label | `workspace_roles.name`, else `ROLE_LABELS` |
| Role editor | each row's label, description, group, whether it can be held | `PERMISSIONS[name].label`, `.description`, `.group`, `.grant` |
| Role editor | the scheduling Selects' values | which of `schedule.view.team`, `schedule.view`, `schedule.manage.team`, `schedule.manage` the role holds (AC-1241) |
| New role | the rules it starts with | spec 0032 rules of the Start from subject, copied |
| Save confirm | "changes what 7 people can do" | count of active members with `custom_role_id` = id |
| Invite dialog | preselected role | the role with `is_default`, else Member |
| Invite dialog | roles offered | `roles.list` (AC-1439): built in roles the inviter may grant and every custom role; only owners and admins invite (AC-1236) |
| Delete | where holders go | `moveTo` |
| Seat count | custom role holders | counted as non guest (spec 0031 AC-809) |

### Key invariants

- A member holds exactly one role; a custom role holder's base role is `member`.
- A custom role never invites, reads the audit log, manages others' jobs or sets up routing.
- A custom role never grants an `owner` or `admin` grant permission, whatever is stored.
- Built in roles' permissions come only from the pinned code table.
- A role change reaches every holder's open screens through an `access` row.
- Only owners and admins invite, and an invitation is rechecked against its sender when it is accepted.

### Security model

`access.manage` for every role definition write; `members.manage` and the owner rules for who holds what; invitations only from owners and admins, rechecked at accept; custom roles capped at grant `any`; reads of role definitions are harmless (any member) but holder lists need `access.manage`. `security-access-reviewer` on J9 and J10.

### Numbers

| Value | Number | Runner up |
|---|---|---|
| Custom roles per workspace | 20 | 50 |
| Role name length | 1 to 40 characters | 1 to 60 |
| Description length | up to 200 characters | 500 |
| Stored permission names per role | up to 64 | none |

### Critical test scenarios

- Make "Receptionist" with `schedule.manage` and `booking.manage`, give it to a member: they manage every column and can't open Settings › Objects; refused `schema.manage` writes answer 403 (AC-1228, AC-1233, AC-1234).
- Store `members.manage` into a role row by hand: the holder doesn't get it (AC-1234, AC-1248).
- Storing `members.invite` in a custom role grants nothing; an admin invites someone into a custom role, is moved into a custom role before the invitee accepts, and the accept answers `INVITE_INVALID` (AC-1236).
- A Viewer preset role can read People and is refused every record write (AC-1229).
- Delete a role with 3 holders and an open invitation, moving to Member: all moved, rules gone, audit row, holders' sessions reload (AC-1238).
- Spec 0032 rules: Member has Deals at none; a new role started from Member has Deals at none; changing Member afterwards doesn't change the new role (AC-1230).
- Door cost with 20 roles: one statement, within AC-149 (AC-1234).
