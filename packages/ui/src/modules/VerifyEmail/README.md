# VerifyEmail

The step after sign in: where the code went, the six digit code in large boxes, "Resend code" with its wait, and "Use a different email".

## Why it exists

New (spec 0005, pulled forward from spec 0003's milestone 4), restyled by spec 0036. Sign in by code (#10) needs a page to type the code, and screens are built from library parts only. It is presentational: props in, callbacks out. It builds on `CodeInput` (one real field, so a paste or the phone's suggestion fills every box; its `lg` boxes, with the label for screen readers only, since the line above says what they are for), `Button`, `Callout` (a refused resend), `Spinner` and `VisuallyHidden`, and sits inside `AuthLayout`, which brings the heading.

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
- `isCodeSpent` turns the boxes off when the code can't be used any more (tried too often, or expired), until a new code is sent; `error` says why. While the resend wait runs, focus moves to that message (focusable from code only), so it isn't lost with the boxes and a screen reader reads why; once "Resend code" is ready, focus moves there. Either move happens only when focus was in the boxes, lost with them, or on that message.
- `resendWait` is the seconds until a new code can be sent. The screen counts it down (60 after each send, or the server's `Retry-After` after a refused one) and passes it in; the component runs no timers. Above zero, "Resend code" is off and "You can resend the code in 42 seconds." shows under it (whole minutes past a minute, "10 minutes", and whole hours past 90 minutes, always rounded up), as plain text a screen reader reads in place (it is not a live region, so it doesn't speak every second). The line describes the button (`aria-describedby`), so the two are read together.
- `isResending` spins "Resend code" as "Resending code". When it turns false again, the new code is out: the boxes and any old refusal clear, focus moves from the button to the boxes (once per new code, and not while `isDisabled`; turning it off and on again never moves focus), and "New code sent" is announced and leads the wait line ("New code sent. You can resend it in 60 seconds."). Typing hides it.
- `resendError` is why a resend failed (sent too often, offline). Pass it in the same answer that turns `isResending` false: then nothing clears, focus stays, "New code sent" is never said, and the reason shows under the buttons as a danger `Callout`, announced. It never goes on the boxes, which belong to the code. Clear it when the next resend starts.
- `isDisabled` turns the boxes and both buttons off; `disabledReason` says why in a line under the boxes, which also describes both buttons.
- The lines over the boxes come from `strings.ts` (`sentTo`), which returns the words before the address, the address and the words after it, so a translation can put the address anywhere. The address shows in the strong weight on a line of its own, wrapping only where it has to, so a long address never splits partway along the sentence (at its hyphen, say).

## States

Idle, verifying (a spinner and "Checking the code", announced), refused (the reason under the empty boxes, announced), code spent (the boxes off, focus on the message while the wait runs, then on Resend code), resend waiting (the button off, the wait written under it and describing it), resending, resent (focus back on the empty boxes, "New code sent" announced and in the wait line), resend refused (the reason under the buttons, announced), disabled (everything off, the reason under the boxes).

## Keyboard

The code field is first: type or paste the code, Backspace deletes the last digit. Tab moves on to Resend code (skipped while it waits) and Use a different email.

## Differences from the artifact

Not in the artifact.
