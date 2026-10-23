# Menu

A list of actions or choices in a popover: column options, "Add to list", a select with search, the members picker.

## Why it exists

Ported from the artifact's Menu card. Every dropdown of actions or choices in the app is a Menu, so they all move by keyboard the same way. It wraps React Aria's `Menu`, `MenuTrigger` and `SubmenuTrigger`, and opens in the library's Popover. `ContextMenu` is its right click variant.

## Use

```tsx
<MenuTrigger>
  <Button icon="ellipsis" label="Column options" />
  <Menu label="Column options" onAction={run}>
    <MenuItem id="asc" icon="chevron-up">
      Sort ascending
    </MenuItem>
    <SubmenuTrigger>
      <MenuItem icon="settings">Formatting</MenuItem>
      <Menu label="Formatting">…</Menu>
    </SubmenuTrigger>
    <MenuSeparator />
    <MenuItem id="delete" icon="trash" isDanger>
      Delete attribute
    </MenuItem>
  </Menu>
</MenuTrigger>
```

- **Items**: `MenuItem` takes a label, and optionally an `icon` (or any `leading` piece: an Avatar, a Tag, a StatusDot), a `description`, a `meta` count, a `kbd` shortcut, `isDanger`, `href` and `isChecked` (a check at the end for what is in effect now in a menu of actions, a column's current sort, which screen readers hear after the label as its description, "Current"; until 23 October 2026 the check's name sat outside the item's name and was never heard). With `isLabelInLeading` the leading piece shows the label itself (a select option's Tag), so the label is kept for screen readers and typing only and never drawn twice.
- **Groups**: `MenuSection` with a `label`, and `MenuSeparator` between groups. A section's `selectionMode` overrides the menu's: `none` makes its items plain actions in a menu of choices (the view switcher's "This view" actions under its views). In a menu that chooses, those plain items keep the empty check column, so their icons line up with the choices' icons (21 October 2026). A section can also take its own `selectedKeys` and `onSelectionChange` with `selectionMode="single"`, so a menu of two groups gives one choice in each, each read as its own single choice (Bookings' Filter: which meetings show, and which link; 22 October 2026). `isLabelHidden` keeps a section's heading for screen readers only, where it would only add height (a schedule's actions when there is one schedule). `isJoined` follows the section above with no gap and no heading, as more of its group: a choice beside its actions, its `label` said to screen readers only. In such a choice, a `MenuItem`'s `isCheckAtEnd` draws its check at the end, as `isChecked` does, instead of in a check column before the items, so the choice's icons line up with the actions' icons above it while screen readers hear each item as a radio item, checked or not: the command palette's themes under Actions (`ChoiceAmongActions`; QA Q47, 23 October 2026). `isCheckAtEnd` takes the place of `isChecked`. Why variants: `isChecked` is heard as a description, not as a checked state, and only a section's own selection gives an item that state, so the theme choice needed a section of its own that still looks like part of Actions.
- A `description` wraps within the menu's width and never sets it: the labels and the menu's minimum width size the menu, so a long reason on a disabled item can't stretch it across the page and pull it away from its trigger (the owner, 21 October 2026: the view menu opened 825px wide, far left of its button, and grew in from the right).
- **Choices**: `selectionMode="single"` or `"multiple"` shows checks; `selectedKeys` and `onSelectionChange` hold the choice.
- **Search**: `search={{ label: 'Search attributes' }}` puts a field above the items and filters them here. With `onSearch`, the caller searches (async) and sends back new items. `isFirstUnfocused` leaves the first item unfocused while typing: a lone "Create" item (spec 0012), which one Enter shouldn't choose. Why a variant: the select editor's Create is the one item an Enter must not reach by accident.
- **Long lists**: `items` with `isVirtualized` draws only the rows on screen; `source` (a `ListSource`) does the same for lists loaded from outside, with skeleton rows until each loads (AC-9). Rows are `size-nav-item` tall, read from tokens.json.
- `header` is a row above the search and the items, apart from them, so typing never filters it: a record search's object, "Search in People" (spec 0019). Why a slot: a task's record picker searches one object at a time, and the choice belongs inside the picker, not as a second control beside its field (the owner's call, 20 October 2026).
- `anchorRef` lines the popover up with another element than its trigger, and takes that element's width with `width="trigger"`: a picker's whole field box, whose button fills only the room its chips leave.
- `width`: `menu` (240px, or the trigger's width) or `trigger` (exactly the trigger's width).
- `isInline` draws the menu in place, with no popover (inside a palette).
- `autoFocus` (`first` or `last`) focuses an item when the menu mounts. Why a prop: an inline menu opened in a Popover of its own (WeekCalendar's "+N" list) has no MenuTrigger to focus it, so from the keyboard focus would stop on the popover and the arrows would do nothing.
- Inside a `MenuTrigger`, React Aria names the menu after its trigger; `label` is its name when inline.
- **ContextMenu** (the right click variant): `<ContextMenu menu={<Menu …/>}><Button …/></ContextMenu>` opens the menu at the pointer on right click or a long press. Browsers turn Shift F10 and the menu key into the same event, so those open it too where the platform has them.

## States

Focused (keyboard or pointer, `surface-hover`; keyboard adds the inset ring), selected (a check), disabled, pending (`isPending`: a status row such as "Searching…", in the secondary text colour at full contrast with the arrow cursor, never highlighted or chosen), danger, submenu open, empty ("No matches"), loading rows (skeletons). It opens from the keyboard at once, grows from its trigger for a pointer, and fades out faster than it came.

## Keyboard

Enter, Space or the arrow keys open it from the trigger. Up and Down move; Home and End jump; typing jumps to a match; Right opens a submenu and Left closes it; Enter or Space acts or chooses; Esc closes it and returns focus to the trigger. In a searchable menu, typing filters and the arrows still move.

## Differences from the artifact

- `width` takes `menu` or `trigger`, not a number; the 240px comes from tokens (`size-sidebar` less `space-20`) until a `size-menu` token exists.
- `searchPlaceholder` and `searchId` become `search`; `checked` becomes the menu's selection; `active` is React Aria's focus; `submenu` comes from `SubmenuTrigger`; `danger` is `isDanger`.
- Exit animations and keyboard instant opening are new.
