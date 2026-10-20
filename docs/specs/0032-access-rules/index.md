# 0032. Access rules

**Date**: 2026-10-20
**Status**: Proposed
**Scope**: #24, Slice 6 ([Team and security](../../scope/team-and-security.md))
**Numbering**: handed out by the coordinator (0031 to 0033 for Slice 6); this spec owns AC-841 to AC-880.

## Owner decisions needed

1. **When a person's role and teams disagree, who wins?** Recommended: the most open wins. A person sees the union of what their role sees and what each of their teams sees, so you restrict at the role ("Members: no access to Deals") and grant to a team ("Sales: can edit Deals"), as Attio does with a default plus grants. Runner up: the strictest wins (what spec 0009's `memberPolicy` does today), which makes "everyone but Sales" impossible to say.
2. **Do rules apply to owners and admins?** Recommended: no. Owners and admins always see and edit everything, so nobody can lock the people who manage access out of the data. Runner up: rules apply to admins too, with owners exempt.
3. **Who can a rule target?** Recommended: a role (Member or Guest) or a team; never one named person (make a team of one). Runner up: rules per person as well, as HubSpot does.
4. **Records with nobody in the rule's field** (an import with no Owner) under an "own records" rule. Recommended: not visible to people under that rule; the Access tab says so in plain words, and a record created by someone under the rule gets them as its owner when the field is empty. Runner up: unowned records are visible to everyone.
5. **Records outside a record rule.** Recommended: absent (hidden means absent), never read only. Runner up: visible read only, which needs a per record level and a second predicate.
6. **Where the controls live.** Recommended: an Access tab on each object's settings page (beside Attributes and Configuration) for object, field and record rules, plus Workspace › Roles showing what each role may do. Runner up: one central matrix page for every object and role.
7. **Lists.** Recommended: a list follows its object in this slice (no list level rules). Runner up: per list access now, as Attio offers.

## Summary

Admins can now restrict data. On each object's Access tab they choose, for the Member role, the Guest role and each team, whether that object is hidden, read only or editable, which of its fields are hidden or read only, and whether people see all records, only records they own, or only records their team owns. The door from spec 0009 already enforces all of this everywhere (tables, boards, record pages, live events, search, counts, exports and the API); this spec stores the rules, reads them in the door, changes how rules combine so teams can grant, and gives admins the screens. Owners and admins are never restricted, and every rule change is audited.

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As an admin, I want Members to have no access to Deals except the Sales team, so pipeline data stays with sales.
- As an admin, I want Salary hidden from everyone but admins, and Stage read only for Support.
- As an admin, I want salespeople to see only the deals they own, and sales leads to see their team's.
- As a guest (a contractor), I want to see only the Projects object an admin shared with me.
- As anyone restricted, I want hidden things simply not to be there, never shown greyed out.

**Acceptance criteria** (this spec owns AC-841 to AC-880):
- **AC-841**: Rules are stored in `access_rules` (object and field levels) and `record_rules`, tenant tables under forced row level security, and read by a production `RuleSource` inside the door's one `withWorkspace` call. `NO_RULE_SOURCE` stays for tests only.
- **AC-842**: A rule's subject is a role (`member` or `guest`) or a team. A rule naming `owner` or `admin`, or a person, is refused 422 `RULE_SUBJECT_INVALID`.
- **AC-843**: Owners and admins get the open policy whatever rules exist (owner decision 2). Their `policyKey` stays `open`. Guests are capped at `read` (spec 0031, AC-828): a Guest role rule above `read` is refused 422 `GUEST_READ_ONLY`, and a team grant of `write` gives a guest in that team `read`.
- **AC-844**: Combining (owner decision 1): each subject that applies to a person (their role, and each of their teams) gives a view: its object level from its rule, else, for the role, the role's default (`write` for Member, `none` for Guest), and, for a team, no view of that object. Each field's level in a view is its field rule capped at the view's object level, else the view's object level. The person gets, per object and per field, the most open level across their views, and the broadest record scope across views that can see the object (`all` over `team` over `own`).
- **AC-845**: Fail closed still holds: a stored level, kind or subject the code doesn't know makes that subject's view of the object `none`, and the unit grid covers it beside AC-844's cases.
- **AC-846**: Object levels are `none` (absent: spec 0009, AC-140), `read` (spec 0009, AC-142) and `write`. Field levels are `hidden` and `read`; there is no field rule above its object. The object's primary attribute can be `read` but never `hidden` (422 `PRIMARY_ATTRIBUTE_VISIBLE`).
- **AC-847**: A record rule is `own` or `team` on one member attribute of the object (Owner by default where the object has one, else Created by). `own` shows records whose attribute names the viewer; `team` shows records whose attribute names anyone in any team the viewer is in, the viewer included. Records with the attribute empty are not visible under a record rule (owner decision 4).
- **AC-848**: Creating a record under an `own` or `team` rule, with the rule's attribute empty, sets it to the creator on the server in the same write. If the creator sets it to someone outside their scope, the write succeeds and the toast reads "Saved. It's owned by Grace Hopper, so you can no longer see it."
- **AC-849**: The record rule attribute must be a member typed attribute of the object, live (not archived); archiving or deleting it while a rule names it is refused 409 `ATTRIBUTE_IN_RULE`, as is changing its type.
- **AC-850**: Setting an object to `none` or a field to `hidden` for a subject that a saved view, a board's grouping, or a form mapping (spec 0023) relies on is allowed; those views drop out for the affected people (spec 0009's rule for views) and the Access tab lists them in a warning before saving: "3 shared views use this field. People who can't see it won't see those views."
- **AC-851**: `access.rules.get(objectId)` returns the object's rules grouped by subject; `access.rules.set(objectId, subject, { object?, fields?, records? })` replaces one subject's rules for one object in one transaction (idempotent: the same input twice changes nothing and writes one audit row only the first time). Both need `access.manage`.
- **AC-852**: Every rule change writes an `audit_events` row (spec 0031) with the before and after for that subject and object, and an `access` outbox row naming every active member the subject covers (the role's members, or the team's), so their screens reload within spec 0009's AC-146 timing.
- **AC-853**: Every surface that exists when this lands shows a stored rule's effect for a restricted member: the table and its counts, the board, the record page and its activity, reference values and their pickers, history, filters and sorts, quick search over records, the trash, live events, and the API procedures. Surfaces built later (#28 notifications, #30 export, #33 search, #34 public API, #35 webhooks) inherit through spec 0009's call sites and each of their specs carries a stored rule test.
- **AC-854**: Hidden means absent, checked with stored rules: a hidden object is not in the sidebar, Settings › Objects (for a member), the command menu, or any picker; a hidden field is not a column, a filter choice, a sort choice, a record page row or an activity entry; a hidden record is not in a page, a count, a search result or a reference chip. No screen shows a lock for any of them.
- **AC-855**: A read only field or object shows the library's read only state with the reason from spec 0009 (`readOnlyReason`): "Your role can't change Stage." or "You can view Deals but not change them."
- **AC-856**: Settings › Objects › (object) gains an Access tab, visible with `access.manage`. It lists the subjects (Member, Guest, then teams by name) with each one's object level as a Select (No access, Can view, Can edit; "Default" for the role's default), a record scope Select (All records, Records they own, Records their team owns) with the attribute picker beside it, and an expandable field list per subject with each field's level (Visible, Read only, Hidden). "Add team" adds a team row. Changes save per subject with Save and Cancel, and say who is affected: "Applies to 12 people."
- **AC-857**: Workspace › Roles lists Owner, Admin, Member and Guest with a one line description and the permission table from spec 0009 (read only), and per role the objects it can't fully edit with links to their Access tabs.
- **AC-858**: A "Preview as" control on the Access tab picks a member and shows the object's fields and a count of the records they can see, read through the door as them (a read only scope minted for the preview, never a write).
- **AC-859**: The door's added cost with rules stays within spec 0009's AC-149 budget: one rule read in the same `withWorkspace` call, at most 5 ms p95 added per request locally with 50 rules. The record rule predicate uses a new partial index on `values` and is measured on the largest seed available (the million record seed locally; the production million run is waived on the current Neon plan).
- **AC-860**: Audiences: with rules stored, members with equal policies share a channel; the relay's fan out with 10 audiences is measured and recorded in `verify.md` (spec 0007's AC-38 one second p95 still holds at 100 online).
- **AC-861**: A guest with no rule sees an empty workspace with one line: "Nothing has been shared with you yet. Ask an admin." The sidebar shows only objects their rules grant.
- **AC-862**: Deleting a team (spec 0031, AC-826) is refused while a rule names it; deleting a custom object deletes its rules in the same transaction; archiving it keeps them.
- **AC-863**: The Access tab and Roles page are keyboard usable, labelled per row ("Access to Deals for Sales"), and meet WCAG AA.

## Decision

**Chosen option**: Option 1: rules per object stored per subject (role or team), combined most open wins, owners and admins exempt, enforced by spec 0009's door with no new choke point.

**Implementation skills**: `crm-data-model-access` (house, `.claude/skills/crm-data-model-access/`) · `crm-api-backend` (house, `.claude/skills/crm-api-backend/`) · `crm-frontend-state` (house, `.claude/skills/crm-frontend-state/`) · `crm-design-system` (house, `.claude/skills/crm-design-system/`) · `security-and-hardening` (`addyosmani/agent-skills`, `.claude/skills/security-and-hardening/`) · `drizzle` (`.claude/skills/drizzle/`) · `neon-postgres` (`.claude/skills/neon-postgres/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Dependencies

- **Spec 0009** milestones 2 and 3 (hidden means absent, audiences, the 4500 reload) must be landed; check before building. This spec changes only `memberPolicy`'s combining rule and adds the rule store.
- **Spec 0031**: teams, guests, `teamIds` in the door, `audit_events`.
- **Spec 0026**: the settings navigation.

### The combining rule (replaces spec 0009's "strictest wins" in `memberPolicy`)

```
views = [roleView(role, rules)] + teams.map(t => teamView(t, rules))   // a team view may be empty for an object
objectLevel(o)   = max over views of view.object(o)                     // none < read < write
fieldLevel(f)    = max over views that see o of min(view.field(f), view.object(o))
recordScope(o)   = broadest over views that see o of view.records(o)    // all > team > own
```

A role view's object level defaults to the role default; a team view has no default (a team only grants). An unknown stored value makes that view `none` for the object. `policyKey` hashes the result, so two people with different teams but the same result share an audience.

### Data model sketch

One migration. Tenant tables, `workspace_id`, audit columns, forced row level security.

| Table | Columns | Rules |
|---|---|---|
| `access_rules` | `id`, `subject_type` (`role`, `team`), `subject_role` `member_role` null, `subject_team_id` null, `object_id`, `attribute_id` null, `level` text | Exactly one subject column set (check); `subject_role` in (`member`, `guest`) (check); unique (`workspace_id`, subject, `object_id`, `coalesce(attribute_id, zero uuid)`); foreign keys to `teams`, `objects`, `attributes` carrying `workspace_id`; `level` kept as text so the code fails closed on an unknown one |
| `record_rules` | `id`, subject as above, `object_id`, `kind` text, `attribute_id` | unique (`workspace_id`, subject, `object_id`); foreign key to `attributes` |
| index on `values` | (`workspace_id`, `attribute_id`, `actor_member_id`, `owner_id`) where `active_until is null` | Serves the record predicate's `exists`; created concurrently in its own migration |

The door's rule read: `select ... from access_rules where subject_role = $role or subject_team_id = any($teamIds)` plus the same on `record_rules`, inside the door's transaction, after the member row.

### API surface

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `access.rules.get` | `workspace`, `objectId` | `{ subjects: [{ subject, object?, fields: {attributeId: level}, records? }] }` | `access.manage` | 403, 404 |
| `access.rules.set` | `workspace`, `objectId`, `subject`, `object?`, `fields?`, `records?: { kind, attributeId } \| null` | the subject's rules, `affectedMembers: number` | `access.manage` | 403, 404, 409 `ATTRIBUTE_IN_RULE`, 422 `RULE_SUBJECT_INVALID`, 422 `PRIMARY_ATTRIBUTE_VISIBLE` |
| `access.rules.impact` | `workspace`, `objectId`, `subject`, proposed rules | `{ affectedMembers, viewsAffected, formsAffected }` | `access.manage` | 403 |
| `access.preview` | `workspace`, `objectId`, `memberId` | `{ fields: visible attribute ids with levels, recordCount }` | `access.manage` | 403, 404 |
| `access.roles` | `workspace` | the four roles, labels, descriptions, permissions | member | 404 |
| `access.mine` (changed) | `workspace` | adds `teamIds` (spec 0031) | member | 404 |

`attributes.archive`, `attributes.delete`, `attributes.changeType` gain the `ATTRIBUTE_IN_RULE` refusal.

### Value sourcing

| Action | Value | Source |
|---|---|---|
| door | rules | `access_rules` and `record_rules` for the role and `teamIds`, in the door's query |
| door | role default | `ROLE_DEFAULT_OBJECT` in contracts: member `write`, guest `none` |
| policy | combined levels | AC-844's function in `policy.ts` |
| Access tab | subjects | the roles `member` and `guest`, and teams with any rule on the object, plus those added |
| Access tab | "Applies to N people" | active members with that role, or in that team, from `access.rules.impact` |
| Access tab | default record attribute | the object's member typed attribute with api slug `owner`, else `created_by` |
| create under a rule | the owner value | the creator's member id, set by `parseAll` when the rule's attribute is empty |
| toast after create | the owner's name | the write's answer (the value written) through `members.list` |
| preview | member's access | `roleAccess` for that member's role, teams and the stored rules, with a read only scope from `@crm/core/system`'s `enterAsActor` in read only mode |
| read only reason | text | spec 0009's `readOnlyReason` |

### Key invariants

- Owners and admins always get the open policy; guests never get above `read`.
- A team only grants; a role sets the baseline.
- A field is never more open than its object, per view and in the result.
- Unknown stored values deny that view of the object.
- The primary attribute is never hidden.
- A rule change reaches every affected open screen through an `access` row.
- Hidden is absent on every surface; the client's copy of rules only shapes the Access tab.

### Security model

- `access.manage` (owners and admins) for every rule read and write; members never see other subjects' rules.
- Rules are tenant data under row level security; the door reads them inside `withWorkspace`.
- The preview mints a read only scope for the chosen member, never usable for writes, and is audited (`access.previewed`).
- Lockout impossible: owners and admins are exempt, and the last owner guard holds.
- `security-access-reviewer` on every milestone; `state-performance-reviewer` on milestones 1 and 3 (the door read, the predicate, the fan out).

### Configuration required

None.

### Critical test scenarios

- Grant pattern: Member role `none` on Deals, Sales team `write`; a member in Sales edits deals, a member outside sees no Deals anywhere, an admin sees all, verifies **AC-843**, **AC-844**, **AC-854**.
- Fields: Salary hidden for Member; the column, filter, sort, history and event ids are absent for a member; present for an admin, verifies **AC-846**, **AC-853**, **AC-854**.
- Records: Sales `own` on Owner; a salesperson's table, count, search and reference chips show only their deals; creating one with Owner empty makes them the owner; setting Owner to a colleague hides it with the toast, verifies **AC-847**, **AC-848**.
- Fail closed: a stored level `"manage"` (unknown) makes the object absent for that subject, verifies **AC-845**.
- Live: changing a rule in one browser makes a column disappear in a member's browser within AC-146's timing without reload, verifies **AC-852**.
- Guards: hiding the primary attribute, a rule for `admin`, archiving a rule's attribute, deleting a team in use: each refused with its code, verifies **AC-842**, **AC-846**, **AC-849**, **AC-862**.
- Cost: door time with 50 rules; the predicate on the million record seed with the new index (EXPLAIN in `verify.md`), verifies **AC-859**, **AC-860**.

## Build plan

**Milestone 1: one stored rule, end to end** (object level only)
1. Migration: `access_rules`, `record_rules`; contracts for rules, `ROLE_DEFAULT_OBJECT`, error codes, satisfies **AC-841**, **AC-842**
2. `policy.ts`: the AC-844 combining rule replaces strictest wins, owners and admins exempt; the unit grid updated (spec 0009's AC-150 grid plus team grants and unknown values), satisfies **AC-843** to **AC-845**
3. The production `RuleSource` in the door; measured, satisfies **AC-841**, **AC-859**
4. `access.rules.get` and `set` for object levels, audit and `access` rows; the Access tab with object levels only, satisfies **AC-851**, **AC-852**, **AC-856**
5. Deploy; in production, hide an object from the Member role and check it with a member account; `security-access-reviewer`, satisfies **AC-853**, **AC-854**

**Milestone 2: fields**
6. Field rules in `set`, the primary attribute guard, the impact check for views and forms; the field list on the Access tab, satisfies **AC-846**, **AC-850**, **AC-855**
7. Surface sweep with stored field rules (Playwright, one restricted member, each surface in AC-853), satisfies **AC-853**, **AC-854**

**Milestone 3: records**
8. Record rules in `set`, the attribute guard on archive, delete and type change, the `values` index (concurrently), satisfies **AC-847**, **AC-849**
9. Owner defaulting on create, the out of scope toast, satisfies **AC-848**
10. Predicate measured on the million record seed; audience fan out measured, satisfies **AC-859**, **AC-860**

**Milestone 4: roles page, preview, guests**
11. Workspace › Roles; `access.roles`, satisfies **AC-857**
12. Preview as, with its read only scope and audit, satisfies **AC-858**
13. Guest empty state and sidebar; team delete and object delete interplay, satisfies **AC-861**, **AC-862**
14. Accessibility pass, `ux-interaction-reviewer`, `/check verify`, satisfies **AC-863** and all

## Consequences

**Positive**:
- "Everyone but Sales" and "only your own deals" are both one rule away.
- Enforcement already exists and is tested; this spec mostly stores and combines rules.
- Nobody who manages access can be locked out.

**Negative / tradeoffs**:
- Combining changes from strictest to most open; a team rule can widen what a role rule narrowed, so an admin must think in "default, then grants". The Access tab's "Applies to N people" and Preview as exist for this.
- Records with an empty owner vanish for people under a record rule until someone owns them.
- Each distinct policy is an audience; many teams with different rules multiply the relay's publishes.
- The record predicate adds an `exists` per row and hop; the index costs write time on `values`.
- No per list or per person rules yet.

**Neutral**:
- Two migrations (tables, then the concurrent index). No new dependencies.
- Spec 0009's decision line "where several apply, the strictest wins" is superseded by AC-844 here; `/sync` records it against spec 0009.

## Follow-up

- [ ] Per list access (Attio's list permissions).
- [ ] Rules per person, if teams of one become common.
- [ ] Read only for records outside a record rule, if asked (owner decision 5's runner up).
- [ ] Custom roles (a fifth role with a chosen permission list) for a later plan.
- [ ] `/sync`: amend spec 0009's combining line and `packages/core/AGENTS.md`.
