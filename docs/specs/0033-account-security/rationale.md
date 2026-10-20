# 0033. Account security: rationale

## Context

Sign in is password less: a 6 digit code by email, or Google, through Better Auth in one wrapper (`apps/api/src/auth/auth.ts`) that serves only six reviewed routes. That makes the email inbox the single key to every account. Anyone who reads a person's email, or holds a Google session on a shared computer, is in. Sessions last 30 days, refreshed daily, with no way for a person to see or end them except signing out on the device itself.

The scope's bar for #25: two factor sign in, a list of active sessions with sign out of any or all, a workspace wide requirement set by an owner, and an email on a sign in from a new device. It is tagged GA, so it needs to hold up to a security review.

Forces: keep sign in password less (no passwords will be added); keep the reviewed route surface small, because every Better Auth route opened is a route to review on each upgrade; never let the first factor (email) also reset the second; and keep the per request cost of the workspace requirement inside the door's existing query.

## Options considered

### Option 1: Better Auth plugins, our own session procedures, the door enforces the requirement (recommended)

The installed `twoFactor` plugin (it has an `allowPasswordless` mode in 1.7.7) for TOTP and backup codes, `@better-auth/passkey` for passkeys; session listing and revoking as our own oRPC procedures over the identity store; the requirement checked in `enterWorkspace`.

**Pros**: encrypted secrets, TOTP windows, backup codes and WebAuthn ceremonies come from a maintained library; session ids instead of tokens on the wire; the requirement is one more column in a query the door already makes.
**Cons**: four plugin routes join the reviewed set; the plugin's sign in hook may not cover the email code and Google routes and may need our own hook (milestone 2 checks).

### Option 2: our own TOTP and WebAuthn with small libraries

`otpauth` and `@simplewebauthn/server` directly, with our own tables and routes.

**Pros**: full control, no plugin routes.
**Cons**: we own the crypto details (secret encryption, replay windows, counter checks) that the library already gets right, and two auth systems end up sharing one session table.

### Option 3: rely on the identity provider (Google only, with its two step check)

Drop email codes for workspaces that require it and lean on Google's account security.

**Pros**: no factor storage at all.
**Cons**: excludes everyone without Google, and gives owners no control or visibility.

### Session list options

Better Auth's `list-sessions` answers session tokens to the browser, which turns any script running in the page into a way to steal every session. Our own procedure answers ids only, at the cost of a few lines in the identity store.

## Rationale

Option 1 keeps the trusted library for the parts that are easy to get wrong and our own code for the parts that touch tenancy (the door) and data exposure (sessions). Applying the second step after Google too keeps the setting honest: an account "with two factor" is protected however someone signs in. Refusing email based recovery follows from the first factor being email; anything else makes two factor decorative. A passkey alone counts because it binds possession to user verification on the device, which is stronger than email plus a code. The requirement applies at once because a grace period is exactly the window it exists to close, and the setup page makes it a one minute fix rather than a lockout.

**Owner decision runners up, in short**: TOTP only (less to build, but passkeys are the best second step for most people); trust Google (smoother, but the setting would mean two things); passkey only as a second step (stricter, slower); never remember devices (safer, more friction daily); Better Auth's session routes (less code, tokens in the browser); alerts on every sign in (noisy, so ignored) or one click revoke links (a link that changes security state is a phishing target); a grace period or admin control (softer rollout, weaker guarantee); email recovery after a wait (self service, but email is the first factor); IP addresses (precise, meaningless to most people and personal data to store); SSO now (enterprise value, large surface before the first enterprise customer).

## References

**Project sources**:
- `apps/api/src/auth/auth.ts` (the wrapper, `AUTH_ROUTES`, rate limits), `packages/db/src/schema/auth.ts`.
- Spec 0005 (sign in), spec 0009 (the door and catalog), spec 0031 (`audit_events`), spec 0026 (settings area).
- Installed `better-auth` 1.7.7: `plugins/two-factor` with `allowPasswordless`, `trustDevice`, `backupCodeOptions`; no passkey plugin installed yet.

**Practices and standards**:
- OWASP ASVS 4 V2 (authentication) and V3 (session management); NIST SP 800-63B (authenticator assurance: TOTP and passkeys as possession factors, rate limiting of guesses).
- WebAuthn: relying party id bound to the origin.

**Links** (screens seen through Mobbin while writing this):
- Notion account security with two step verification, passkeys and devices list: https://mobbin.com/screens/a18501a9-c8e0-499c-95ac-4dccbf365163
- Notion devices with per device log out: https://mobbin.com/screens/5e480b9a-b81b-45a5-be7e-749c5aaf929e
- Linear workspace Security (authentication methods, SAML later): https://mobbin.com/screens/ad90d0fb-7dbf-4978-8364-13468223ec00
- Vercel members with a 2FA status column and filter: https://mobbin.com/screens/053a9399-ee8c-4cda-962d-9b0e8c679897
