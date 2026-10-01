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

- **Items**: `MenuItem` takes a label, and optionally an `icon` (or any `leading` piece: an Avatar, a Tag, a StatusDot), a `description`, a `meta` count, a `kbd` shortcut, `isDanger` and `href`.
- **Groups**: `MenuSection` with a `label`, and `MenuSeparator` between groups.
- **Choices**: `selectionMode="single"` or `"multiple"` shows checks; `selectedKeys` and `onSelectionChange` hold the choice.
- **Search**: `search={{ label: 'Search attributes' }}` puts a field above the items and filters them here. With `onSearch`, the caller searches (async) and sends back new items.
- **Long lists**: `items` with `isVirtualized` draws only the rows on screen; `source` (a `ListSource`) does the same for lists loaded from outside, with skeleton rows until each loads (AC-9). Rows are `size-nav-item` tall, read from tokens.json.
- `width`: `menu` (240px, or the trigger's width) or `trigger` (exactly the trigger's width).
- `isInline` draws the menu in place, with no popover (inside a palette).
- Inside a `MenuTrigger`, React Aria names the menu after its trigger; `label` is its name when inline.
- **ContextMenu** (the right click variant): `<ContextMenu menu={<Menu …/>}><Button …/></ContextMenu>` opens the menu at the pointer on right click or a long press. Browsers turn Shift F10 and the menu key into the same event, so those open it too where the platform has them.

## States

Focused (keyboard or pointer, `surface-hover`; keyboard adds the inset ring), selected (a check), disabled, danger, submenu open, empty ("No matches"), loading rows (skeletons). It opens from the keyboard at once, grows from its trigger for a pointer, and fades out faster than it came.

## Keyboard

Enter, Space or the arrow keys open it from the trigger. Up and Down move; Home and End jump; typing jumps to a match; Right opens a submenu and Left closes it; Enter or Space acts or chooses; Esc closes it and returns focus to the trigger. In a searchable menu, typing filters and the arrows still move.

## Differences from the artifact

- `width` takes `menu` or `trigger`, not a number; the 240px comes from tokens (`size-sidebar` less `space-20`) until a `size-menu` token exists.
- `searchPlaceholder` and `searchId` become `search`; `checked` becomes the menu's selection; `active` is React Aria's focus; `submenu` comes from `SubmenuTrigger`; `danger` is `isDanger`.
- Exit animations and keyboard instant opening are new.
