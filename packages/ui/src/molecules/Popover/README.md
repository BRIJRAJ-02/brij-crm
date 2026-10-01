# Popover

The floating surface menus, selects, pickers and "+N" lists open in.

## Why it exists

New. The artifact draws each menu's surface itself and animates it in only. One popover gives every overlay the same surface, the same placement and the exit animation the artifact lacks (house rule 8), so Menu, Select, DatePicker and TagList don't each style their own.

## Use

```tsx
<DialogTrigger>
  <Button>Filter</Button>
  <Popover label="Filter">…</Popover>
</DialogTrigger>
```

- Put a `Menu` or `ListBox` straight inside; give `label` for any other content, and it opens as a dialog with that name.
- `width`: `content` (the default), `menu` (240px, or the trigger's width when wider), `trigger` (exactly the trigger's width, for a select).
- `placement` follows React Aria (`bottom start` by default) and flips when there is no room.
- `triggerRef` anchors it to an element that isn't a React Aria trigger (a context menu's row).

## States

Opening grows it from its trigger in `duration-popover`; closing fades it in `duration-exit`. Opened from the keyboard it appears and leaves at once. Reduced motion keeps the fade and drops the growth.

## Keyboard

Esc closes it and returns focus to the trigger. Focus stays inside while it is open (unless `isNonModal`).

## Differences from the artifact

- Not a card in the artifact; it takes over the surface `ws-menu` drew, with an exit animation.
- Its gap to the trigger is a `space-4` margin on the placed side, so it comes from a token.
