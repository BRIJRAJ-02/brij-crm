# Button

The one button: 26px tall with a 13px medium label, in four variants, built on React Aria so it works the same by mouse, touch and keyboard. This folder also holds `ToggleButton` (a button that stays pressed) and `SplitButton` (a main action with a menu of its variants).

## Why it exists

Ported from the design system artifact's Button card. Every pressable control in the app is one of these; a second button style is how a design system dies, so new looks are variants here.

## Use

```tsx
<Button icon="settings" onPress={openSettings}>View settings</Button>
<Button kbd="ESC" onPress={close}>Cancel</Button>
<Button variant="primary" kbd="⌘↵" onPress={save}>Add to list</Button>
<Button variant="primary" isPending>Saving</Button>
<Button icon="ellipsis" label="More actions" onPress={openMenu} />
<ToggleButton isSelected={showArchived} onChange={setShowArchived}>Show archived</ToggleButton>
<SplitButton onPress={save} menu={<Menu>…</Menu>}>Save</SplitButton>
```

- **One primary per surface.** `primary` goes on the action that commits: Save, Add to list, Select record. Pair it with its shortcut (`kbd="⌘↵"`).
- `secondary` (the default) for view controls (View settings, Import / Export) and Cancel (`kbd="ESC"`).
- `ghost` for undo style actions that shouldn't compete, such as Discard changes, and for icon buttons inside dense rows.
- `dashed` only for "add a condition" affordances: Filter, Add sort.
- `SplitButton` when the primary action has variants (Save, Save as new view). Its `menu` is a `Menu`; the chevron is named "More options" unless `menuLabel` says otherwise. Screens can fill `menu` once the library's Menu ships in milestone 2 (React Aria itself stays inside `packages/ui`).
- Labels are verbs in sentence case: "Add to list", never "ADD" or "Submit".

Props: `children` (the label, a string) or `icon` with `label` (icon only); `icon`, `iconRight`; `variant`; `size` (`md` 26px, `lg` 30px, to sit beside an input); `kbd` (one keycap or several); `onPress`; `isDisabled`; `isPending`; `type`; `slot`; `ref`.

## States

- **Hover**: `surface-hover` (the primary darkens to `accent-hover`), only on devices that can hover.
- **Pressed**: scales to 0.97 (`scale-press`, `duration-press`, `ease-out`), so a click is felt before anything else happens. Reduced motion drops the scale.
- **Focus**: from the keyboard only, a 1px `accent` border plus `shadow-focus`. In forced colours, a 2px `Highlight` outline.
- **Disabled**: at `opacity-disabled`, skipped by Tab, never pressed.
- **Pending** (`isPending`): a spinner in place of the icon, presses ignored, still focusable, at `opacity-busy`. Screen readers hear the change. Change the label to the ongoing verb ("Saving").
- **Selected** (`ToggleButton`): `accent-soft` with an `accent` edge, which holds 3:1 against the surface (the artifact marks a pressed day with the accent too). It keeps that look while hovered. `aria-pressed` tells screen readers.
- **Shortcut** (`kbd`): the keycaps are for sight. The button states the shortcut through `aria-keyshortcuts` (`⌘↵` is `Meta+Enter`), so screen readers hear "Add to list", not "Add to list command return".

## Keyboard

- `Tab` and `Shift Tab` reach it (not when disabled).
- `Enter` and `Space` press it. On a `ToggleButton` they toggle it.
- On a `SplitButton`, `Tab` moves from the action to the chevron; `Enter`, `Space` or `↓` opens the menu, `Esc` closes it and returns focus to the chevron. Disabled or pending, both halves wait together.

## Differences from the artifact

- `onPress` replaces `onClick`, and `isDisabled` and `isPending` replace `disabled` and `loading` (React Aria's names, so props pass straight through). Pending keeps the button focusable, where the artifact disabled it.
- `icon` and `iconRight` take registry names (`IconName`), so a typo is a type error.
- The label is `children: string`. An icon only button takes `label` instead, and TypeScript refuses one without it.
- No `className`, `style` or other HTML attributes pass through: one look, set here.
- `ToggleButton` is new (the artifact had no pressed state), for format toolbars and view toggles.
- `SplitButton` takes its `menu` instead of an `onMenu` callback, so the menu opens from the chevron with focus handled by React Aria.
- `disabledReason` (a tooltip that says why) arrives with Tooltip in milestone 2.
- The keycaps no longer read as part of the name, and the primary's keycap is edged instead of filled, so its text holds 4.5:1 (on the `on-accent-kbd` fill it was 3.3:1).
- The SplitButton divider on the primary uses `on-accent-kbd`, as the artifact does.
