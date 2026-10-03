# Sign in

Spec 0005, milestone 1. Both pages sit in `AuthLayout`; everything they send goes through `data.auth`.

## `/sign-in` (SignInScreen)

- **Purpose**: the way in, by a code sent to an email (or Google, where the API says it is on).
- **Main task**: type an email and press Continue; the code goes out and the page moves to `/verify`.
- **Leaves out**: passwords, a separate sign up step, account settings.

## `/verify` (VerifyScreen)

- **Purpose**: prove the email is yours with the 6 digit code sent to it.
- **Main task**: type the code (checked as soon as it is complete), then go on to `?redirect=` or `/`.
- **Leaves out**: editing the address here ("Use another email" goes back) and other sign in methods.

## Notes

- `?redirect=` is honoured only for a path in the app (`safeRedirect`: resolved against the app's origin, it must stay on it, its path can't start with `//`, and it can't be a sign in page, compared lowercase after undoing escapes).
- `?error=` on `/sign-in` is a refused Google sign in; the form says it in the page's words (`googleRefusal`), never the code itself.
- The address the code went to and when are kept in this tab's sessionStorage (`pending.ts`), so `/verify` survives a reload; verifying or "Use another email" clears them. "Use another email" keeps the address alone, so `/sign-in` starts with it (cleared once a sign in succeeds).
- The resend wait is counted here (`useSecondsLeft`) and passed to VerifyEmail as `resendWait`: 60 seconds after each send, or the server's `Retry-After` after a refused one (`DataError.retryAfterSeconds`). A refused resend shows under its button (`resendError`), never on the code boxes, and never says "New code sent". A rate limited resend says only "Too many codes sent to this email." (`resendRefusal`): the wait line under the button counts the time, so it isn't said twice.
- Refusals are worded in `messages.ts`: a rate limit gives the real wait ("Try again in 10 minutes."), a closed sign up says so plainly, a wrong code doesn't offer a new one while none can be sent, and a code tried too often, expired or rate limited is spent (the boxes turn off until a new code is sent).
- Back from Google with the browser's back button, "Opening Google" resets (`pageshow`).
- `AuthStates.tsx` holds the loading and failed states the pages before the app share.
