# Select

Choose one of a short list: a stage, a status, an owner.

## Why it exists

Ported from the artifact's Select card (version 8). It is the editor for select attributes with up to about 15 options and for every status attribute, and the control for short settings choices. Its options draw the way the value draws everywhere else: tags for select options, dots for statuses, avatars for people. It wraps React Aria's `Select` and `ListBox`, and opens in the library's Popover. For more options, or a search, use Menu with `search`.

## Use

```tsx
<Select label="Stage" items={stages} optionStyle="dot" value={stage} onChange={setStage} />
<Select label="Plan" items={plans} placeholder="Set Plan…" isClearable />
```

- `items`: each has an `id` and a `label`, and optionally a `hue`, an `icon`, a `description`, any `leading` piece (an Avatar) or a `badge`, a short Badge after a plain option's name in the list and on the trigger (a schedule's "Default"; a variant, since the name alone can't say which one is the default).
- `optionStyle`: `plain` (the default), `tag` (select attributes) or `dot` (statuses).
- `variant="cell"` is the trigger a grid cell becomes while its list is open: it fills the cell and shows the value where the display had it, with no box or ring of its own (the cell draws the one ring), and the list opens at least a menu wide, so options never cut to the cell's width.
- An archived option (`isArchived`) can't be chosen, but still shows, muted, when it is the current value.
- A disabled option (`isDisabled`) shows muted and can't be chosen, with its `description` saying why: a field a rule rules out for this change (a unique field in a bulk edit of several records). Why a variant: leaving the field out of the list hid the reason with it.
- `isApart` on an item sets it under a hairline, apart from the options above, as Clear is. Why a variant: a choice unlike the rest, such as a form's "Don't add to the CRM" after the objects it could file onto (the owner, 21 October 2026), belongs in the same list but must not read as one more object.
- `info` puts an InfoTip beside the label, for a setting whose label alone isn't clear (a booking page's Minimum notice). Why a variant: the help belongs to the field's own label, and an InfoTip placed outside the field sat apart from it. The label row keeps the label's height, so a field with help lines up with its neighbours.
- `isClearable` adds a "Clear" option while something is chosen; leave it off for a required attribute.
- `isReadOnly` shows the value in a filled box with a lock, and `readOnlyReason` says why.
- `onChange` gets the chosen id, or `null` when cleared.
- `autoFocus` focuses the trigger as it mounts. Why a variant: a dialog whose first step is a choice (RelationshipSettings' related object, spec 0014) opens on it, and the Form's own first field focus would land on React Aria's hidden native select instead.
- `isSearchable` puts a search field over the options (it takes focus as the list opens, and typing narrows them), for long lists such as countries; `searchLabel` names it. The search takes focus through the list's own focus scope (React Aria's `FocusScope autoFocus`), once that scope is in place, so a searchable Select works inside another popover: an input's own `autoFocus` fired while the list was still mounting, and the popover around it (a grid cell's editor) read the move as focus leaving and closed, list and all (the owner's "clicking on country is not working", 21 October 2026).
- While searching, the best matches come first and the first is the one marked, so Enter chooses what was meant: by default the options whose label starts with what is typed ("ind" lists India before British Indian Ocean Territory). `rank(item, query)` (lower first, ties in the given order) decides it where the label is not enough: CountryPicker puts a shared dial code's main country first. Why a variant: Enter on a typed search chose the first option alphabetically, which was often not the one meant.
- `filter(item, query)` decides which options a search keeps, when the label is not enough. Why a variant: CountryPicker finds a country by its ISO code and dial code as well as its name, in the same search.
- `variant="prefix"` is the compact trigger joined to the start of a Field's box: no box or ring of its own (the Field draws them), a hairline after it, the option's `leading` and `short` ("+91") in place of its label, close together with the small chevron, and the list a menu wide. The code takes its own width: a width kept for the longest code ("+998") left a hole before the chevron for every short one (the owner, 21 October 2026), so the number moves a little when the code changes length. Why a variant: PhoneField's country code is this list in this popover, not a second control. `triggerRef` lets a field put focus back where it belongs after a choice.
- `variant="inline"` sits in a line of text: the value and its chevron with no box, the keyboard's focus as an outline, and the list a menu wide. Why a variant: a booking page's rail names the visitor's time zone as a line of text that opens the zone search (timefix's "Calcutta time (GMT+5:30) ⌄"), not a field. It also sits in a Field's `suffix` (the Invite dialog's role per address), where it takes the suffix's label type.
- `variant="time"` is a time of day in a row of them (HoursEditor's windows and its All days row): one fixed width for every time (`size-column-min` plus `space-24`, room for "12:00 AM" and "Midnight") and tabular figures, so a row's "to" and its buttons sit on one line down the week and never move when a time changes; the list opens at the trigger's width. Why a variant: each select sized to its value, so "12:00 AM" and "11:00 PM" put the next control at different places (owner, 20 October 2026).
- `onCreate(label)` adds "Create "<typed>"" (a plus) last in that search when what is typed matches no live option's label, ignoring case; choosing it hands the label over and closes the list. When it is the only item it isn't focused first, so one Enter on a typo makes nothing; an arrow reaches it. Each opening searches afresh. It turns the search on; `defaultSearch` starts it with the key that opened a grid cell. Why a variant: a select or status cell offers it to someone who may shape the schema (spec 0012, AC-238), in the same list the person was already choosing from, rather than a second control.
- `labelAside` puts a quiet word after the label, such as "(optional)" on a public form: `text-tertiary`, on the same line, and part of the field's accessible name.

- `group` on an option puts it under a heading: options with the same group follow one heading, in the order they come, after any without a group. Why a field: a booking page's "Add events to" lists each account's calendars under the account, as the Bookings calendars panel does.

## States

Placeholder, chosen, searching, offering Create, an option that can't be chosen (with its reason), focus and open (a 1px `accent-line` border and the faint halo; in a popover the border alone, as a Field's there), outlined in `control-border` at rest like a Field (3:1 on every surface), invalid, read only, disabled. The list opens from the keyboard at once and grows from the trigger for a pointer.

- `showsDescription` keeps the chosen option's `description` after its label in the closed field, muted: a time zone shows its offset ("Asia/Kolkata GMT+05:30") without opening the list.

## Keyboard

Enter, Space or the arrow keys open it; arrows move; typing jumps to a match; Enter chooses; Esc closes it and returns focus.

## Differences from the artifact

- `items` (with `optionStyle`) replace `options` with `color`, `dot` and `render`; `value` and `onChange(id | null)` follow React Aria.
- `isClearable`, archived options, `isReadOnly` with its reason, and `error` are new.
