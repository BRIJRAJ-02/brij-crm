CodeInput takes a one time code as six separate boxes: email verification, sign in and two factor setup.

**Use it for**: short numeric codes we send or an authenticator shows. **Don't use it for** passwords, IDs or anything longer than eight characters (use TextField).

**The consumer provides**: `label`, `length` (6), `value`/`onChange`, `onComplete` (called once the last digit lands), the check's outcome as `isPending`, `isInvalid` with an `errorMessage` that says what to do, or `isSuccess`; `description`, `isDisabled`, `autoFocus`, `size` (`md` 44px boxes in a dialog, `lg` 48 × 56 split three and three on a sign in page).

**States**: empty, focused (the next box turns white with an accent edge and a blinking caret), filling (each digit pops in), checking (spinner, boxes hold), wrong (red), right (green fill and a drawn check), disabled.

**Interaction**: it is one real input under the boxes (`autocomplete="one-time-code"`), so typing advances, Backspace goes back, and pasting a code, "481 593" or a whole sentence with the code in it fills every box at once; a phone's code suggestion does the same. A wrong code plays transitions.dev error state shake (280ms), then the boxes empty and focus returns to the first; the message stays until typing starts again. A right code plays the success check (500ms draw).

**Replaces**: CodeInput and the code input inside VerifyEmail.
