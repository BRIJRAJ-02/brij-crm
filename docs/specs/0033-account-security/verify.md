# 0033. Account security: verification

Filled in by the account lane on 22 October 2026 at the end of milestone 4, from the code and its tests. /architect owns the spec; this file records how it was checked.

## Milestone 2 spike (AC-882)

Better Auth's `twoFactor` plugin holds a session back only on its own credential sign in. The email code (`/sign-in/email-otp`) and Google callback routes need our own after hook (`crm-two-factor-hold` in `apps/api/src/auth/auth.ts`), which also holds back an account whose only second factor is a passkey (milestone 4).

## Deviations from the spec, recorded

- Step up by passkey uses its own procedures (`account.stepUp.passkeyOptions`, `.verifyPasskey`) rather than a `method` on `start` and `verify`.
- `access.mine` does not answer `twoFactorRequired`: the door's refusal codes (`TWO_FACTOR_REQUIRED`, `SIGN_IN_AGAIN`) reach the workspace frame, which shows the held back page.
- Workspace › Security also holds a session length and "Sign out everyone" (the coordinator's milestone 4 brief). Both work through `workspace_security.sessions_valid_after` and `session_length_days`, compared in the door with the session's `verified_at`, so confirming it's you (a step up) counts as signing in again, and the person's other workspaces are untouched.
- 0080 keeps every live session's device as known (the same key, SHA-256 of label and country), so a deploy sends no alerts for devices in use while a new device still alerts; only an account with no device kept (no live session then) has its next sign in noted quietly.
- The sign in alert is sent by the API right after the sign in's request answers, not by a worker job: the worker holds no identity login, and schema `auth` is closed to every role but `crm_identity` (0016's check). It is once per session (the mailer's idempotency key `sign-in-alert/<session id>`), never in the sign in's way, and skips a session already gone (one held back for its second step). The yearly delete runs the same way, at most once a day per API process, after a sign in.
- The alert names no link, only where to go (Settings › Account › Security), per the owner's "no action link".

## OWASP ASVS 4.0.3, level 2: V2 Authentication and V3 Session management

| Requirement | Status | Where |
|---|---|---|
| V2.1 passwords | Not applicable | No passwords: email code, Google, passkeys |
| V2.2.1 anti automation | Met | Code sends and checks capped per IP and per email (`auth.ts` rate rules, `consumeRateLimit`); second step 5 a pending sign in, 15 an hour per account, then locked 15 minutes |
| V2.2.2 weak authenticators | Met | An email code alone never removes or bypasses a second factor (AC-885); with an app or a passkey, every step up needs a second factor (`hasSecondFactor`) |
| V2.2.3 notification of changes | Met | Security events for every factor change; new device alert email (AC-897) |
| V2.2.4 / 2.2.5 phishing resistance | Partly | Passkeys are origin bound (`rpID` from `APP_URL`, AC-889); TOTP is not |
| V2.5.1 to 2.5.4 recovery | Met | No email recovery of a second factor (owner decision); backup codes shown once, single use, encrypted |
| V2.5.6 secrets on reset | Met | New backup codes replace all old ones and need a second factor's step up |
| V2.7 out of band | Met | Email codes 6 digits, 10 minutes, hashed at rest, attempt capped |
| V2.8.1 to 2.8.4 TOTP | Met | Better Auth TOTP, secret encrypted with `BETTER_AUTH_SECRET`, used codes and lockout per account |
| V2.8.6 revocation | Met | Turning off forgets remembered devices; passkeys removable after a step up |
| V2.9 cryptographic verifiers | Met | WebAuthn with user verification required (`userVerification: required`, UV flag checked) |
| V3.1.1 no tokens in URLs | Met | Session ids only leave the server (`account.sessions.list`), tokens stripped from bodies (AC-891) |
| V3.2.1 new token on sign in | Met | Better Auth makes a new session per sign in; a two factor change renews in place |
| V3.2.2 / 3.2.3 token entropy and storage | Met | Better Auth tokens in HttpOnly, Secure, SameSite=Lax host only cookies |
| V3.3.1 logout invalidates | Met | Sign out deletes the session; the cookie cache is off, so a revoke takes effect on the next request |
| V3.3.2 re-authentication period | Met | 30 day sessions, refreshed daily; a workspace may set 1 to 30 days (`session_length_days`) |
| V3.3.3 terminate other sessions | Met | "Sign out of all other devices" (AC-892) and the workspace's "Sign out everyone" |
| V3.3.4 view and end sessions | Met | Account › Security › Devices (AC-890) |
| V3.4 cookie attributes | Met | `defaultCookieAttributes` HttpOnly, SameSite=Lax; secure cookies outside local |
| V3.5 token based sessions | Not applicable | Cookie sessions only; Centrifugo tokens are short lived and signed per user |
| V3.7.1 re-authentication before sensitive changes | Met | Step up within 10 minutes on this session (AC-896), by a second factor when the account has one |

## Tests that prove the acceptance criteria

- AC-881 to AC-886, AC-896: `apps/api/src/modules/two-factor.test.ts`, `packages/core/src/account/step-up.test.ts`
- AC-887 to AC-889: `apps/api/src/modules/passkeys.test.ts`
- AC-890 to AC-892: `apps/api/src/modules/account.test.ts`
- AC-893 to AC-895, AC-899, AC-885 (workspace), AC-888 (passkey only second step and step up): `apps/api/src/modules/workspace-security.test.ts`
- AC-897, AC-898: `apps/api/src/modules/sign-in-alerts.test.ts`
- AC-900: `apps/api/src/app.test.ts` (the pinned `AUTH_ROUTES`)
- AC-902 to AC-907, join requests: `apps/api/src/modules/account-deletion.test.ts`
- Tenancy: `packages/db/src/guards.test.ts` (forced row level security on `workspace_security`, the definer list)

Not yet run: `/check verify` against the deployed app, and the Playwright passkey flow with a virtual authenticator.
