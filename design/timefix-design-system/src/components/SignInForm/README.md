SignInForm is the way in, for signing in and signing up alike: Continue with Google, or an email that gets a 6-digit code.

**Use it for**: the sign in page, inside AuthLayout. **Don't use it for**: re-checking a signed in person (use a Dialog with CodeInput), or passwords and passkeys (not offered).

**The consumer provides**: `onSendCode(email)` and `onVerify(email, code)`, each resolving to `undefined` when it went through or a sentence that says what to do; `onGoogle` to show the Google button (leave it out when Google is off); `onSignedIn`; `notice` for a refusal about the sign in as a whole (a danger Callout at the top, never on the field); `resendAfter` seconds; `workspace` for the success line.

**States**: email (idle, sending, refused), code (typing, checking, wrong, resend waiting, resend ready), signed in.

**Interaction**: Enter sends the code. The three pages slide side by side (transitions.dev 08) with the box easing to each height (01). A refused address shakes the field (12) every time it is refused; a wrong code shakes the boxes, turns them red and empties them. "Resend code in 0:24" counts down in tabular figures, then becomes a button; its label crossfades to "New code sent" (04). Signed in draws a success check that fades, bobs up and draws its tick (10). "Use a different email" goes back with the address kept.

**Replaces**: SignInForm, VerifyEmail.
