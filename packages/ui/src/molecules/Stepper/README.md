# Stepper

A count a guest changes one at a time: one fewer, the count, one more, as one group. Built for the guest pages after
checklabs' steppers (owner, 5 November 2026): the guest menu's row stepper (after the first +), a dish sheet's
quantity beside Add to your selection, each line of Your selection, and the reservation page's party size.

## Why it exists

The guest menu and the dish sheet each drew their own − n + from Buttons, two copies of one control with different
sizes, and the reservation page needed a third. Nothing in the library counts this way: a Field types a number in a
box, SegmentedControl picks one of a few, and ChoiceChips toggles. One molecule keeps the guest pages' steppers the
same control at three sizes and two tones.

## Use

```tsx
<Stepper label="Party size" value={party} onChange={setParty} min={1} max={12} size="md" />
<Stepper
  label="How many Flat white"
  isLabelHidden
  value={2}
  onChange={(next) => (next > 2 ? addOne() : removeOne())}
  moreLabel="Add another Flat white"
/>
<Stepper label="Quantity" isLabelHidden value={1} onChange={setQuantity} min={1} max={99} size="lg" tone="filled" />
```

- `value` and `onChange`: the caller holds the count; a press hands back one fewer or one more, never past `min`
  (default 0) or `max` (default no limit), and the button at either limit is off. Without `onChange`, or with
  `isDisabled`, both buttons are off (and `isDisabled` fades the count; the label keeps its colour, since it still names the group).
- `label` names the group: drawn over the pill (FieldLabel, the group labelled by it), or for screen readers only with
  `isLabelHidden`, where the page shows what the count is beside it (a dish's row, a party size band).
- `size`: `sm` (the default) is 30px, 26px round ghost Buttons, the count in the strong body style (checklabs' row
  stepper); `md` is 40px, 36px Buttons, the count in the heading style (checklabs' party size); `lg` is 48px, 30px
  Buttons, the count in the title style (checklabs' sheet quantity, beside a 48px action). The count reads the text
  styles, so a page's look sizes it.
- `tone`: `default` is a hairline pill on the card; `filled` a pill of the chip colour with no line (checklabs' cream).
- A press that reaches a limit turns its own button off: focus moves to the other button, so it never falls out of
  the group (to a dialog's Close).
- `fewerLabel` and `moreLabel` name the buttons when they do more than "One fewer" and "One more" ("Remove Flat
  white" at one, "Add another Flat white").
- `isFewerHidden` draws the count and one more only, for a count taken away elsewhere (a dish with choices on the
  guest menu, whose picks the selection removes).
- Each Button is drawn small and pressed across 44px (`isTouchTarget`), since a guest presses it with a thumb.
- The count is an `output` that is a polite live region, and its digits pop as it changes (NumberPop).
  `isCountAnnounced={false}` makes it plain text, where the page already says each change in its own words (the
  guest menu's rows), so it isn't said twice.
- Colours are the surface's own names (`surface-raised`, `surface-sunken`, `border`, `text`), so a page's look wears
  it.

## States

Default, at the least (one fewer off), at the most (one more off, focus moved to one fewer), disabled, count only and
one more (`isFewerHidden`), a visible or a hidden label, three sizes, two tones. Stories: Small, Medium, Large,
AtTheLeast, AtTheMost, Disabled, AddOnly.

## Keyboard

Tab reaches one fewer, then one more; Enter or Space presses. A button that is off is skipped.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.
