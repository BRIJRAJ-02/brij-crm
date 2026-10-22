# CalendarList

The member's calendars, as Google Calendar lists them beside its grid: the Bookings calendars panel (spec 0024 milestone 5, the owner's asks of 21 and 22 October 2026).

## Why it exists

New. Nothing in the library lists checkable items under folding headings with a per row menu. It composes Disclosure (an account with two or more calendars, its provider's mark in `leading`), Checkbox (each calendar, its colour and name a StatusDot in `leading`) and a MenuTrigger per row, so every part keeps the library's look and keys.

## Use

```tsx
<CalendarList
  accounts={[{ id, provider: 'google-calendar', email: 'ada@acme.dev', calendars: [{ id, name: 'Team', hue: 'green', isShown: true }] }]}
  onShownChange={(id, isShown) => …}
  onShowOnly={(id) => …}
  onShowAll={() => …}
/>
```

- A small label heads the list ("My calendars", or `label`).
- An account with one calendar is that calendar's row alone, never its address over the same name again, with its provider's mark (named, `isLabelled`) after the name, so where it comes from reads as it does on a folded account; an account with two or more folds under its mark and address.
- Each row is the plain Checkbox, then the calendar's colour as a dot and its name (a StatusDot in the Checkbox's `leading`, so pressing the name toggles it); a long name is cut with an ellipsis. The options button keeps its room while hidden, so the name never reflows on hover. A box checks or clears a calendar (`onShownChange`); what that changes is the caller's (Bookings: the view only, `cal` in the address).
- Each row's options button ("<name> options") offers Show only this, and is left out on the only calendar shown. With a fine pointer it shows while its row is hovered or holds focus (it stays in the tab order); on touch it always shows.
- Show all follows the list while any calendar is hidden, at its end, so rows never move under the pointer.
- Which calendar takes new bookings is a setting, so it is not here: Settings › Calendars owns it.

## States

All shown; some hidden (Show all at the end); an account folded; one calendar accounts as single rows. Loading, failure and no calendar connected belong to the screen (Skeleton, Callout).

## Keyboard

Tab reaches the label's rows in order: each box, each row's options button, each account's fold. Space checks a box; Enter or Space opens the options menu, the arrows move in it and Escape closes it, focus back on the button.

## Differences from the artifact

Not in the artifact.
