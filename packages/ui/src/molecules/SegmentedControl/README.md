# SegmentedControl and ThemeSwitch

Two to five segments (equal, or each as wide as its words with `isFitted`) that switch how you see something, or pick one short value in a small form; and its Light, Dark and System preset.

## Short labels

A segment may carry `accessibleLabel`, its name in full, when its visible `label` is a short form (Insights' periods read 7D, 30D, 12M; screen readers hear Last 7 days, Last 30 days, Last 12 months).

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
- `kbd` on a segment states the key that picks it from anywhere on the page (Bookings' `D` and `W`) as its radio's `aria-keyshortcuts`; the screen handles the key and lists it in its shortcut help. Why a prop: React Aria's radio takes no such attribute, and a screen can't reach the input (UX review, 30 October 2026).
- `hue` on a segment draws a colour dot before its label, as the StatusDot atom: Bookings' week picks one calendar to show (All calendars, then each connected calendar in its colour). Why a variant: the choice is one of a few views, so it is a SegmentedControl, and the colour is how each calendar's events read on the grid; a Select would hide the choices, and Radio rows are a form's (the owner, 22 October 2026). The dot takes the segment's colour and type (StatusDot `isInherited`), and a name is capped at `size-column` (an address such as brijraj@stealth.design stays whole) and only a longer one is cut with an ellipsis, shown whole in a tooltip on hover or focus (the owner, 22 October 2026).
- `isFitted` makes each segment as wide as its words instead of all as wide as the widest. Why a variant: Bookings' calendar names differ in length, and equal cells left "All calendars" and short names in wide empty ones (the owner, 22 October 2026).
- `size="compact"` makes the whole control, track and hairline included, exactly `size-control-sm` (26px) tall, with `space-8` inside each segment. Why a variant: the default is a hairline and a track taller than a button, so beside View settings in the view bar the two sat on different lines (the owner, 22 October 2026).
- `isLabelCollapsible` shows only the icon of each segment that has one when the control's container is under 480px (a phone); a visually hidden copy of the label stays its name. Why: the view bar's Table and Board must fit a phone. While a label is hidden, hovering its icon shows it in a tooltip, as an icon only segment does (22 October 2026).
- `orientation="vertical"` stacks the segments, with only `space-4` at their sides. Why a variant: the folded sidebar's rail is `size-sidebar-collapsed` wide, and the three icon segments in a row spilled out of it on a phone. Stacked, each segment is a `size-control-sm` square (26 px, a touch sized target), so the compact ThemeSwitch is 32 px wide and still fits the rail. The Sidebar tells its footer when it is folded, so a screen that puts it there picks the orientation (the app moved its theme to Settings, spec 0026).
- Since spec 0026 the app sets the theme in Settings › Preferences, as a row with a Select, not in the sidebar footer; `ThemeSwitch` stays for pages outside the app shell (the status page).
- `ThemeSwitch` takes the app's theme controller (`context.theme`), reads it, and sets it; System removes the saved choice and follows the OS.

- A segment's `count` is a quiet number after its label in the secondary colour (Meetings' Requests 2), read after the label; each new number rolls up into place over `duration-fast` (the rolling count), and only fades under reduced motion. Why a prop: the count belongs to the choice, and a Badge read as an alert on a view switch. Story: WithCount. Its styles live in `SegmentCount` (its own module), loaded with the first segment that has a count, so a page whose controls never count (the booking page's views) carries none of them; until it loads, the number is said to screen readers only.

## States

Chosen (raised thumb), with colour dots (`hue`, a cut name whole in a tooltip), fitted, read only (the chosen segment at full contrast, nothing changes), compact, collapsed to icons on a phone, hover (pointer only), focus (the 1px `accent-text` ring inside the segment, or the thumb's edge turning `accent-text` on the chosen one), disabled; horizontal or vertical. The thumb slides with `ease-in-out` over `duration-fast` for a pointer, and jumps for the keyboard and under reduced motion.

## Keyboard

Tab reaches the chosen segment; the arrow keys move and choose (left and right in a row, up and down when stacked).

## Differences from the artifact

- `segments` replace `options` (`title` becomes `label` with `isIconOnly`); `ThemeSwitch` takes the theme `controller` instead of writing `data-theme` itself, and `compact` is `isCompact`. `orientation`, `size`, `isLabelCollapsible`, `isLabelVisible` and `isFitted` are new.

## Timefix prototype (spec 0072)

Takes its look from the prototype's SegmentedControl: a `surface-subtle` pill track with a `border-subtle` hairline and `space-2` inside, round segments in `text-body-sm-strong` and `text-secondary`, turning `text` under the pointer and when chosen, and a white raised pill (`surface-raised`, the hairline, `shadow-xs`) that slides to the chosen segment over `duration-fast` on `ease-smooth-out` (transitions.dev 16), through React Aria's SelectionIndicator. `compact` is the prototype's `sm` (`space-8` in, `text-label`). Focus is the outline ring, flush with the segment, drawn over the pill.


**Use it for** two to five ways to see or set one thing that take effect at once: Table, Board or Calendar; Day, Week or Month; a 12h or 24h clock. **Don't use it for** sections of a page (Tabs), more than five options (Select) or on and off (Switch).

**States**: rest (secondary words), hover (text words), selected (the raised pill), focus visible (the outline ring), disabled (the whole control or one segment); the pill moves at once for the keyboard and under reduced motion.

**Differences from the prototype**
- Heights keep the library's: the default track is `size-control-sm` (the prototype's `sm`), with the prototype's `md` words and padding so a view name stays readable at the app scale; `compact` is a button's height, track included.
- The prototype's `ink` variant (an ink pill for public pages) is not here: no library caller asks for it yet.
- Vertical (the folded sidebar's theme switch) is a `radius-lg` column, since a pill can only be one line tall.
- Kept beyond the prototype: `label` above the track, `orientation`, `isFitted`, `isLabelCollapsible`, a segment's `hue` with its cut long name, icons with tooltips.

