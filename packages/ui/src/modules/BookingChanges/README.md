# BookingChanges

A guest's changes to their booking (spec 0025, AC-675 to AC-677), after the timefix app's guest page and the manage pages of Cal.com, Calendly and GetYourGuide: "Need a change?" over one row of actions. **Move to another time** and **Guests** (Add guests while there are none) are equal quiet toggles, the open one shown pressed; **Cancel booking** sits at the row's end as a quiet destructive button. Each opens its panel under the row, on the receipt card's rhythm. Guests is one list (each guest with an initial and Remove) over one email field whose Add, or Enter, invites them, with the count ("1 of 10") and one line: "Guests get the invite. Only you can move or cancel." Cancel always asks first ("Cancel this booking?", an optional reason the host sees, Yes, cancel it or Keep it). It sits at the foot of BookingReceipt's card, through its `changes` slot.

## Why it exists

New. BookingReceipt shows a booking; nothing in the library let a guest change one. BookingDetails' guest rows are part of the booking form's submit and its errors; here each guest is added and removed on its own, straight away, so the panel keeps its own list and one field.

## Use

```tsx
<BookingReceipt … changes={<BookingChanges hostName="Ada" guests={[…]} canMove move={<Picker />} onInvite={…} onRemove={…} onCancel={…} />} />
```

The page draws the move picker (the booking page's own DayStrip and SlotList, with a commit bar that names the new time) and passes it as `move`. `onInvite`, `onRemove` and `onCancel` answer what the server said; a done cancel is shown by the page (the receipt turns cancelled).

## States

Idle; Move open; Guests open (the list, Adding…, Invited bob@…, They're already on it., Took ann@… off., a wrong address under the field, the field replaced by a line once the booking has its most guests); Cancel open (Cancelling…, a refusal above the buttons); no Move when it can't move.

## Notes

- The top row keeps its own small flex row rather than ButtonGroup's `row` layout: Cancel booking sits apart at the row's end, which ButtonGroup doesn't offer. The cancel confirm's two buttons use ButtonGroup `row`.
- Why not ListEditor for the guests: ListEditor edits a list value and commits it whole through an attribute's schema; here each add and each remove is its own server call that emails or uninvites someone, so the panel keeps one list and one field.
- The panel is a disclosure: it fades in and closes at once, as Disclosure does.

## Keyboard

Tab reaches Move, Guests and Cancel booking, each read as expanded or collapsed and naming its panel. Opening a panel moves focus into it (a region named by its title); Enter in the guest field adds; after an add or a remove, focus returns to the field; Keep it puts focus back on Cancel booking.

## Differences from the artifact

Not in the artifact.
