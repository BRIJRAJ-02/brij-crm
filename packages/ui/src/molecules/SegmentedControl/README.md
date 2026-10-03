# SegmentedControl and ThemeSwitch

Two to four equal segments that switch how you see something; and its Light, Dark and System preset.

## Why it exists

Ported from the artifact's SegmentedControl card (version 8). Table or Board (#20, #21), Week or Month (#52), and the theme switch in the sidebar footer show every option at once and change the current view. It is a React Aria `RadioGroup` underneath, so the arrow keys move between segments, and its thumb is React Aria's `SelectionIndicator`.

## Use

```tsx
<SegmentedControl label="View" segments={[{ value: 'table', label: 'Table', icon: 'list-checks' }, { value: 'board', label: 'Board', icon: 'kanban' }]} value={view} onChange={setView} />
<ThemeSwitch controller={context.theme} isCompact />
<ThemeSwitch controller={context.theme} isCompact orientation="vertical" />
```

- Use it only when the choice changes the current view. A setting that is saved is a RadioGroup.
- `isIconOnly` on a segment shows its icon alone; its label stays its name.
- `orientation="vertical"` stacks the segments, with only `space-4` at their sides. Why a variant: the folded sidebar's rail is `size-sidebar-collapsed` wide, and the three icon segments in a row spilled out of it on a phone. Stacked, each segment is a `size-control` square (26 px, a touch sized target), so the compact ThemeSwitch is 32 px wide and still fits the rail. The theme stays one press away in the footer at every width (moving it into the workspace menu when folded would have hidden it behind a second press and given it two homes). The Sidebar tells its footer when it is folded, so the screen picks the orientation.
- `ThemeSwitch` takes the app's theme controller (`context.theme`), reads it, and sets it; System removes the saved choice and follows the OS.

## States

Chosen (raised thumb), hover (pointer only), focus, disabled; horizontal or vertical. The thumb slides with `ease-in-out` over `duration-move` for a pointer, and jumps for the keyboard and under reduced motion.

## Keyboard

Tab reaches the chosen segment; the arrow keys move and choose (left and right in a row, up and down when stacked).

## Differences from the artifact

- `segments` replace `options` (`title` becomes `label` with `isIconOnly`); `ThemeSwitch` takes the theme `controller` instead of writing `data-theme` itself, and `compact` is `isCompact`. `orientation` is new.
