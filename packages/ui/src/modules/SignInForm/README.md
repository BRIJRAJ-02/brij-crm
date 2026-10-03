# SignInForm

The sign in form: an email field and "Continue", which sends a one time code, and "Continue with Google" when Google is on.

## Why it exists

New (spec 0005, pulled forward from spec 0003's milestone 4). Sign in (#10) is by a code sent to an email, or by Google, and screens are built from library parts only. It is presentational: props in, callbacks out. It builds on `Form` (Enter submits, the refusal on the field by name, the busy submit), `Field` and `Button`, and adds only the quiet closed sign up line. It sits inside `AuthLayout`, which brings the heading.

## Use

```tsx
<AuthLayout productName="CRM" title="Sign in">
  <SignInForm
    status={sending ? 'sending' : 'idle'}
    error={refusal}
    onContinue={sendCode}
    onGoogle={googleEnabled ? signInWithGoogle : undefined}
    isSignUpClosed={!signUpOpen}
  />
</AuthLayout>
```

- `onContinue(email)` gets the trimmed address. Before calling it, the form checks only that something like an address was typed ("Enter your email address.", "Enter an email address like name@company.com."); the server decides the rest.
- `error` is the server's refusal, as a sentence that says what to do. It shows on the email field until the address changes, and comes back with the next answer. It is hidden while `status` is `sending`.
- `onGoogle` shows "Continue with Google" (text only: the icon set has no brand marks). Leave it out when Google isn't set up.
- `status`: `sending` spins Continue as "Sending code" and turns Google off; `google` spins the Google button as "Opening Google" and turns Continue off.
- `isDisabled` turns the field and both buttons off; `disabledReason` says why, under the field.
- `isSignUpClosed` adds a quiet line saying sign up isn't open yet. An address the server refuses for it (`SIGNUP_CLOSED`) still comes back as `error`.
- `defaultEmail` starts the field with an address, coming back from "Use another email".

## States

Idle, sending, refused (the reason on the field), checked (nothing or no address typed), opening Google, without Google, sign up closed, disabled.

## Keyboard

Tab moves from the field to Continue, then Continue with Google. Enter in the field sends the code. A refusal moves focus to the field, or is announced if focus is there already.

## Differences from the artifact

Not in the artifact.
