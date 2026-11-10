# GuestChips

The guests a booking takes, as chips: each address with its initial and a remove button, wrapping onto as many lines as it needs.

## Why it exists

New (2 November 2026). The owner asked for adding and removing guests to be one thing everywhere. The booking form had chips of its own and a guest's manage page had a list of rows with an Add button, so the same job looked two ways. Neither Tag (no remove) nor FilterChip (a filter's field, operator and value) fits, so the chip moved out of BookingDetails into here, and both screens draw it.

## Use

```tsx
<GuestChips
  guests={guests}
  label="Guests to invite"
  removeLabel={(guest) => `Remove ${guest}`}
  onRemove={(index) => remove(index)}
  invalid={new Set([1])}
/>
```

- The field that adds guests stays with the screen: the booking form takes typed and pasted addresses into chips as they end; the manage page invites one at a time through the server, so it keeps its own Add.
- `onRemove` gets the chip's place. Leave it off for chips that can't be removed.
- `invalid` marks the guests a server turned down by place (its `guest-n`), with the danger edge; the field's error says why.

## States

Empty draws nothing. A chip arrives out of a 2px blur (a fade under reduced motion). Invalid takes the danger edge. Hover, focus and press come from the remove Button.

## Keyboard

Each chip's remove button is in the Tab order, named with the address it removes.

## Differences from the artifact

Not in the artifact.

## Status

Since 10 November 2026 neither the booking form nor the guest page draws it: both add guests as InviteRows' guest rows (the owner's v5 mock). It stays in the library for now.
