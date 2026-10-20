# VisitorBar

The bar on top of a booking page (spec 0028, AC-720 to AC-726). A visitor we don't know is asked to connect their calendar ("See when you're both free", with what it reads and Connect calendar with Google's mark). A visitor we know (signed in to Timefix, or the Google account they connected) sees who they're booking as, whether their calendar is laid over the times, Show all times, and Not you.

## Why it exists

New. Callout says something about the page in a tone (info, warning, danger) and goes when the state goes; this bar is the visitor's own standing control, there for the whole visit, holding a person, a switch and a link out. BookingFrame's `banner` slot holds it.

## Use

```tsx
<BookingFrame banner={<VisitorBar connectHref={client.connectUrl(key, path)} />} … />
<VisitorBar person={{ name: 'Ada Lovelace', email: 'ada@example.com' }} calendar="on" showAll={showAll} onShowAllChange={setShowAll} onNotYou={forget} />
```

## States

- Unknown visitor: the calendar tile, the invitation, Connect calendar. With no `connectHref` the page leaves the bar out.
- `on`: "Showing times you're both free", or with Show all times on, "Showing all times, yours that clash marked busy".
- `none`: "Booking as Ada" and their email.
- `unreachable`: "Couldn't read your calendar. Showing all times.", with Connect again for a guest (`connectHref`).
- `needs-reconnect`: asks them to reconnect it in Timefix.
- Not you, hover, focus, pressed (from Button, ButtonLink and Switch).

The words sit in a polite status region, so turning Show all times on is said.

## Keyboard

Tab reaches Show all times, Connect calendar and Not you, in that order; Space toggles the switch, Enter follows or presses.

## Layout

One line in a wide card (the person, the words, then the controls at the end); under 480px of its own width the controls drop under the words.

## Differences from the artifact

Not in the artifact.
