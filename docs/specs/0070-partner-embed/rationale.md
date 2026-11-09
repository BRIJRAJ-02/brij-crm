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

## References

- OAuth 2.0 authorization code with PKCE (RFC 7636).
- Cookies Having Independent Partitioned State (CHIPS), for the frame's session cookie.
- Specs 0047 (operator console), 0051 and 0056 (link pages), and the API keys work behind `enterWithKey`.
