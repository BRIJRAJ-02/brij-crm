# ItemSheet

A dish's sheet on the guest menu, and Your selection (spec 0065, H1, AC-6529, AC-6530, AC-6533), after the checklabs
guest app's flow. Both are the body of a `Modal`, which MenuList opens: `sheet-card` for a dish, `sheet-side` for the
picks.

## Why it exists

One of the two new modules spec 0065's "Build on what exists" allows (with MenuList). No library part shows a dish
with its sizes and option groups priced, nor a guest's picks with steppers: a Form would read as a form to fill in, and
ChoiceChips can't carry a price beside each choice.

## Use

```tsx
<Modal variant="sheet-card" title={item.name} isOpen onOpenChange={close}>
  <ItemSheet item={item} menu={menu} isSoldOut={false} photoHref={photoHref} onPick={addPick} />
</Modal>

<Modal variant="sheet-side" title="Your selection" isOpen onOpenChange={close}>
  <PicksSheet menu={menu} picks={picks} onPicksChange={keepPicks} photoHref={photoHref} />
</Modal>
```

- `ItemSheet` (checklabs' dish sheet, value for value): the photo bleeding to the sheet's edges at 4:3 (400 and 1200
  pixel sources), then 20px in: the name (22px semibold, in the menu's display face), the price (16px semibold; "from
  £9.50" with sizes) or Sold out, calories, the words (15px at 1.55), the dietary marks, then the sizes as radio cards
  (the first chosen) and each option group as cards with its price difference ("+£0.50"), each under a small caps
  overline with its rule ("CHOOSE UP TO 2 · REQUIRED"), 28px apart, then ALLERGENS as chips, only when the dish names
  any. Without a photo the name sits on the floating Close's row. The foot stays in view over a hairline: a 48px
  Stepper (1 to 99, − off at 1) and the 48px "Add to your selection" (Button `sheet`) carrying the live price (size or
  base, plus options, times the quantity) at its end, popping as it changes (Button `amount`). A group whose choices aren't
  allowed yet (`choicesAllowed`: its min, its max) holds Add off with one line saying why ("Choose your sides to add
  this."). Without `onPick` (the editor's preview), for a sold out dish or one with no price there is no foot.
- `PicksSheet` (checklabs' selection sheet): a title row (Your selection, 18px semibold, the count under it, room at
  its end for the floating Close) over a hairline; one row per line (a 48px thumb at 14px corners, the name 14px
  medium, the chosen size and options, the line's price 13px quiet, a 30px Stepper where − at 1 removes the line),
  a hairline between, grouped under their menu's name when they come from more than one menu. A removal or Clear all
  leaves one line with Undo, which puts the picks back as they were, and takes focus (the pressed button went with
  its line). Then the bill: the
  subtotal (when service is added), "Includes 20% tax" (the tax inside the prices), "Service 12.5%" on top, and the
  total (15px semibold), which pops as it changes, in a foot over a hairline; then "Show this to your server. Nothing
  is sent from this page." and Clear all. No picks: an EmptyState.
- Deviations from checklabs: no Order now (we send no orders; the note says so); Clear all and the bill's tax and
  service lines are ours; the option cards are RadioGroup's own (8px corners, the price under the name) rather than
  checklabs' 16px rows with the price at the end; the overline is drawn beside a hidden RadioGroup label.
- A pick names its size by the size's id (`sizeId`), never its place in the list, and `livePicks` (`picks.ts`, a
  Node test) drops saved picks whose dish, size or option the menu no longer has, so a republished menu never prices
  a pick at another size.
- `picksTotal` adds the picks up from the menu as it stands (a dish gone from the menu counts nothing); `picksBill`
  adds each menu's rates to its own picks (`picksTotal` from `@crm/contracts/menu`, checklabs' rollup) and sums them;
  `pickKey` is the key that folds the same dish with the same choices into one line.
- Colours are the library's names; inside MenuList they are the menu's look.

## States

Ready, sizes, options, a required group waiting (Add off, the reason), sold out (no foot, choices disabled), no price
(a price note, no foot), an option group full (the rest disabled), picks, picks grouped by menu, a removal with Undo,
no picks.

## Keyboard

Tab moves through the choices and the foot; arrows move within a radio group; Space toggles a checkbox; Escape closes
the sheet.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
