# VerifyEmail

The step after sign in: where the code went, the six digit code, "Send a new code" with its wait, and "Use another email".

## Why it exists

New (spec 0005, pulled forward from spec 0003's milestone 4). Sign in by code (#10) needs a page to type the code, and screens are built from library parts only. It is presentational: props in, callbacks out. It builds on `CodeInput` (one real field, so a paste or the phone's suggestion fills every box), `Button`, `Callout` (a refused resend), `Spinner` and `VisuallyHidden`, and sits inside `AuthLayout`, which brings the heading.

## Use

```tsx
<AuthLayout productName="CRM" title="Check your email">
  <VerifyEmail
    email={pendingEmail}
    onVerify={verify}
    isVerifying={verifying}
    error={refusal}
    isCodeSpent={tooManyTries}
    onResend={resend}
    resendWait={secondsLeft}
    isResending={resending}
    resendError={resendRefusal}
    onUseAnotherEmail={backToSignIn}
    isDisabled={paused}
    disabledReason="Signing in is paused for a few minutes. Try again soon."
  />
</AuthLayout>
```

- `onVerify(code)` runs as soon as the sixth digit is in, and not again while `isVerifying`.
- `error` says what went wrong (a wrong or expired code) and what to do. Each answer with a refusal clears the boxes for the next code, keeps focus there and is announced; typing again hides it.
- `isCodeSpent` turns the boxes off when the code can't be used any more (tried too often, or expired), until a new code is sent; `error` says why, and focus moves to "Send a new code" once it is ready (only if focus was in the boxes).
- `resendWait` is the seconds until a new code can be sent. The screen counts it down (60 after each send, or the server's `Retry-After` after a refused one) and passes it in; the component runs no timers. Above zero, "Send a new code" is off and "You can send another in 42 seconds." shows under it (whole minutes past a minute, "10 minutes", and whole hours past 90 minutes, always rounded up), as plain text a screen reader reads in place (it is not a live region, so it doesn't speak every second). The line describes the button (`aria-describedby`), so the two are read together.
- `isResending` spins "Send a new code" as "Sending a new code". When it turns false again, the new code is out: the boxes and any old refusal clear, focus moves from the button to the boxes (once per new code, and not while `isDisabled`; turning it off and on again never moves focus), and "New code sent" is announced and leads the wait line ("New code sent. You can send another in 60 seconds."). Typing hides it.
- `resendError` is why a resend failed (sent too often, offline). Pass it in the same answer that turns `isResending` false: then nothing clears, focus stays, "New code sent" is never said, and the reason shows under the buttons as a danger `Callout`, announced. It never goes on the boxes, which belong to the code. Clear it when the next resend starts.
- `isDisabled` turns the boxes and both buttons off; `disabledReason` says why in a line under the boxes, which also describes both buttons.
- The line over the boxes is one sentence in `strings.ts` (`sentTo`), which returns the words before the address, the address and the words after it, so a translation can put the address anywhere; the address shows in bold.

## States

Idle, verifying (a spinner and "Checking the code", announced), refused (the reason under the empty boxes, announced), code spent (the boxes off, focus on Send a new code), resend waiting (the button off, the wait written under it and describing it), resending, resent (focus back on the empty boxes, "New code sent" announced and in the wait line), resend refused (the reason under the buttons, announced), disabled (everything off, the reason under the boxes).

## Keyboard

The code field is first: type or paste the code, Backspace deletes the last digit. Tab moves on to Send a new code (skipped while it waits) and Use another email.

## Differences from the artifact

Not in the artifact.
