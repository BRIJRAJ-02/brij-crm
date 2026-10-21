# SignInForm

The way in, for signing in and signing up alike: "Continue with Google" first when Google is on, a quiet "or", then the email field and "Continue with email", which sends a one time code.

## Why it exists

New (spec 0005, pulled forward from spec 0003's milestone 4), reordered by spec 0036. Sign in (#10) is by a code sent to an email, or by Google, and the server decides whether that signs someone in or makes their account, so one form serves both. Screens are built from library parts only. It is presentational: props in, callbacks out. It builds on `Form` (Enter submits, the refusal on the field by name, the busy submit), `Field`, `Button`, `Separator` (its `label` variant, "or") and `Callout` (the notice), and adds only the order and the quiet closed sign up line. It sits inside `AuthLayout`, which brings the heading.

## Use

```tsx
<AuthLayout productName="Timefix" title="Sign in or sign up">
  <SignInForm
    status={sending ? 'sending' : 'idle'}
    error={refusal}
    notice={signInRefusal}
    onContinue={sendCode}
    onGoogle={googleEnabled ? signInWithGoogle : undefined}
  />
</AuthLayout>
```

- The order is fixed: the notice, "Continue with Google" (Google's own G through `provider="google"`, drawn by ProviderMark; the owner's brand exception to Lucide), "or" between two hairlines, the Email field ("name@company.com" as its placeholder), anything in `afterEmail`, then the submit. Why Google first: one press signs most people in, and the email is the way for everyone else (spec 0036, the coordinator's recommendation after Attio's and Linear's sign in pages).
- `onGoogle` shows the Google button and the "or" under it; leave it out when Google isn't set up, and the submit reads "Continue" alone. With Google it reads "Continue with email", so the two ways read as a pair.
- `onContinue(email)` gets the trimmed address. Before calling it, the form checks only that something like an address was typed ("Enter your email address.", "Enter an email address like name@company.com."); the server decides the rest, including whether this is a sign in or a sign up.
- `error` is the server's refusal of the address, as a sentence that says what to do. It shows on the email field until the address changes, and comes back with the next answer. It is hidden while `status` is `sending`.
- `notice` is a refusal about the sign in as a whole, not the address: sign up closed for that email, too many codes, a refused Google sign in, a session that ended under the person. It shows at the top as a danger Callout (announced as an alert) and never marks the email field invalid. Why apart from `error`: a cancelled Google sign in said on the email field read as if the address were wrong. It steps aside once the person submits, even an address that isn't one, so it isn't announced again beside the field's refusal; the screen clears it when the next attempt starts, and a notice cleared and set again shows again.
- `status`: `sending` spins the email's submit as "Sending code" and turns Google off; `google` spins the Google button as "Opening Google" and turns the email's submit off.
- `afterEmail` is the room under the email field for another way in that belongs with the email: spec 0033's "Sign in with a passkey" (a ghost Button with the key icon, filled by the sign in screen where the browser has passkeys).
- `status="passkey"` turns Continue with Google and the email's submit off while the browser's passkey prompt is open; the screen's own passkey button in `afterEmail` shows the wait.
- `isPasskeyAutofill` adds `webauthn` to the email field's autocomplete, so the browser offers saved passkeys in the field's suggestions (spec 0033, AC-888). The screen sets it while it waits for one to be picked.
- `isDisabled` turns the field and both buttons off; `disabledReason` says why, under the field, and describes both buttons (their `aria-describedby`), so a screen reader hears why each is off.
- `isSignUpClosed` adds a quiet line under the form saying sign up isn't open yet. An address the server refuses for it (`SIGNUP_CLOSED`) still comes back, as a `notice`.
- `defaultEmail` starts the field with an address, coming back from "Use a different email".

## States

Idle, sending, refused (the reason on the field), a notice (at the top), checked (nothing or no address typed), opening Google, without Google, sign up closed, disabled.

## Keyboard

The screen puts focus in the email field. Tab follows the page: Continue with Google, the email field, anything in `afterEmail`, then the submit. Enter in the field sends the code. A refusal moves focus to the field, or is announced if focus is there already.

## Differences from the artifact

Not in the artifact.
