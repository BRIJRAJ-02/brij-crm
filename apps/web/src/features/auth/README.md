# Sign in

Spec 0005, milestone 1, redesigned by spec 0036. Sign in, the code page and the second step sit in `AuthLayout`'s split card beside the empty sketch (`signInFrame`), so the card holds still from the first page to first run (design sweep, 22 October 2026: the second step was the narrow card, and the card jumped); everything they send goes through `data.auth`.

## `/sign-in` (SignInScreen)

- **Purpose**: one way in for everyone, new or returning: Google (where the API says it is on), a code sent to an email, or a passkey alone (spec 0033, AC-888). The server decides whether it signs in or signs up.
- **Main task**: Continue with Google; or type an email and press Continue with email, and the code goes out and the page moves to `/verify`; or "Sign in with a passkey" (SignInForm's `otherWays`, under Continue with Google and above the "or", shown where the browser has passkeys, so the email field and Continue with email stay together), or pick a passkey from the email field's suggestions (`isPasskeyAutofill`: that prompt waits from the page's start and stops when the page goes). A passkey signs in at once and goes on to `?redirect=`; closing its prompt does nothing.
- **Leaves out**: passwords, a separate sign up page, account settings.

## `/verify` (VerifyScreen)

- **Purpose**: prove the email is yours with the 6 digit code sent to it.
- **Main task**: type or paste the code (checked as soon as it is complete), then go on to `?redirect=` or `/`.
- **Leaves out**: editing the address here ("Use a different email" goes back, in one click) and other sign in methods. Spec 0033's second step gets its own page at `/sign-in/two-factor`.

## Notes

- `?redirect=` is honoured only for a path in the app (`safeRedirect`: resolved against the app's origin, it must stay on it, its path can't start with `//`, and it can't be a sign in page, compared lowercase after undoing escapes).
- A refused send that is about the address (not an email) marks the email field; any other (sign up closed, too many codes, the server down) is about signing in and shows at the top of the card, never as a red field (`isAboutAddress`).
- `?error=` on `/sign-in` is a refused Google sign in; the form says it in the page's words (`googleRefusal`), never the code itself. `?signedOut=ended` or `unsaved` is a session that ended under the person (a 401 mid use, from the data layer's `onSignedOut`); the form says so above the fields, `unsaved` adding that the last change wasn't saved. Both leave the address once read, so a reload doesn't say them again. A failure that isn't one of ours reads "Something went wrong", never the thrown value.
- The address the code went to and when are kept in this tab's sessionStorage (`pending.ts`), so `/verify` survives a reload; verifying or "Use a different email" clears them. "Use a different email" keeps the address alone, so `/sign-in` starts with it (cleared once a sign in succeeds).
- The resend wait is counted here (`useSecondsLeft`) and passed to VerifyEmail as `resendWait`: 60 seconds after each send, or the server's `Retry-After` after a refused one (`DataError.retryAfterSeconds`). A refused resend shows under "Resend code" (`resendError`), never on the code boxes, and never says "New code sent". A rate limited resend says only "Too many codes sent to this email." (`resendRefusal`): the wait line under the button counts the time, so it isn't said twice.
- Refusals are worded in `messages.ts`: a rate limit gives the real wait ("Try again in 10 minutes."), a closed sign up says so plainly, a wrong code doesn't offer a new one while none can be sent, and a code tried too often, expired or rate limited is spent (the boxes turn off until a new code is sent).
- Back from Google with the browser's back button, "Opening Google" resets (`pageshow`).
- `AuthStates.tsx` holds the loading and failed states the pages before the app share; `AuthPending` and `AuthError` take `isSplit` for the split card, with an empty sketch beside it, and every route before the app passes it (sign in, verify, the second step, first run, join, invite and `/`). `AuthError` keeps the page's title and says why in one announced danger Callout (the server's sentence, else "Can’t reach Timefix. Check your connection, then try again."), then a full width Try again that runs the route again: no second heading under the title. `/` loads as "Opening Timefix", true whether it then opens a workspace or sign in.
- `SignOutDialog.tsx` is the confirm the pages before the app ask with before signing out (the owner's rule of 21 October 2026): a plain Modal, "Sign out?", "You’ll need to sign in again on this device.", Cancel (ESC) first and a primary Sign out last that spins while it runs and runs once; a failure shows inside it. First run uses it; it matches the workspace menu's (spec 0031).

## Second step (`/two-factor`, TwoFactorScreen)

- **Purpose**: a sign in held back because two factor is on (spec 0033, AC-882, AC-884): an email code or Google proved the email, not yet the person.
- **Main task**: type the authenticator app's 6 digit code (it sends itself once complete) or, after "Use a backup code", one of the backup codes, or "Use a passkey" (both full width ghost buttons under Continue, as a Form's other ways to go on are; a passkey only account's Continue with your passkey is full width too) (where the browser has passkeys: it signs in on its own); "Remember this device for 30 days" sits above the code so it is never skipped. A wrong code says so under the field and focus returns to it; a run out or over tried sign in says the server's sentence with Sign in again.
- **Leaves out**: any way round the second factor (no email recovery, owner decision).

The pending sign in lives in Better Auth's HttpOnly cookie, so the page can't tell a stale one: the server says so. VerifyScreen goes here when `auth.verify` answers `second-step`; Google's callback redirects here.
