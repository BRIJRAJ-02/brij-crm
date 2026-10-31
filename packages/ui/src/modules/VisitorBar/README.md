# VisitorBar

The visitor's tag on top of a booking page (spec 0028, AC-720 to AC-726): small, at the end of the row above the card (the owner, 20 October 2026: "a bit small instead of a whole bar on top", "top right"). A visitor we don't know gets Connect calendar with Google's mark; its tooltip says what it reads. A visitor we know gets their name and their calendar's state ("Ada Lovelace · Both free"), which opens a menu: who they're booking as, Show all times, Connect again (a guest whose calendar couldn't be read) and Not you.

## Why it exists

New. Callout says something about the page in a tone and goes when the state goes; this is the visitor's own standing control for the whole visit. It is built from the library's Button, ButtonLink, Tooltip and Menu; its stylesheet only places the control at the row's end, holds its space while loading and fades it in. BookingFrame's `banner` slot holds it.

With a `match`, the same small link opens Match with your calendar (MatchCalendar) first, rather than leaving for Google at once. Since spec 0058 (AC-24, 31 October 2026) it stays a quiet secondary action (Button's `ghost` look with Google's mark, at the body's size: the `link` look's label size read as too faint beside the page, 31 October 2026) at the row's end whichever way it goes: booking is the page's one ask. A visitor we know keeps their small tag, and the same dialog is the first item in its menu ("See matching times" once their calendar is on, "Match with your calendar" before that); it takes the place of Connect your calendar again, since the dialog says what it reads before it leaves for Google.

## Use

```tsx
<BookingFrame banner={<VisitorBar connectHref={client.connectUrl(key, path)} />} … />
<VisitorBar person={{ name: 'Ada Lovelace', email: 'ada@example.com' }} calendar="on" showAll={showAll} onShowAllChange={setShowAll} onNotYou={forget} />
```

## States

- Loading (`isLoading`): a Skeleton in the tag's space, so the page doesn't jump when it fills.
- Unknown visitor: Connect your calendar, a small link. With no `connectHref` nothing is drawn. With a `match`, the same link opens the dialog.
- `on`: "· Both free", or with Show all times on, "· All times".
- `none`: their name alone.
- `unreachable`: "· Calendar unavailable", with Connect again in the menu for a guest.
- `needs-reconnect`: "· Reconnect calendar"; the status says where (Settings, then Calendar).
- Hover, focus, pressed and open come from Button and Menu.

A visually hidden status says the state in a sentence as it changes ("Showing all times. Busy ones are marked."), never who you are again. Not you moves focus to Connect calendar, or to the tag's place.

## Keyboard

Tab reaches the tag; Enter, Space or Down opens the menu; the arrows move; Enter chooses; Escape closes.

## Differences from the artifact

Not in the artifact.
