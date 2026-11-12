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
- `size`: `sm` (the default) is 30px, 26px round ghost Buttons, the count in the strong body style; `md` is 40px, 36px
  Buttons, the count in the heading style (checklabs' party size); `lg` is 48px, 30px Buttons, the count in the title
  style. The count reads the text styles, so a page's look sizes it.
- `size="row"` and `size="sheet"` are checklabs' own steppers, value for value (the owner wants its menu exactly, 5
  November 2026): `row` is 30px with 2px inside, 24px buttons 2px apart and a 13px semibold count (a dish's row on the
  guest menu, a line of Your selection); `sheet` is 48px with 32px buttons and the count in the title style (a dish
  sheet's foot, beside Button's 48px `sheet`). Both draw the − and + in the text colour, not the quiet one, and half
  as bold again (checklabs' 2.25 stroke). Why sizes and not a change to `sm` and `lg`: those keep the library's own
  proportions for any other page; these two are the guest menu's, and its look owns them. The buttons are the same
  Buttons, drawn at 24px and 32px by the pill's own sizes (`size-control`, `size-input`), so their 44px touch target
  follows.
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
one more (`isFewerHidden`), a visible or a hidden label, five sizes, two tones. Stories: Small, Medium, Large, Row,
Sheet, AtTheLeast, AtTheMost, Disabled, AddOnly.

## Keyboard

Tab reaches one fewer, then one more; Enter or Space presses. A button that is off is skipped.

## Differences from the artifact

Not in the artifact yet; it goes with the next `pnpm ui:artifact`.

## Timefix prototype (spec 0072)

The prototype's Steps lists Stepper in its `replaces` by name only: Steps is a step indicator (numbered rings joined by a line), and this part is a quantity control (one fewer, the count, one more), so it has nothing of Steps' look to take and cannot render it. It keeps checklabs' guest look, which the owner asked for on the guest pages (5 November 2026). Its − and + are Button's ghost buttons, so they already wear the prototype's pills, hover and outline focus ring (tier 1); its pill and count use only current tokens.

**Differences from the prototype**: no prototype part draws a quantity stepper; the nearest is NumberField's steppers, which phase 2 ports. Folding Stepper there (or into a phase 2 counter) is left to the guest menu's screen phase.

**Repeats from its replacer** (spec 0072, AC-4): nothing; it shares no rules with Steps.
