# Field

The one field design: an 11px label above a 30px input with a hairline outline, and a hint or an error below.

## Why it exists

Ported from the artifact's Field card. Every text, number and link attribute is typed through it, in a create form, the record panel, a cell editor, a filter value or an import preview, so a field looks and behaves the same everywhere. It wraps React Aria's `TextField`, so the label, hint and error are wired for screen readers.

## Use

```tsx
<Field label="Domain" placeholder="Set Domain…" hint="Without https:// or a path." />
<Field label="Amount" prefix="USD" inputMode="decimal" />
<Field label="Description" isMultiline maxLength={10000} showCounter />
<Field label="Search records" isLabelHidden variant="search" />
```

- `placeholder` follows the Field card: "Set <Attribute>…" (`strings.setAttribute`). It is `text-tertiary`, so never put an instruction only there; use `hint`.
- `error` is a sentence that says how to fix it ("Enter a domain like halcyonlabs.io, without spaces."). The outline turns `danger` and the message shows under the box with an icon. With `isErrorFloating` (a grid cell, one line tall) the message floats under the box on a raised surface, over the rows below.
- `isReadOnly` fills the box with `surface-subtle` and shows a lock; `readOnlyReason` says why, as the hint. `isDisabled` fades it; `disabledReason` says who can change it.
- `prefix` holds a unit (`USD`, `%`) or a picker (the currency editor's code Select); `suffix` a clear button or a trigger.
- `isMultiline` is a textarea that grows with its content (long text); `maxLength` with `showCounter` shows "12/500".
- `size="sm"` is the 26px cell editor; `variant="search"` the rounded search field.
- Typed numbers are parsed by the field set, never here (the input stays text, so nothing is lost to a JS number).
- Stack fields with `space-16` between them in modals and panels.

- `autoFocus` takes focus as it mounts, for the search field at the top of a list that just opened.
- Inside a `Form`, a refusal the form holds under the field's `name` shows here like `error`, until the person changes the field. A given `error` wins. The browser's own checks (`required`, `type="email"`) never show their messages: a required field is marked `aria-required`, and the screen or module says what is wrong in the library's words.

## States

Empty (placeholder), filled, hover (pointer only), focus (accent border and ring), invalid (danger border and message), read only (filled, lock, reason), disabled (faded, reason).

## Keyboard

Tab reaches it. In a single line field, Enter calls `onSubmit` (a cell commits on it).

## Differences from the artifact

- React Aria's props replace the input attributes: `onChange(value)`, `isReadOnly`, `isDisabled`, `isInvalid` through `error`.
- `readOnlyReason` and `disabledReason` replace writing the reason into `hint` by hand. `counter` is `maxLength` with `showCounter`.
- A chosen value (a chip or a status) is no longer `children`: that is the field set's editor for its type.
