# CodeInput

A one time code as separate boxes.

## Why it exists

New. Two factor setup and sign in (#25) ask for a 6 digit code. It is one real field underneath, with `autocomplete="one-time-code"` and a numeric keyboard, so pasting or the phone's code suggestion fills every box at once, and screen readers hear one field.

It is never a login, so its input carries the password managers' opt outs (`data-1p-ignore`, `data-lpignore`, `data-bwignore`, `data-form-type="other"`, as Field's `autoComplete="off"` does), and for a manager that ignores them (the owner saw NordPass's badge over the fourth box, 6 November 2026) the input runs past the last box, clipped, since a manager draws its badge inside the input's end. `isLabelHidden` with `size="lg"` is the shape wherever a sentence above says what the code is: the sign in page's second step, and every step up (Settings' `useStepUp`).

## Use

```tsx
<CodeInput label="Code from your authenticator app" value={code} onChange={setCode} onComplete={verify} />
```

- It keeps digits only, up to `length` (6). A pasted code with a space or a dash in it ("481 593") fills every box: the input sets no `maxLength`, which would cut a paste before the separator is dropped.
- `size="lg"` makes the boxes share the row and stand `size-input` plus `space-16` tall, split three and three, on a page whose task is the code (sign in, spec 0036). Why a variant: the same field, boxes and states; only their size and the split differ, and 30px boxes read small as a page's one task.
- `isLabelHidden` keeps the label for screen readers only (as Field's does), when a sentence above the boxes already says what they are for ("Enter the code we sent to …").
- `onComplete` runs once the boxes fill with the code itself: typed, or filled in with its spaces or dashes. A key pressed in full boxes, or stray digits around a code, send nothing, so a guess never uses up one of the code's tries, and a code is never sent twice. `error` says what to do ("That code has expired. Enter the new one from your app.").
- A paste is a whole code: it replaces what the boxes hold. A pasted sentence with one code in it ("Your sign in code is 481593.") gives the code alone; anything else pastes as usual and sends nothing.
- Focus is tracked on the one real input (`data-focused` on the row of boxes): React Aria's TextField sets no focus state on its root, so the old `data-focus-within` cue never showed.
- `ref` reaches the one real input under the boxes, so a module can move focus to it, as VerifyEmail does once a new code is sent.
- `errorRef` makes the error's sentence focusable from code only (`tabIndex={-1}`, with the focus ring) and reaches it. Why: when the boxes turn off with their error (VerifyEmail's spent code), focus would be lost with them; on the sentence, a screen reader reads why, and the next Tab goes on from there.

## States

Medium or large. Empty, focused and filling (the next box takes the 1px `accent-line` border and the faint halo, with a caret bar blinking once per `duration-pulse` where the next digit goes, steady under reduced motion), complete (the last box keeps the ring while focused), invalid, disabled, and with `errorRef` the error focused (the focus ring around its sentence).

## Keyboard

Type or paste the code; Backspace deletes the last digit.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from the prototype's CodeInput: boxes filled with `surface-subtle` and no edge, `size-control-lg` square at the default size (`space-48` wide by `space-48` plus `space-8` tall and `radius-lg` at `size="lg"`, split three and three by `space-12`), `space-8` apart, the digits in `text-title` (`text-title-lg` large) in tabular figures. Under the pointer every box deepens to `surface-hover`; focused, the next box turns white with a 1px `accent-text` edge and the `accent-border` ring, and a 2px rounded caret blinks in it. Invalid turns every edge danger (a `danger-soft` ring on the next box). The label is a Field's (`text-body-sm-strong`), the error `text-body-sm`.

**Use it for** a one time code we send or an authenticator shows. **Don't use it for** a password, an ID or anything over eight characters (Field).

**States**: empty, focused, filling, wrong (danger), disabled.

**Differences from the prototype**
- Digits don't pop in one by one, and there is no success fill or drawn check: both need a part per digit and a `isSuccess` prop the library doesn't have (owed to the sign in screens, phase 4).
- No shake on a wrong code: the screen that checks it owns the refusal (owed with the shake in phase 4).
- The 20px digit of the default size snaps to `text-title` (18/26), the nearest type token.
- Kept beyond the prototype: the input running past the last box (a password manager's icon lands outside the digits), the password managers' opt outs, and a focusable error message.
