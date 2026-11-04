# BookingPagePicture

A booking page in miniature, for LinkCard's `picture` on the booking pages list (Captures › Links): the page's mark, title and lengths over a month whose open days are tinted in the page's colour, one of them picked.

## Why it exists

New on 5 November 2026. The owner asked for the forms list's cards to "look much prettier", then for the booking pages list to wear the same card. A form's card draws its own form through `HostedFormPreview size="thumbnail"`; a booking page needed a picture of its own, and nothing in the library drew one small:

- BookingFrame and the public booking page draw the real thing, with slots read from the server and a whole page's chrome: far too much for a card, and they would read slots for every card in the list.
- MonthTiles and MonthCalendar are controls, with focus, labels and dates; a picture must be inert and say nothing.
- FormLayoutThumbnail draws forms' shapes, not a calendar.

So it is a drawing, not a control: shapes and the page's own words only, with no dates and no reads. The month's open days come from the page's own weekly hours, so a weekdays page and a weekends page look different, as their real pages do.

Reference (Mobbin, 5 November 2026): Calendly's and Cal.com's date pickers, a month of days with the bookable ones tinted.

## Use

```tsx
<LinkCard
  …
  picture={
    <BookingPagePicture
      title={page.title}
      lengths="30 or 60 min"
      openDays={[true, true, true, true, true, false, false]}
      hue={linkHue(page.id)}
    />
  }
/>
```

- **`title`** and **`lengths`:** the page's words, each on one line, cut when long.
- **`openDays`:** seven booleans, Monday first, from the page's schedule's weekly hours. A day not open draws as a faint square.
- **`hue`:** the page's colour, the same one its LinkCard's dot takes (`linkHue(page.id)`): its mark, its open days (30% over the sheet) and the picked day.

## States

Weekdays open; every day open; no day open (a page whose hours are empty: every square faint, nothing picked); a long title (cut); each hue. It never moves, so hover, focus and pressed belong to the card around it.

## Keyboard

None: it is a picture inside LinkCard's stage, hidden from assistive tech and inert. The card's title names the page.

## Differences from the artifact

Not in the artifact yet.
