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

- `?redirect=` is honoured only for a path in the app (`safeRedirect`: one leading `/`, never `//` or a sign in page).
- The address the code went to and when are kept in this tab's sessionStorage (`pending.ts`), so `/verify` survives a reload; verifying or "Use another email" clears them.
- The 60 second resend wait is counted here (`useSecondsLeft`) and passed to VerifyEmail as `resendWait`.
- `AuthStates.tsx` holds the loading and failed states the pages before the app share.
