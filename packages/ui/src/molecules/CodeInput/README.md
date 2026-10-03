# CodeInput

A one time code as separate boxes.

## Why it exists

New. Two factor setup and sign in (#25) ask for a 6 digit code. It is one real field underneath, with `autocomplete="one-time-code"` and a numeric keyboard, so pasting or the phone's code suggestion fills every box at once, and screen readers hear one field.

## Use

```tsx
<CodeInput label="Code from your authenticator app" value={code} onChange={setCode} onComplete={verify} />
```

- It keeps digits only, up to `length` (6).
- `onComplete` runs once every box is filled; `error` says what to do ("That code has expired. Enter the new one from your app.").
- `ref` reaches the one real input under the boxes, so a module can move focus to it, as VerifyEmail does once a new code is sent.
- `errorRef` makes the error's sentence focusable from code only (`tabIndex={-1}`, with the focus ring) and reaches it. Why: when the boxes turn off with their error (VerifyEmail's spent code), focus would be lost with them; on the sentence, a screen reader reads why, and the next Tab goes on from there.

## States

Empty, filling (the next box takes the ring), complete, invalid, disabled, and with `errorRef` the error focused (the focus ring around its sentence).

## Keyboard

Type or paste the code; Backspace deletes the last digit.

## Differences from the artifact

Not in the artifact.
