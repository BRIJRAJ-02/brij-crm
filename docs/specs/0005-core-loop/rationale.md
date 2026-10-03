# 0005. The core loop: decision record

## Context

The engine (#5), the tokens (#3) and most of the component library (#4) exist, but nothing can be used: production shows a status page. The owner judges the product by its screens and flows, so the next step must put a real, clickable path in production as early as possible, and build it carefully.

The scope's next feature, the core loop (#10), needs four foundations that have no spec yet: the client data layer (#6), change events and realtime (#7), the access model (#9) and edge only API access (#57), plus the sign in part of workspaces and members (#23). Building each fully first would put the first screen weeks away. Building the loop with shortcuts would leave the foundations to be replaced later.

Forces: every table forces row level security, so the API cannot find a workspace or check membership without a global lookup. The engine's `Change` payload knows nothing about object ids, mutation ids or definition changes. TanStack DB, spec 0001's choice, is pre 1.0 and conditional on a prototype. There is no domain yet, so production email reaches only the Resend account owner. The Railway API host is public, so forwarded IPs can be forged.

## Options considered

### Option 1: one thin thread, each part in its final shape (chosen)

Build only what the loop touches in #6, #7, #9 and #57, but in the shape those features will keep: the door, the data layer interface, the outbox.

**Pros**: a clickable product after milestone 1; the later features extend instead of replace.
**Cons**: four areas move at once; some decisions are made with less context than a full feature spec would have.

### Option 2: finish #6, #7, #9 and #57 first, then the loop

**Pros**: each foundation fully specced and built before use.
**Cons**: weeks before anything is visible; foundations designed without a real screen to test them against.

### Option 3: the loop with shortcuts (owner connection for lookups, no outbox, polling)

**Pros**: fastest to a first screen.
**Cons**: breaks the "app role never bypasses row level security" rule; every shortcut is rework; live updates by polling miss the 1 second target at scale.

## Rationale

The owner asked for a visible product early and for care over speed; option 1 is the only one that gives both. The tenancy model rules out option 3's shortcuts. Option 2's foundations would be designed blind. Each part is still bounded: the door allows only "active member may do everything", the data layer serves one unfiltered, unsorted table, and the outbox carries ids only, so #6, #7 and #9 add to them without rework.

Per decision (each asked of the owner, with the recommendation taken):
- Email code plus Google over passwords: no reset flow, no unverified accounts, no pre registration hijack.
- A naming step over an automatic workspace: the slug lives in every URL and needs a place to show `SLUG_TAKEN`.
- Live columns: the loop reads as broken if a column appears only after reload.
- No setup attribute types: select, status, currency and relations need option and object editors that belong to #13.
- Dialogs for add attribute and new person: the grid stays unchanged.
- Auth modules pulled into the library: screens stay library only.
- A prototype before TanStack DB: honours spec 0001's gate without blocking screens, because the interface is fixed first.
- Schema writes wait for the server: they are often refused and reshape the grid.
- The edge secret now: sign up and email sending go to production in milestone 1.
- An `auth` schema with the organization plugin off: identity stays global without a second definer function, and the plugin's own endpoints can't change membership around the door.
- Start without a domain: everything is built and testable; a domain plugs in later without code changes.
- Definer functions for the relay: no new login or secret, the reviewed `crm_search_text` pattern.
- An allowlist for sign up: no strangers on an early build.
- 30 day sessions: usual for work tools.
- No delete and no edit clash notice in the loop: they belong to #22 and #6.

## Evidence

The wave 1 maps (5 read only readers, 3 October 2026) found: `packages/data` is only an oRPC client; the contract has only `system`; the API's RPC handler swallows errors unlogged; `DataGrid` reads a `RowSource`; `Change` has no object or mutation ids and nothing for definitions; Centrifugo runs on Railway with its secrets but no namespace; the CSP has no realtime origin; the first load is at 166 of 250 kB.
