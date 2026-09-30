---
name: crm-data-model-access
description: House rules for the CRM's data model and permissions, modelled on how Attio works. Use it whenever you design, change, query or review anything about workspaces, objects, attributes, attribute types, records, values, relationships, lists and entries, status stages, value history, migrations, indexes, tenancy, roles, teams, or object, field and record access. Use it too for any query that reads records, since every read has to pass the access door.
---

# CRM data model and access rules

The data model is the most expensive thing to redo, and access mistakes leak other people's data. So these rules come first, before any convenience. The exact tables and indexes live in the data model and access model specs (features #5 and #9, in `docs/specs/` once written). Attribute types and the prebuilt attributes on People, Companies and Deals come from the research in `docs/research/crm-attributes.md`.

## The model, as Attio does it

- **Workspace:** the tenant. Everything belongs to exactly one.
- **Object:** a kind of record. People, Companies and Deals are standard objects, but they run on exactly the same engine as a customer's custom objects. There are no special tables for the standard ones, so every feature works on every object for free.
- **Attribute:** a typed field on an object, with its own config (options, currency, required, unique, default, description, group). Some types hold many values (several emails, phones or domains). System attributes, such as created at, created by and record id, are attributes too, just read only.
- **Record:** one instance of an object.
- **Value:** what a record holds for an attribute. It's typed, never "everything is a string". Every change is kept with who made it and when, so the value on any date, and the time spent in each status stage, can be answered.
- **Relationship:** one definition that gives each of the two objects its own paired attribute (Company · People and Person · Company). Each link is stored once and read from both ends, and cardinality (one to one, one to many, many to many) is enforced on both sides.
- **List and entry:** a list collects records of one object. Each entry has attribute values of its own (such as a stage in this pipeline), separate from the record's attributes. A record can sit in many lists.
- **Status:** an attribute type with ordered stages, used for boards and time in stage.
- Notes, tasks, comments and files attach to any record by record id. There are no per object columns for them.

## Rules, and why

1. **Reference by id, never by slug or label.** Keys and slugs are for URLs and display, so renames never break links.
2. **Options have their own ids.** Renaming or recolouring a select option then never rewrites records.
3. **Every row carries its workspace, created by, created at and updated at.** "Who made this" can never be added later.
4. **Isolation is enforced by the database, not just by the query.** A query that forgets its workspace filter still returns nothing from another workspace.
5. **Deletes are soft, with a restore window.** Hard deletes only happen as explicit, counted jobs. Deleting a record removes its links, never the records on the other side.
6. **Filtering and sorting on any attribute must stay inside the scale budget at a million records.** Design the storage and indexes for it up front. The load harness is the judge, not a guess.
7. **No hidden writes.** A function named like a read never writes, and reads never trigger lazy migrations. Schema changes and seeds are explicit, versioned steps.
8. **Limits live in one place and refuse clearly.** Plan limits (objects, records, storage) are checked by one module and never silently truncate.

## Access, one door

- **Roles are flat lists of permissions,** not a hierarchy. Adding a permission never silently grants it to every role above. Teams are groups of members that rules can target.
- **Rules can be per object** (none, read, write, manage), **per field** (hidden or read only) and **per record** (own records, or your team's records).
- **Every read and write goes through one door:** authorise the actor for the action on the resource. The data layer only accepts a scope that door produced, so a new screen, job or endpoint can't skip it.
- **Fail closed.** An unknown role or a missing rule means no access.
- **Hidden means absent, never shown as locked.** That applies to screens, live events, search, notifications, exports, webhooks and the API alike.
- **API keys and integrations are actors too,** with their own scoped permissions through the same door.
- The last owner can't be removed, and an admin can't make someone an owner. Membership, role, team, rule and key changes are all written to the audit log.

## Before you finish any data or access change

- [ ] Standard and custom objects still share one path.
- [ ] Ids, not slugs; option ids, not labels.
- [ ] Workspace isolation holds even if the filter is removed. Prove it with a test that tries.
- [ ] Every new read or write goes through the access door, and there's a test showing a denied actor gets nothing.
- [ ] Value history and the audit log are written.
- [ ] The query holds the scale budget on the million record seed.

For a second opinion, ask the `security-access-reviewer` agent. The installed `domain-modeling` and `system-design` skills help with naming and design discussions.
