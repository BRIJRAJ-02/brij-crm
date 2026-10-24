# VisitorBar

The visitor's tag on top of a booking page (spec 0028, AC-720 to AC-726): small, at the end of the row above the card (the owner, 20 October 2026: "a bit small instead of a whole bar on top", "top right"). A visitor we don't know gets Connect calendar with Google's mark; its tooltip says what it reads. A visitor we know gets their name and their calendar's state ("Ada Lovelace · Both free"), which opens a menu: who they're booking as, Show all times, Connect again (a guest whose calendar couldn't be read) and Not you.

## Why it exists

New. Callout says something about the page in a tone and goes when the state goes; this is the visitor's own standing control for the whole visit. It is built from the library's Button, ButtonLink, Tooltip and Menu; its stylesheet only places the control at the row's end, holds its space while loading and fades it in. BookingFrame's `banner` slot holds it.

With a `match`, the small link gives way to Match with your calendar (MatchCalendar, 25 October 2026): the row's width, the page's one ask of a visitor we don't know. A visitor we know keeps their small tag, and the same dialog is the first item in its menu ("See matching times" once their calendar is on, "Match with your calendar" before that); it takes the place of Connect your calendar again, since the dialog says what it reads before it leaves for Google.

## Use

```tsx
<BookingFrame banner={<VisitorBar connectHref={client.connectUrl(key, path)} />} … />
<VisitorBar person={{ name: 'Ada Lovelace', email: 'ada@example.com' }} calendar="on" showAll={showAll} onShowAllChange={setShowAll} onNotYou={forget} />
```

## States

- Loading (`isLoading`): a Skeleton in the tag's space, so the page doesn't jump when it fills. With `holdsMatch`, it holds Match with your calendar's own box instead, which is what the page asks for on a page whose visitor will be offered it.
- Unknown visitor: Connect calendar. With no `connectHref` nothing is drawn. With a `match`, Match with your calendar in its place, the row's width.
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
