# CalendarList

The member's calendars by account, as Google Calendar lists them beside its grid: the Bookings calendars panel (spec 0024 milestone 5, the owner's ask of 21 October 2026).

## Why it exists

New. Nothing in the library lists checkable items under folding headings with a per row menu. It composes Disclosure (each account, with its provider's mark in `leading`), Checkbox (each calendar, in its `hue`), Badge (Default) and a MenuTrigger per row, so every part keeps the library's look and keys.

## Use

```tsx
<CalendarList
  accounts={[{ id, provider: 'google-calendar', email: 'ada@acme.dev', calendars: [{ id, name: 'Team', hue: 'green', isShown: true, isDefault: false, canBeDefault: true }] }]}
  onShownChange={(id, isShown) => …}
  onShowOnly={(id) => …}
  onShowAll={() => …}
  onMakeDefault={(id) => …}
/>
```

- A box checks or clears a calendar (`onShownChange`); what that changes is the caller's (Bookings: the view only, `cal` in the address).
- Each row's options button ("<name> options") offers Show only this (unless it is the only one shown) and, when `onMakeDefault` is given and the calendar can take bookings and isn't the default, Make default. Left out, nobody may move the default.
- Default (a Badge read as "Default calendar, new bookings go here") marks where new bookings go.
- Show all follows the list while any calendar is hidden, at its end, so rows never move under the pointer.
- The options button is always shown, for touch.

## States

All shown; some hidden (Show all at the end); an account folded; Default on one; Make default offered or not (read only calendars never offer it). Loading, failure and no calendar connected belong to the screen (Skeleton, Callout).

## Keyboard

Tab reaches each account's fold, each box and each row's options button in order; Space checks a box; Enter or Space opens the options menu, the arrows move in it and Escape closes it, focus back on the button.

## Differences from the artifact

Not in the artifact.
