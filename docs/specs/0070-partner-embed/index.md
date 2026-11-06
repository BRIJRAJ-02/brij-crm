# 0070. Timefix inside other products: partner connect, managed members and embedded modules

**Date**: 2026-11-06
**Status**: Proposed

**Numbering**: 0069 is held for the link page studio. This spec owns AC-7001 to AC-7099.

## Summary

Another company's product can offer Timefix modules to its own users without those users ever signing up to Timefix. The first is a client's marketing hub: a Timefix tab there shows an Integrate Timefix button. The hub's admin signs in to Timefix once, picks the modules they want (link pages first), and connects. From then on, the hub adds and removes its team in Timefix itself, opens our screens inside its own tab, and its super admin manages every teammate's link page and QR code.

It is built to work for any outside product, not only this hub. Charging partners comes later; this build records who uses what so billing can plug in.

## Requirements

**Words used here**

- **Partner**: an outside product registered with Timefix (the marketing hub is the first).
- **Connection**: one partner organisation linked to one Timefix workspace, with the modules it may use.
- **Managed member**: a person the partner added. They have no Timefix password and get in only through the partner.

**Owner's decisions (6 Nov 2026)**

- The hub is a client's product; the design must work for any partner.
- One workspace owner signs in to Timefix themselves; everyone else is created silently by the partner.
- Pages live on `timefix.com/<handle>`, and "Powered by Timefix" stays on them.
- Charging partners comes later.

**Slice 1. Team link pages, inside Timefix** (useful on its own, before any partner)

- **AC-7001**: A new Team pages screen (Link page › Team) lists every member of the workspace with their handle, whether their page is published, and its views this month. Owners, admins and anyone with the new permission `link_pages.manage_team` see it. Others don't.
- **AC-7002**: From Team pages, someone with that permission can claim a handle for a member, then open and edit that member's link page in the same editor members use for their own. The page stays the member's: it is listed under their name, and they can still edit it themselves.
- **AC-7003**: Every link page has a QR code: one per page from its row's ⋯ menu (PNG and SVG), and Download all QR codes for the team as one zip. A QR code encodes `https://timefix.com/<handle>` only, and keeps working if the page's look changes.
- **AC-7004**: Every change one person makes to another's page is written to History with who changed what. The member sees "Edited by <name>" on their own page's activity.

**Slice 2. Registering a partner and connecting a workspace**

- **AC-7010**: A super admin registers a partner in the operator console (spec 0047): a name, its logo, the web addresses allowed to embed Timefix, and the addresses allowed to receive a connection. The console shows a client id, and a secret once. The secret can be replaced, and the old one stops at once. Only a hash of the secret is stored.
- **AC-7011**: Integrate Timefix in the partner opens Timefix's connect page (an OAuth 2.0 authorization code flow with PKCE). The partner's admin signs in or signs up to Timefix, picks an existing workspace they own or creates one, ticks the modules to share, and approves. Timefix redirects back with a one time code. The partner's server swaps it for a connection id and an access token, using its secret. A partner never gets into a workspace that nobody in it approved.
- **AC-7012**: The connect page names the partner, lists exactly what it may do ("add and remove people in this workspace, open Link pages for them"), and shows the partner's logo. It refuses a redirect address the partner didn't register.
- **AC-7013**: Modules are switched on per connection from a closed list in contracts, with `link_pages` the only entry now (booking, forms and menus join later). The workspace's owner sees and can change them in Settings › Connected apps, together with when it connected and the partner's last call. Disconnect asks first and ends every embedded session for that partner at once.

**Slice 3. Managed members**

- **AC-7020**: The partner's server adds or updates a person with `PUT /api/partner/v1/connections/{id}/members/{externalId}`, giving an email, a name and a role (admin or member). Timefix creates a managed member silently, with no invitation email. The call is idempotent: the same external id is always the same person.
- **AC-7021**: A managed member is keyed by partner and external id, never by email. An email that already belongs to a Timefix account is not merged or signed in as that account. The managed member is a separate person, so a partner can never take over someone's existing Timefix login.
- **AC-7022**: `DELETE` on the same address removes the person from the workspace. Their handle stops working as in AC-5603, their sessions end, and their page's content stays for 30 days in case they come back.
- **AC-7023**: A managed member can't sign in at app.timefix.com and gets no email from us except what their page's visitors trigger. The member can later claim a full Timefix login from Settings, after confirming their email; this keeps them in the workspace and doesn't affect the partner.
- **AC-7024**: Roles map to Timefix's: the partner's admin maps to admin, with `link_pages.manage_team`, and member maps to member. The partner can't make an owner, and can't change the owner who connected.
- **AC-7025**: The partner API answers only for connections that partner owns, and every call needs its access token. Calls are limited per partner and written to the workspace's History as the partner. Errors use the `{ code, message }` shape. The API is versioned under `/v1`.

**Slice 4. Embedded screens**

- **AC-7030**: To open Timefix for someone, the partner's server calls `POST /api/partner/v1/connections/{id}/launch` with their external id and the screen to open (`link_pages.mine`, `link_pages.team`). It gets a one time address that works once, within 60 seconds.
- **AC-7031**: That address opens an embedded session. It is limited to that person, that workspace and the connection's modules, and lasts 12 hours. The session's cookie is `Secure`, `SameSite=None`, `HttpOnly` and `Partitioned`, so it works inside the partner's frame and nowhere else. Where the browser still refuses it, the screen offers "Open in a new tab", which uses a fresh launch.
- **AC-7032**: Embedded screens live under `app.timefix.com/embed/…`. They draw without our sidebar or top bar, in light or dark as the partner asks, and send their height to the parent page. They are allowed to load only inside the partner's registered web addresses (`frame-ancestors`), and refuse anything else.
- **AC-7033**: Inside the frame, a person can reach only the shared modules. A link to anything else (People, Settings, another workspace) isn't drawn, and the server refuses it for an embedded session.
- **AC-7034**: A short partner guide (one page, with copyable requests and a sample frame) explains connect, members and launch, for the hub's developers.

**Public pages**: link pages stay at `timefix.com/<handle>`, with "Powered by Timefix" in its usual place (AC-5601 to AC-5608 and 0051 unchanged).

## Decision

- **Connect is OAuth 2.0 with PKCE**, so a person in the workspace always approves it. Runner up: a partner key typed into Timefix by the owner. That's fewer screens, but it's copy and paste of secrets, and other partners will expect OAuth.
- **Launch is server to server, then a one time address.** No token from the partner ever sits in the browser. Runner up: a JWT the partner signs and passes into the frame's address. That's simpler for them, but a token in an address leaks through history and logs, and we'd hold their keys.
- **Embedded screens are our real screens without the frame**, so a partner gets every improvement for free. Runner up: a public API with the partner drawing its own screens. That's much more work for them and leaves them behind every release.
- **Managed members are separate people keyed by external id**, never merged by email. That's AC-7021: it is what stops account takeover.
- Partner secrets and connection tokens are stored only as hashes, using the existing key helpers (`keySecretMatches`, spec for API keys).
- **Implementation skills**: crm-data-model-access, crm-api-backend, crm-frontend-state, crm-design-system, security-and-hardening, better-auth-best-practices.

## Data

New tables, tenant scoped where they belong to a workspace, with forced row level security.

- `partners` (not tenant): name, logo, allowed frame origins, allowed redirect addresses, client id, secret hash, created and replaced dates.
- `partner_connections` (tenant): partner, workspace, approved by, modules, token hash, created, last call, disconnected.
- `managed_members` (tenant): connection, external id, member id; unique on connection and external id.
- `partner_launches`: one time code hash, connection, member, screen, expires; used once.
- Embedded sessions sit in the existing session table with a scope column (`embed`, connection id).

## Build plan

Tracer Bullet, each slice landing on its own:

1. **Slice 1**, team link pages and QR (AC-7001 to AC-7004): helps every Timefix workspace now.
2. **Slice 2**, partners and connect (AC-7010 to AC-7013): test with a small sample partner page in the repo's test tools, never shipped.
3. **Slice 3**, managed members (AC-7020 to AC-7025).
4. **Slice 4**, embedded screens and the guide (AC-7030 to AC-7034): checked in Chrome, Safari and Firefox inside a real frame on another origin.

Slices 2 to 4 each get a `security-access-reviewer` pass before landing.

## Consequences

- Timefix gains its first outside callers that aren't a person. The partner API is a promise: once a partner builds on `/v1`, it can't change without a `/v2`.
- Safari and privacy browsers may refuse cookies in frames even when partitioned. The new tab fallback keeps it working, just less smoothly.
- People in a partner's workspace exist in Timefix without having signed up, so the operator console must show them as managed, and our counts of users must tell them apart.

## Follow-up

- Charging partners: per connection, per seat or per module, using `partner_connections`.
- More modules: booking pages, forms, menus.
- Webhooks to the partner (a page published, a booking made).
- A custom domain per partner, if a partner asks.

## Rationale

See [rationale.md](rationale.md).
