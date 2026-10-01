# Select

Choose one of a short list: a stage, a status, an owner.

## Why it exists

Ported from the artifact's Select card (version 8). It is the editor for select attributes with up to about 15 options and for every status attribute, and the control for short settings choices. Its options draw the way the value draws everywhere else: tags for select options, dots for statuses, avatars for people. It wraps React Aria's `Select` and `ListBox`, and opens in the library's Popover. For more options, or a search, use Menu with `search`.

## Use

```tsx
<Select label="Stage" items={stages} optionStyle="dot" value={stage} onChange={setStage} />
<Select label="Plan" items={plans} placeholder="Set Plan…" isClearable />
```

- `items`: each has an `id` and a `label`, and optionally a `hue`, an `icon`, a `description` or any `leading` piece (an Avatar).
- `optionStyle`: `plain` (the default), `tag` (select attributes) or `dot` (statuses).
- An archived option (`isArchived`) can't be chosen, but still shows, muted, when it is the current value.
- `isClearable` adds a "Clear" option while something is chosen; leave it off for a required attribute.
- `isReadOnly` shows the value in a filled box with a lock, and `readOnlyReason` says why.
- `onChange` gets the chosen id, or `null` when cleared.

## States

Placeholder, chosen, hover (pointer only), focus and open (accent border and ring), invalid, read only, disabled. The list opens from the keyboard at once and grows from the trigger for a pointer.

## Keyboard

Enter, Space or the arrow keys open it; arrows move; typing jumps to a match; Enter chooses; Esc closes it and returns focus.

## Differences from the artifact

- `items` (with `optionStyle`) replace `options` with `color`, `dot` and `render`; `value` and `onChange(id | null)` follow React Aria.
- `isClearable`, archived options, `isReadOnly` with its reason, and `error` are new.
