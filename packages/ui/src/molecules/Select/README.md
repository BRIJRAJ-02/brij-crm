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
- `variant="cell"` is the trigger a grid cell becomes while its list is open: it fills the cell and shows the value where the display had it, with no box or ring of its own (the cell draws the one ring), and the list opens at least a menu wide, so options never cut to the cell's width.
- An archived option (`isArchived`) can't be chosen, but still shows, muted, when it is the current value.
- `isClearable` adds a "Clear" option while something is chosen; leave it off for a required attribute.
- `isReadOnly` shows the value in a filled box with a lock, and `readOnlyReason` says why.
- `onChange` gets the chosen id, or `null` when cleared.
- `autoFocus` focuses the trigger as it mounts. Why a variant: a dialog whose first step is a choice (RelationshipSettings' related object, spec 0014) opens on it, and the Form's own first field focus would land on React Aria's hidden native select instead.
- `isSearchable` puts a search field over the options (it takes focus as the list opens, and typing narrows them), for long lists such as countries; `searchLabel` names it.
- `onCreate(label)` adds "Create "<typed>"" (a plus) last in that search when what is typed matches no live option's label, ignoring case; choosing it hands the label over and closes the list. When it is the only item it isn't focused first, so one Enter on a typo makes nothing; an arrow reaches it. Each opening searches afresh. It turns the search on; `defaultSearch` starts it with the key that opened a grid cell. Why a variant: a select or status cell offers it to someone who may shape the schema (spec 0012, AC-238), in the same list the person was already choosing from, rather than a second control.

## States

Placeholder, chosen, searching, offering Create, focus and open (a 1px `accent-line` border and the faint halo), outlined in `control-border` at rest like a Field (3:1 on every surface), invalid, read only, disabled. The list opens from the keyboard at once and grows from the trigger for a pointer.

## Keyboard

Enter, Space or the arrow keys open it; arrows move; typing jumps to a match; Enter chooses; Esc closes it and returns focus.

## Differences from the artifact

- `items` (with `optionStyle`) replace `options` with `color`, `dot` and `render`; `value` and `onChange(id | null)` follow React Aria.
- `isClearable`, archived options, `isReadOnly` with its reason, and `error` are new.
