# 0032. Access rules: rationale

## Context

Spec 0009 built the whole enforcement path: a sealed scope carrying a data policy, applied at the engine's few choke points, so a hidden object, field or record is absent from every read, count, filter, event and refusal. What it left empty is the source: no rule table, no screens, and `RuleSource` returns `NO_RULES` in production. It also chose how rules combine when several apply to one person: the strictest wins.

That combining choice was harmless while no rules existed. With teams (spec 0031) it decides what admins can express. The common need in a CRM is "most people can't see X, but this group can" (pipeline, compensation, a client's private records), and with strictest wins it can't be said: a role rule of `none` beats any team grant.

The other forces: owners and admins must never lock themselves out; a mistake in a rule leaks data, so unknown values must still fail closed; and the cost budget (spec 0009's 5 ms door, the million record benchmark, spec 0007's one second live delivery) must hold with real rules.

## Options considered

### Option 1: default plus grants, most open wins, admins exempt (recommended)

Each role sets a baseline per object; teams can only grant more. A person gets the union of their role's view and their teams' views. Owners and admins always see everything.

**Pros**: matches how Attio and most CRMs teach access ("workspace default, then who gets more"); "everyone but Sales" is two rules; no lockout.
**Cons**: an admin can't use a team to take something away from some members; to restrict a subgroup you lower the role and grant everyone else through teams.

### Option 2: strictest wins (spec 0009 as built)

Every applicable rule restricts; the tightest level wins.

**Pros**: already coded and tested; adding a rule can never widen access, which is easy to reason about for security.
**Cons**: grants are impossible, so the most common request can't be expressed; admins would create odd roles to work around it.

### Option 3: ordered rules with explicit allow and deny (firewall style)

Each rule says allow or deny; the first or the most specific match wins.

**Pros**: can say anything.
**Cons**: hard to read, hard to preview, and the classic source of access mistakes; nothing in Attio, Linear or HubSpot works this way for end users.

### Screen placement options

A per object Access tab (Attio puts access next to the object; Twenty puts object level rules inside a role page) versus a central matrix (HubSpot's per user permission sets). The tab wins because admins think "who can see Deals", and the object page already holds that object's attributes, which the field rules list.

## Rationale

Option 1 is the only one that makes the scope's own example ("limits a role to records they or their team own" while a team sees more) expressible without contortions, and the exemption for owners and admins removes the lockout risk that makes Option 2's caution attractive. Fail closed survives the change, because it was always about unknown values, not about combining. Option 3's power isn't needed at this size and would make the "Preview as" check the only way anyone could understand a rule set.

Absent rather than read only for records outside a rule keeps spec 0009's single predicate and its measured SQL; read only per record would need a second predicate per level. Owner defaulting on create avoids the confusing case where a salesperson's new deal disappears the moment they save it.

**Owner decision runners up, in short**: strictest wins (safe but can't grant); rules on admins (more control, real lockout risk); per person rules (precise, but rule sprawl that teams avoid); unowned visible (friendlier for imports, but leaks exactly the records an own rule means to hide); outside read only (more open, more SQL); a central matrix (good overview, poor for fields); per list access now (more surface before the core is proven).

## References

**Project sources**:
- Spec 0009 (access model): the policy, choke points, rule table sketch, `filterEvent`, AC-149's budget.
- `packages/core/src/access/policy.ts` (`memberPolicy`, `roleAccess`, the `RuleSource` contract in `door.ts`).
- Spec 0031: teams, guests, `audit_events`.
- House skill `crm-data-model-access`: rules per object, field and record; hidden means absent; fail closed.

**Practices and standards**:
- Least privilege with explicit grants; deny by default for unknown values.
- Attio's access model: a workspace default per object, raised for members and teams.

**Links** (screens seen through Mobbin while writing this):
- Twenty role page with object level rules and settings permissions: https://mobbin.com/screens/9a091d5d-dbee-4b66-8381-375e37f8f466
- HubSpot user access levels (seat, permission set, from scratch): https://mobbin.com/screens/f2dbe8e2-3c2e-40fd-8fe6-c927d86c4739
- Attio settings navigation (Objects under Data): https://mobbin.com/screens/e6c25f0a-5bf1-4abb-aed4-55e23de799d3
