# 0070 rationale

## Context

On 6 November 2026 the owner shared a client's request: their marketing hub should get a Timefix tab with an Integrate Timefix button, where the hub's admin picks modules (link pages first), and a super admin manages link pages and QR codes for everyone on the team. The owner asked for this to work for any outside dashboard "completely unaware of anything" about Timefix, with paid use later.

The owner's answers: the hub is a client's product; one workspace owner signs in, everyone else is created silently; pages stay on timefix.com; "Powered by Timefix" stays.

## Options considered

1. **Iframe with our own sign in.** Each person signs in to Timefix inside the hub. Refused: it breaks "created silently" and puts a second login inside someone else's product.
2. **Public API only.** The hub draws its own screens and calls ours. Refused for now: the hub would rebuild the link page editor and fall behind every release. It stays possible later, because the same partner API carries it.
3. **OAuth connect, managed members, embedded screens (chosen).** One approval by a real owner; people added by the partner's server; our real screens in the partner's frame through a one time launch.

## Rationale

- OAuth with PKCE is what partners expect, and it means a workspace is only ever shared by someone in it.
- Keying managed members by external id rather than email is the line that stops a partner from signing in as an existing Timefix user.
- A one time launch address keeps every long lived secret on servers.
- Building team link pages first gives every workspace something useful even if the partner work stalls, and it is the piece the hub's super admin needs most.

## Calls made while building slice 5 (9 and 10 Nov 2026)

- **Page only people reuse `managed_members` with no partner.** It brings every slice 3 guarantee for free, and a null partner never matches a partner's query.
- **A hand over converts the identity, it never moves the page.** The page is keyed by user id across many `auth` tables and file paths, and AC-7021 forbids merging.
- **A hand over needs `members.invite` too.** It lets a person in with a login, so it is an invitation in all but name.
- **The invitation lasts 7 days**, as every email invitation does.
- **Only plain Members are handed over.** A custom role brings questions nobody has answered yet. A partner's person gets a login through AC-7023 instead (10 Nov 2026).
- **The purge keeps the member row, named.** Nearly every actor column points at members, so deleting the row would break History.
- **A purged handle goes into the 90 day hold**, as late trap #73 settled: a freed name taken at once by someone else would open a stranger's page from old links and printed QR codes.
- **Admins never rename people who have a login.** Their name is theirs, set in their own Profile.

## Calls made on 10 Nov 2026 (partner logins and owned profiles)

- **A claim starts only inside Timefix.** The app controls who launches as whom, so a claim from the frame would let it mint a Member's login at any address it likes.
- **The address becomes the login's.** Once someone signs in with it, the app changing it would change how they sign in.
- **An account outlives the integration.** A person who chose a Timefix login keeps it when the app lets go of them; the workspace removes people, the app only stops managing them.
- **The app can take back whom it released, but not whom the workspace removed.** A routine sync must never undo the workspace's own choice.
- **The app can keep or lower a claimed person's role, never raise it.** That role now reaches all of Timefix, so only a workspace member may raise it. An unknown role fails closed.
- **The purge is guarded twice**, in the cleanup's selection and in the definer, because a wrongly purged login loses a real person's page.
- **The owning system controls a profile while it is live**, as with directory synced accounts. Two writers would overwrite each other. When the app disconnects, nobody else could change it, so it passes to Timefix's managers until the app comes back.

## References

- OAuth 2.0 authorization code with PKCE (RFC 7636).
- Cookies Having Independent Partitioned State (CHIPS), for the frame's session cookie.
- Specs 0047 (operator console), 0051 and 0056 (link pages), and the API keys work behind `enterWithKey`.
