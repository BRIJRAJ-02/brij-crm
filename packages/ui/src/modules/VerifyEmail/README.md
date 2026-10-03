# VerifyEmail

The step after sign in: where the code went, the six digit code, "Send a new code" with its wait, and "Use another email".

## Why it exists

New (spec 0005, pulled forward from spec 0003's milestone 4). Sign in by code (#10) needs a page to type the code, and screens are built from library parts only. It is presentational: props in, callbacks out. It builds on `CodeInput` (one real field, so a paste or the phone's suggestion fills every box), `Button`, `Spinner` and `VisuallyHidden`, and sits inside `AuthLayout`, which brings the heading.

## Use

```tsx
<AuthLayout productName="CRM" title="Check your email">
  <VerifyEmail
    email={pendingEmail}
    onVerify={verify}
    isVerifying={verifying}
    error={refusal}
    onResend={resend}
    resendWait={secondsLeft}
    isResending={resending}
    onUseAnotherEmail={backToSignIn}
    isDisabled={paused}
    disabledReason="Signing in is paused for a few minutes. Try again soon."
  />
</AuthLayout>
```

- `onVerify(code)` runs as soon as the sixth digit is in, and not again while `isVerifying`.
- `error` says what went wrong (a wrong or expired code) and what to do. Each answer with a refusal clears the boxes for the next code, keeps focus there and is announced; typing again hides it.
- `resendWait` is the seconds until a new code can be sent. The screen counts it down (60 after each send) and passes it in; the component runs no timers. Above zero, "Send a new code" is off and "You can send another in 42 seconds." shows under it, as plain text a screen reader reads in place (it is not a live region, so it doesn't speak every second). The line describes the button (`aria-describedby`), so the two are read together.
- `isResending` spins "Send a new code" as "Sending a new code". When it turns false again, the new code is out: the boxes and any old refusal clear, focus moves from the button to the boxes (once per new code, and not while `isDisabled`; turning it off and on again never moves focus), and "New code sent" is announced. Typing hides it. If the send failed, pass the refusal as `error` in the same answer and it is shown instead.
- `isDisabled` turns the boxes and both buttons off; `disabledReason` says why in a line under the boxes, which also describes both buttons.
- The line over the boxes is one sentence in `strings.ts` (`sentTo`), which returns the words before the address, the address and the words after it, so a translation can put the address anywhere; the address shows in bold.

## States

Idle, verifying (a spinner and "Checking the code", announced), refused (the reason under the empty boxes, announced), resend waiting (the button off, the wait written under it and describing it), resending, resent (focus back on the empty boxes, "New code sent" announced), disabled (everything off, the reason under the boxes).

## Keyboard

The code field is first: type or paste the code, Backspace deletes the last digit. Tab moves on to Send a new code (skipped while it waits) and Use another email.

## Differences from the artifact

Not in the artifact.
