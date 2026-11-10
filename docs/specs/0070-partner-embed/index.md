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
- **AC-7004**: Every change one person makes to another's page is written to History with who changed what. The member sees "Edited by <name>" on their own page's activity. A manager's change to a member's page photo (cover, profile photo or background) has its own value in `LINK_PAGE_TEAM_CHANGES`, `photo`: History reads "changed a photo on X's link page", no longer folded into `look` (10 Nov 2026).

**Slice 2. Registering a partner and connecting a workspace**

- **AC-7010**: A super admin registers a partner in the operator console (spec 0047): a name, its logo, the web addresses allowed to embed Timefix, and the addresses allowed to receive a connection. The console shows a client id, and a secret once. The secret can be replaced, and the old one stops at once. Only a hash of the secret is stored.
- **AC-7011**: Integrate Timefix in the partner opens Timefix's connect page (an OAuth 2.0 authorization code flow with PKCE). The partner's admin signs in or signs up to Timefix, picks an existing workspace they own or creates one, ticks the modules to share, and approves. Timefix redirects back with a one time code. The partner's server swaps it for a connection id and an access token, using its secret. A partner never gets into a workspace that nobody in it approved.
- **AC-7012**: The connect page names the partner, lists exactly what it may do ("add and remove people in this workspace, open Link pages for them"), and shows the partner's logo. It refuses a redirect address the partner didn't register.
- **AC-7013**: Modules are switched on per connection from a closed list in contracts, with `link_pages` the only entry now (booking, forms and menus join later). The workspace's owner sees and can change them in Settings › Connected apps, together with when it connected and the partner's last call. Disconnect asks first and ends every embedded session for that partner at once.

**Slice 3. Managed members**

- **AC-7020**: The partner's server adds or updates a person with `PUT /api/partner/v1/connections/{id}/members/{externalId}`, giving an email, a name and a role (admin or member). Timefix creates a managed member silently, with no invitation email. The call is idempotent: the same external id is always the same person.
- **AC-7021**: A managed member is keyed by partner and external id, never by email. An email that already belongs to a Timefix account is not merged or signed in as that account. The managed member is a separate person, so a partner can never take over someone's existing Timefix login.
- **AC-7022**: `DELETE` on the same address removes the person from the workspace. Their handle stops working as in AC-5603, their sessions end, and their page's content stays for 30 days in case they come back. After those 30 days the daily cleanup purges it (built 10 Nov 2026, phase `managed_pages`, for partner and page only people alike): the page, its blocks, counts, pictures and social links, and the stored files. The handle goes into the 90 day hold of migration 0122, not freed at once. The member row stays, named, with its identity link cleared and a made up address, so History keeps a name and loses the link. A person with any member row here that isn't removed (a guest, or a workspace in its restore window) is never purged. Someone with their own Timefix login (AC-7023) is never removed by a `DELETE` and never purged: see AC-7023.
- **AC-7023**: A managed member can't sign in at app.timefix.com and gets no email from us except what their page's visitors trigger. The no email rule also covers an address a managed person was given: they are left out of the workspace deletion notice and of permission holders' notices. Booking mail to a host is still sent, as their page's visitors trigger it.
  - **A Timefix login of their own** (owner, 10 Nov 2026; built, migration 0206). An admin of the workspace (holding both `link_pages.manage_team` and `members.invite`) can set up a Timefix login for them from Team pages' row menu in Timefix. Only an owner sets one up for an owner. Nothing starts one from inside the partner's frame, not the person and not the app's admin: `teamPages.inviteLogin` and `teamPages.cancelLoginInvite` are left out of the frame's procedures (`apps/api/src/embed.ts`), and core refuses a call marked as from the frame too. Inside the frame the person's own page shows one line with no action: "Want to sign in to Timefix directly? Ask an admin of {workspace} to set up your login."
  - It reuses AC-7046's invitation (`invitations.member_id`): 7 days, single use, bound to workspace and member and checked again under lock, no seat, not listed in Members › Invitations. Resent to the same address it is renewed in place; sent to another, the open one is revoked and replaced. Removing the person cancels it. The sender must still hold both permissions when it is opened, and the person's role is read again then: someone made an owner since opens it only if an owner sent it.
  - The email and the invite page always name who set it up ("Ada set up a Timefix login for you in Acme."), and name the app: "Keep using {app} as before. You can also sign in to Timefix directly." The invitation gives no role: its row keeps `role = 'member'` only for `invitations_member_shape`, and the claim never touches the person's role. `invitation.created` for a login carries `login: true` and no role.
  - Opening it with no session turns the managed identity into a login at the invited address, in place (email set and verified): the same member, page, handle and History. An address that already has a Timefix login is refused when the link is opened, with the hand over's message (AC-7021: never merged).
  - The app keeps managing them. Their `managed_members` row and their `auth.managed_users` row stay, each marked `claimed_at`, so the partner's PUT with the same external id finds the same identity, and list and launch still work. They also sign in at app.timefix.com and see their page there. From then on they get Timefix's email like any member, the session hook lets them sign in, and the operator console counts them as signed up, not managed.
  - The partner's PUT still changes their name on their member row in this workspace (never their account's name, so other workspaces keep theirs), and never their address. The answer carries the login's address and `hasTimefixLogin: true`, an additive field on `PartnerMemberView`, so `/v1` holds.
  - **Release, not removal.** A partner's `DELETE` of someone with a login only lets go of them: `managed_members.removed_at` is set, they leave the partner's list and launch, and their embedded sessions end. They stay an active member with their login, page and seat. History: `member.app_released` ("<App> stopped managing Bea, who keeps their Timefix login"). Disconnecting the app leaves them as they are. The workspace removes them through Members like anyone.
  - A PUT with the same external id after that release manages them again (the same member, `member.added` in History), while they are still an active member. Once the workspace removed them, or they left, or the workspace made a released person an owner, the partner's PUT answers 403 `FORBIDDEN` ("Only the workspace can invite them back").
  - The 30 day purge never touches them: the daily cleanup's selection skips `claimed_at`, and `crm_purge_managed_page` itself refuses a person whose `managed_members` row here is claimed.
  - The frame can't reach a login invitation: `teamPages.cancelInvite` refuses anyone but a page only person, and the frame's Team pages list leaves out a login invitation's address.
- **AC-7024**: Roles map to Timefix's: the partner's admin maps to admin, with `link_pages.manage_team`, and member maps to member. The partner can't make an owner, and can't change the owner who connected. For someone who has their own Timefix login (AC-7023), the partner can keep or lower their role but not raise it (10 Nov 2026): a raise (member to admin or owner, a guest to member) answers 403 `FORBIDDEN`, "This person has their own Timefix login. Their role can only be raised inside Timefix." Lowering admin to member clears any custom role, as before. A role the code doesn't know ranks below every other, so any change to it is refused.
- **AC-7025**: The partner API answers only for connections that partner owns, and every call needs its access token. Calls are limited per partner and written to the workspace's History as the partner. Errors use the `{ code, message }` shape. The API is versioned under `/v1`.

**Slice 4. Embedded screens**

- **AC-7030**: To open Timefix for someone, the partner's server calls `POST /api/partner/v1/connections/{id}/launch` with their external id and the screen to open (`link_pages.mine`, `link_pages.team`). It gets a one time address that works once, within 60 seconds.
- **AC-7031**: That address opens an embedded session. It is limited to that person, that workspace and the connection's modules, and lasts 12 hours. The session's cookie is `Secure`, `SameSite=None`, `HttpOnly` and `Partitioned`, so it works inside the partner's frame and nowhere else. Where the browser still refuses it, the screen offers "Open in a new tab", which uses a fresh launch.
- **AC-7032**: Embedded screens live under `app.timefix.com/embed/…`. They draw without our sidebar or top bar, in light or dark as the partner asks, and send their height to the parent page. They are allowed to load only inside the partner's registered web addresses (`frame-ancestors`), and refuse anything else.
- **AC-7033**: Inside the frame, a person can reach only the shared modules. A link to anything else (People, Settings, another workspace) isn't drawn, and the server refuses it for an embedded session.
- **AC-7034**: A partner guide is the hub developers' only source (owner, 6 Nov 2026: the client's developers build their side from it, without access to us). It covers:
  - the Integrate Timefix button and the connect flow;
  - storing the connection;
  - adding and removing members;
  - opening a screen with a launch and the frame;
  - every error code and what to do;
  - rate limits;
  - replacing the secret.

  Every step has a copyable request and a short Node example, and one complete sample hub page that works end to end.
- **AC-7035**: A test partner sandbox lets a partner's developers try every call before going live. Their test connections are marked as test, can be wiped in one go, and never count toward billing.

**Slice 5. Page only people** (owner, 9 Nov 2026: "admin to be able to make pages like timefix.com/nick, timefix.com/kate, without nick and kate signing up themselves". Built 9 and 10 Nov 2026, migrations 0196 and 0203.)

- **AC-7040**: Team pages has **Add a page** for anyone with `link_pages.manage_team` (Owner, Admin, a granted custom role, and inside a partner's frame the partner's admin). It asks for a name, an optional email and a handle. The handle is suggested from the name and checked as you type. A taken handle from the name quietly becomes a free one (`nick-2`). Only a handle typed by hand says Taken, and it offers the free one.
- **AC-7041**: Create makes a **page only person**: a Member with a managed identity (slice 3's), with no login, no invitation and no email from us. They take a seat, and their page starts Private at that handle. Their email, when given, sits on their member row only. An email an active member uses or an open invitation names is refused (409). Owners and admins are never made this way, and a page only person can never be made one later (a role change, a bulk role change or an ownership transfer answers 403).
- **AC-7042**: A partner's PUT, DELETE, list and launch never find a page only person, because those are keyed by partner and external id. An email a page only person uses is refused for the partner's people (409).
- **AC-7043**: Team pages' row menu has **Remove person** for page only people only, behind a confirm. It works like AC-7022: the handle stops, the content is kept 30 days, and their sessions end. Anyone else is `NOT_FOUND` there and leaves through Members.
- **AC-7044**: History says "Taylor added a page for Nick at /nick" and "Taylor removed Nick and their page from Team pages" (`member.added` with `pageOnly` and `handle`, `member.removed` with `pageOnly`).
- **AC-7045**: Members marks such people "Page only", and a partner's people "Via <app>". Guests see neither. People with no login show no two factor line.
- **AC-7046**: **Invite to manage their page** hands a page only person's page to a real login. Someone holding both `link_pages.manage_team` and `members.invite` sends an email invitation that names the person (`invitations.member_id`). Opening it with no session turns the person's own managed identity into a login at the invited address: the email is set and verified, and the `auth.managed_users` row goes. Signing in there by code, or by Google linking on the verified email, opens the same member, page, handle and History. Their `managed_members` row goes, so they are no longer a page only person.
  - Only a page only person holding plain Member with no custom role. Never a partner's person.
  - An address that already has a Timefix login is refused when the link is opened ("ask for the invitation to go to another address"), as AC-7021 never merges a managed person into another login.
  - The invitation lasts 7 days, is single use, holds no seat, and is bound to its workspace and its member (checked again under lock). The sender must still hold both permissions when it is opened. Removing the person cancels it.
  - It is not listed in Members › Invitations. Team pages shows "Invited" on the row, with Resend invitation and Revoke invitation, and "Invitation expired" once it runs out. Both items need `members.invite` and are not drawn without it, so never inside a partner's frame.
  - Resent to the same address, it is renewed in place. Sent to another address, the open one is revoked and a new one made (History shows both). Inviting the same address to join the workspace is refused while a hand over names it.
  - A taken link opened again shows "Your login is ready" with Sign in, the invited address filled in.
  - History: `invitation.created` and `invitation.resent` carry `page: true`; taking it over is `invitation.accepted` with `via: 'page'` ("set up a login and took over their link page").
- **AC-7047**: The page editor's Details card shows Name and Title for the page being edited. For a page only person both are editable through `teamPages.namePerson`, under `link_pages.manage_team`, with the same title rule as a person's own page (spec 0051 AC-5137). For anyone with a login they are read only, with "They change this in their own Profile."; for a partner's person while their app is connected, "The app that added them keeps this." (AC-7050 says who keeps them while it isn't). Admins never rename people who have accounts. A rename writes one `member.profile_updated` row with the manager as actor, and purges the page's edge cache after commit.
- **AC-7048**: A team page manager's editor draws the drafted photos of the page they edit (cover, ground and profile photo, spec 0068 AC-6802) through `GET /api/me/link-page/<cover|ground|avatar>?workspace=&member=&v=`, which enters someone else's page through the same check as editing it. The handle's own routes give a draft only to its owner.
- **AC-7049**: On someone else's page, the Social icons editor (spec 0061 AC-6104) shows that person's social links (10 Nov 2026). A manager with `link_pages.manage_team` changes them there through `teamPages.setSocials` only for an active managed person of this workspace (`managed_members.removed_at` and `claimed_at` null) whose identity is their member row's, and only where AC-7050 gives the set to Timefix. Never an owner or admin (`FORBIDDEN`); never anyone with a login, a guest or another workspace's person (`NOT_FOUND`). Both rows are locked, one `member.profile_updated` row (`socials`, the manager as actor) and a `members` outbox row are written, and the page's edge cache is cleared after commit.
  - `MyProfile.socialsByManager` (read for a team page manager only) says when the editor may change the set. Anyone with a login shows read only with "They change their social links in their own Profile." The Social icons tile is on when they have links, and off with that line when they have none.
  - A person's own page, in Timefix or in the frame, saves through `profile.update`.
- **AC-7050**: **The app that owns a person keeps their profile** (owner, 10 Nov 2026, as with directory synced accounts). For a connected app's person with no Timefix login (`partner_id` set, `claimed_at` null), what decides is whether their app has a live connection in the workspace. One read sits behind all of it: `liveConnectionOf` in `packages/core/src/profile/app-connection.ts`.
  - **While it is connected**, the app keeps their social links, name and title. Social links change only from inside that app's own frame (`context.embed.connectionId` equal to their `connection_id`). From Timefix, `teamPages.setSocials` answers `FORBIDDEN`: "{App} manages this person's social links." (or "The app that added them manages this person's social links." when the app's name can't be read). From another app's frame it is `NOT_FOUND`. Name and title are read only everywhere.
  - Timefix's editor shows "Managed by {app}." (or "Managed by the app that added them."), from `MyProfile.managedByApp: { name?: string }`, present on a team page manager's read only. The app's name comes from the global registry (`auth.partners.name`, through the identity store's `partnerById`), read by the api after the workspace transaction ends and passed into core as a resolver; no migration. Another app's frame never sees `managedByApp`, so no app name leaks across partners.
  - **While it is disconnected**, Timefix's team page managers keep their social links, name and title, from Timefix only (`managedBy: 'team'`, no "Managed by" line). Any frame of any app is `NOT_FOUND`.
  - **When the app connects again** (a new connection row), they are the app's again, as above.
  - Page only people (no partner) stay with Timefix's managers, from Timefix and from any frame. An app's person the workspace made owner or admin answers as an owner or admin: theirs to keep.

**Public pages**: link pages stay at `timefix.com/<handle>`, with "Powered by Timefix" in its usual place (AC-5601 to AC-5608 and 0051 unchanged).

## Decision

- **Connect is OAuth 2.0 with PKCE**, so a person in the workspace always approves it. Runner up: a partner key typed into Timefix by the owner. That's fewer screens, but it's copy and paste of secrets, and other partners will expect OAuth.
- **Launch is server to server, then a one time address.** No token from the partner ever sits in the browser. Runner up: a JWT the partner signs and passes into the frame's address. That's simpler for them, but a token in an address leaks through history and logs, and we'd hold their keys.
- **Embedded screens are our real screens without the frame**, so a partner gets every improvement for free. Runner up: a public API with the partner drawing its own screens. That's much more work for them and leaves them behind every release.
- **Managed members are separate people keyed by external id**, never merged by email. That's AC-7021: it is what stops account takeover.
- Partner secrets and connection tokens are stored only as hashes, using the existing key helpers (`keySecretMatches`, spec for API keys).
- **A page only person is a `managed_members` row with no partner** (9 Nov 2026). Runner up: a new table, or a `kind` column. Every slice 3 guarantee comes free (the session hook, the email skips, the console's counts, removal keeping the row), and partner isolation holds because every partner query filters on its own `partner_id`, which a null never matches.
- **The identity is made before the write**, as in slice 3, because only the identity login writes schema `auth`. Email, handle and seats are checked first. A race lost after that drops the identity again, best effort, and only a partnerless identity with no membership.
- **A hand over converts the managed identity** into a login (AC-7046) rather than moving the page to another login. Runner up: move the member to an existing login. The page lives under the identity's user id across about a dozen `auth` tables and stored file paths, and AC-7021 forbids the merge.
- **A hand over needs `members.invite` as well as `link_pages.manage_team`**, because it lets someone in with a login, and a custom role can hold manage_team alone.
- **A partner's person can get a Timefix login, started only from inside Timefix** (owner, 10 Nov 2026, AC-7023). Runner up: let the person or the app's admin start it from the frame. Refused, because the app controls who launches as whom, so it could mint Timefix logins at addresses it controls.
- **A claimed person stays the app's**: same identity, list, launch and PUT. Their address becomes their login's, their role can only be kept or lowered by the app, and the app's DELETE releases them instead of removing them. An account outlives the integration.
- **The app that owns a person keeps their profile while it is connected** (AC-7050). When it disconnects, Timefix's managers keep it; when it connects again, it goes back.
- **Implementation skills**: crm-data-model-access, crm-api-backend, crm-frontend-state, crm-design-system, security-and-hardening, better-auth-best-practices.

## Data

New tables, tenant scoped where they belong to a workspace, with forced row level security.

- `partners` (not tenant): name, logo, allowed frame origins, allowed redirect addresses, client id, secret hash, created and replaced dates.
- `partner_connections` (tenant): partner, workspace, approved by, modules, token hash, created, last call, disconnected.
- `managed_members` (tenant): connection, external id, member id; unique on connection and external id.
- `partner_launches`: one time code hash, connection, member, screen, expires; used once.
- Embedded sessions sit in the existing session table with a scope column (`embed`, connection id).
- Since 0196 (page only people): `managed_members.partner_id` and `connection_id` are nullable, and `created_by_member_id` names the maker. A check `managed_members_kind` allows two shapes only: a partner's person (partner, connection, no maker), or a page only person (no partner, no connection, a maker, and `external_id = id::text`). `auth.managed_users.partner_id` is nullable, with its unique index NULLS NOT DISTINCT (in the SQL only, since Drizzle can't say it). With no email given, the member row holds the identity's own `.invalid` address, so `members_email` stays unique and no screen shows it.
- Since 0206: `managed_members.claimed_at` and `auth.managed_users.claimed_at` mark a partner's person who set up a login (AC-7023). `crm_purge_managed_page` is made again to refuse a claimed person, with `crm_handle` given select on `managed_members.claimed_at`.
- Since 0203: `invitations.member_id` (an email invitation that hands over a page only person's page, plain Member with no custom role, one open per member), and the definer `crm_purge_managed_page` for the 30 day purge.

## Build plan

Tracer Bullet, each slice landing on its own:

1. **Slice 1**, team link pages and QR (AC-7001 to AC-7004): helps every Timefix workspace now.
2. **Slice 2**, partners and connect (AC-7010 to AC-7013): test with a small sample partner page in the repo's test tools, never shipped.
3. **Slice 3**, managed members (AC-7020 to AC-7025).
4. **Slice 4**, embedded screens, the guide and the sandbox (AC-7030 to AC-7035): checked in Chrome, Safari and Firefox inside a real frame on another origin.

5. **Slice 5**, page only people (AC-7040 to AC-7048): Add a page and Remove person (0196), Name and Title, the hand over and the 30 day purge (0203). Built and live 9 and 10 Nov 2026.

Slices 2 to 5 each get a `security-access-reviewer` pass before landing.

## Consequences

- Timefix gains its first outside callers that aren't a person. The partner API is a promise: once a partner builds on `/v1`, it can't change without a `/v2`.
- Safari and privacy browsers may refuse cookies in frames even when partitioned. The new tab fallback keeps it working, just less smoothly.
- People in a partner's workspace exist in Timefix without having signed up, so the operator console must show them as managed, and our counts of users must tell them apart.

## Follow-up

- Charging partners: per connection, per seat or per module, using `partner_connections`.
- More modules: booking pages, forms, menus.
- Webhooks to the partner (a page published, a booking made).
- A custom domain per partner, if a partner asks.
- Page only people, small leftovers (10 Nov 2026):
  - Inviting someone to join at the address a page only person holds is refused as "Already a member". The words could name the page only person and say to remove them first.
  - The team editor's profile read still answers the `.invalid` address for a page only person with no email. It isn't shown and isn't sensitive.
  - Removing a page only person from Members (`members.remove`) leaves `managed_members.removed_at` null. Harmless, since readers also need the member active, but inconsistent.
  - `teamPages.checkHandle` has no rate limit, like the public `readHandleOffer`.
  - The Members role picker still offers Owner and Admin for a page only person. The server refuses both; the picker could hide them.
  - Every new `teamPages.*` procedure is reachable from the partner's frame by default, since the embed allows the whole namespace. Each new one needs that thought through.
  - Screenshots of Team pages inside the sample hub (`tools/partner-sample`) were not taken.
  - The sign up allowlist (`crm_invitation_open_for`) still counts an open hand over as invited, so on a closed allowlist the invitee could sign up a separate account at that address first. The claim is then refused with a clear message. Excluding hand overs needs `crm_invitation_lookup` to read `member_id`.
  - The purge leaves the managed identity (`auth.user` and `auth.managed_users`) in place, inert. Deleting it needs the identity login, which the worker's jobs don't hold. A partner's later PUT with the same external id gets the same identity back with a fresh page.
  - Hosts with no blob store skip the purge; the people wait, as `link_images` does.
  - The team editor's top bar title ("Nick's page") shows the old name after a rename until the page is opened again.
- Partner logins and owned profiles, small leftovers (10 Nov 2026):
  - A manager can set up a login at any address, as a hand over can. The verified link is the only proof; the address isn't pinned to the one the app gave. No notice goes to the app's address when someone sets up a login for that person.
  - The connect page (AC-7012) could say that an admin can set up Timefix logins for people the app adds.
  - In the app (not the frame), Team pages' login dialog says "The app that added them" rather than the app's name, since the row doesn't carry it.
  - A person's own social links cross workspaces, but `profile.update` clears only this workspace's page from the edge cache. Their pages in other workspaces show the old set until their cache runs out.
  - The partner guide (`docs/partners/guide.md` 4.1) still says a PUT changes a claimed person's role, without the keep or lower rule.
- **Decided (owner, 10 Nov 2026)**, all built:
  - **A partner's person claiming a login**: yes, set up only from inside Timefix by an admin holding both permissions. They stay the app's, launch still works, and the app's DELETE releases them (AC-7023, AC-7024).
  - **When a title shows**: name and title are live at once everywhere (spec 0068 AC-6817).
  - **Where Name and Title sit**: first, in the editor's Profile card (spec 0068 AC-6818).
- **Open, not decided (owner)**:
  - **Should the app see the address a claimed person chose?** The partner's list and PUT answer the login's address (`members.email`) today.
  - **A claimed person's name.** The partner's next PUT overwrites the name they set in their own Profile, and Team pages still shows "The app that added them keeps this." for them, while their social links are theirs ("They change their social links in their own Profile."). Should their name and title be theirs too?
  - **A claimed guest.** The partner API sends only admin or member, both a raise over guest, so every PUT for a claimed guest is refused, even one that only changes the name. Keep refusing, or skip the role change and let the name through?

## Rationale

See [rationale.md](rationale.md).

Checks: [verify.md](verify.md).
