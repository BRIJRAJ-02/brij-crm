# ItemSheet

A dish's sheet on the guest menu, and Your picks (spec 0065, H1, AC-6529, AC-6530, AC-6533). Both are the body of a
`Modal` `sheet`, which MenuList opens.

## Why it exists

One of the two new modules spec 0065's "Build on what exists" allows (with MenuList). No library part shows a dish
with its sizes and option groups priced, nor a guest's picks with steppers: a Form would read as a form to fill in, and
ChoiceChips can't carry a price beside each choice.

## Use

```tsx
<Modal variant="sheet" title={item.name} isOpen onOpenChange={close}>
  <ItemSheet item={item} menu={menu} isSoldOut={false} photoHref={photoHref} onPick={addPick} />
</Modal>
```

- `ItemSheet`: the photo (400 and 1200 pixel sources, lazy), a big title, the price (or Sold out), calories, the
  description, "Allergens: milk, celery." in words, the dietary marks, then each size and option group as stacked
  cards: the name and its price or "(+£1.00)", the radio or checkbox at the end behind a dashed line. A group's rule
  (choose 1, up to N, any) is enforced as the guest picks. The foot holds a stepper and "Add to your picks · £9.50";
  without `onPick` (the editor's preview) or for a sold out dish there is no foot.
- `PicksSheet`: one card per pick with its size and options, its price and a stepper (− at 1 removes it), the total,
  and "Show this to your server. Nothing is sent from this page." Picks never leave the caller.
- `picksTotal` adds the picks up from the menu as it stands, so a dish gone from the menu counts nothing.

## States

Ready, sold out (no foot, choices disabled), no price (a price note, no foot), an option group full (the rest
disabled), no picks.

## Keyboard

Tab moves through the choices and the foot; arrows move within a radio group; Space toggles a checkbox; Escape closes
the sheet.
