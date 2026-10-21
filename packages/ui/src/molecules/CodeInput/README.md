# CodeInput

A one time code as separate boxes.

## Why it exists

New. Two factor setup and sign in (#25) ask for a 6 digit code. It is one real field underneath, with `autocomplete="one-time-code"` and a numeric keyboard, so pasting or the phone's code suggestion fills every box at once, and screen readers hear one field.

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
