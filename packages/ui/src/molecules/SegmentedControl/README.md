# SegmentedControl and ThemeSwitch

Two to five equal segments that switch how you see something, or pick one short value in a small form; and its Light, Dark and System preset.

## Why it exists

Ported from the artifact's SegmentedControl card (version 8). Table or Board (#20, #21) and Week or Month (#52) show every option at once and change the current view. It is a React Aria `RadioGroup` underneath, so the arrow keys move between segments, and its thumb is React Aria's `SelectionIndicator`.

## Use

```tsx
<SegmentedControl label="View" segments={[{ value: 'table', label: 'Table', icon: 'list-checks' }, { value: 'board', label: 'Board', icon: 'kanban' }]} value={view} onChange={setView} />
<ThemeSwitch controller={context.theme} isCompact />
<ThemeSwitch controller={context.theme} isCompact orientation="vertical" />
```

- Use it when the choice changes the current view. A setting that is saved is a RadioGroup, with one exception: a short exclusive choice of two to four one word options that reveals its own fields below it, such as a form's After sending (Message, Web page, Booking), may be a `size="compact"` SegmentedControl. Why: the owner, 22 October 2026, found the radios with their sentences too heavy for that card ("the buttons should be buttons"); the choice still reads as one control and is saved like a RadioGroup's. Inside a short form, a choice of a few short values may show its label with `isLabelVisible`.
- `isReadOnly` keeps the chosen segment at full contrast and focusable, but no segment can be chosen: someone who may view a saved choice but not change it. Prefer it to `isDisabled` for a saved setting.
- `isLabelVisible` shows `label` above the track, as a Field's label (`text-label` in `text-secondary`, `space-4` above the track), and names the group by it. Why a variant: a new booking page's Duration (15, 30, 45, 60 or Custom) sits among Fields in a dialog, where five ChoiceChips made a row of large pills and a RadioGroup's rows a column taller than the form (the owner, 22 October 2026).
- `isIconOnly` on a segment shows its icon alone; its label stays its name.
- `size="compact"` makes the whole control, track and hairline included, exactly `size-control` (26px) tall, with `space-8` inside each segment. Why a variant: the default is a hairline and a track taller than a button, so beside View settings in the view bar the two sat on different lines (the owner, 22 October 2026).
- `isLabelCollapsible` shows only the icon of each segment that has one when the control's container is under 480px (a phone); a visually hidden copy of the label stays its name. Why: the view bar's Table and Board must fit a phone. While a label is hidden, hovering its icon shows it in a tooltip, as an icon only segment does (22 October 2026).
- `orientation="vertical"` stacks the segments, with only `space-4` at their sides. Why a variant: the folded sidebar's rail is `size-sidebar-collapsed` wide, and the three icon segments in a row spilled out of it on a phone. Stacked, each segment is a `size-control` square (26 px, a touch sized target), so the compact ThemeSwitch is 32 px wide and still fits the rail. The Sidebar tells its footer when it is folded, so a screen that puts it there picks the orientation (the app moved its theme to Settings, spec 0026).
- Since spec 0026 the app sets the theme in Settings › Preferences, as a row with a Select, not in the sidebar footer; `ThemeSwitch` stays for pages outside the app shell (the status page).
- `ThemeSwitch` takes the app's theme controller (`context.theme`), reads it, and sets it; System removes the saved choice and follows the OS.

## States

Chosen (raised thumb), read only (the chosen segment at full contrast, nothing changes), compact, collapsed to icons on a phone, hover (pointer only), focus (the 1px `accent-line` ring inside the segment, or the thumb's edge turning `accent-line` on the chosen one), disabled; horizontal or vertical. The thumb slides with `ease-in-out` over `duration-move` for a pointer, and jumps for the keyboard and under reduced motion.

## Keyboard

Tab reaches the chosen segment; the arrow keys move and choose (left and right in a row, up and down when stacked).

## Differences from the artifact

- `segments` replace `options` (`title` becomes `label` with `isIconOnly`); `ThemeSwitch` takes the theme `controller` instead of writing `data-theme` itself, and `compact` is `isCompact`. `orientation`, `size`, `isLabelCollapsible` and `isLabelVisible` are new.
