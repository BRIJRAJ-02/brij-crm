# CustomiseSidebar

The Customise sidebar dialog (spec 0034, AC-933): each section's items with a switch, then Reset to default, which asks first.

## Why it exists

New, because no existing module lists switches by group: `Modal` gives the dialog, `Switch` the controls, `Icon` the object tiles, so this adds only the grouped list and the reset confirm. Linear's Customize sidebar is the model: one place where a hidden item can always be brought back, beside the per item "Hide from sidebar" in the sidebar's menus.

## Use

```tsx
<CustomiseSidebar
  isOpen={isOpen}
  onOpenChange={setOpen}
  sections={[
    {
      id: 'records',
      title: 'Records',
      items: [{ id, name: 'Deals', icon: 'handshake', hue: 'orange', isShown: false }],
    },
  ]}
  onShownChange={(sectionId, itemId, isShown) => change(isShown ? 'show' : 'hide', itemId)}
  onReset={() => data.nav.change(slug, { op: 'reset' }, universe, { isSaidHere: true })}
/>
```

- Every switch applies at once (the sidebar is optimistic), so the footer has Done, not Save.
- Reset to default can't be taken back in one click, so it asks first (the owner's rule, 21 October 2026): a danger confirm over the dialog, "Reset your sidebar?", what it does and that it can't be undone, Cancel (ESC) first and Reset sidebar last. `onReset` answers a promise: the commit shows busy until it settles, and a rejection's message shows inside the confirm, which stays open.
- Fixed items (the workspace menu, Quick actions, Trash, Settings) are never passed: they can't be hidden.
- Load it lazily: it sits behind a menu, outside the first load.

## States

Default; a section with every item hidden; empty (nothing can be hidden: "Nothing here can be hidden."); the reset's confirm (asking, busy, refused). Switch states (hover, focus, on, off) are Switch's own.

## Keyboard

Tab moves through the switches in order, then Reset to default and Done. Space toggles a switch. Esc closes the dialog, and focus goes back to the menu item that opened it. The reset's confirm takes focus when it opens; Esc or Cancel closes it with nothing changed.

## Differences from the artifact

Not in the artifact.
