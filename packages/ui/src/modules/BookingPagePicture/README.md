# BookingPagePicture

A booking page in miniature, for LinkCard's `picture` on the booking pages list (Captures › Links): the page's mark, title and lengths over a week whose open days wear the page's colour, the first of them picked.

## Why it exists

New on 5 November 2026. The owner asked for the forms list's cards to "look much prettier", then for the booking pages list to wear the same card. A form's card draws its own form through `HostedFormPreview size="thumbnail"`; a booking page needed a picture of its own, and nothing in the library drew one small:

- BookingFrame and the public booking page draw the real thing, with slots read from the server and a whole page's chrome: far too much for a card, and they would read slots for every card in the list.
- MonthTiles and MonthCalendar are controls, with focus, labels and dates; a picture must be inert and say nothing.
- FormLayoutThumbnail draws forms' shapes, not a calendar.

So it is a drawing, not a control: shapes and the page's own words only, with no dates and no reads. The week's open days come from the page's own weekly hours, so a weekdays page and a weekends page look different, as their real pages do.

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
- **`openDays`:** seven booleans, Monday first, from the page's schedule's weekly hours. A day not open draws as its letter alone, quiet.
- **`hue`:** the page's colour, the same one its LinkCard's dot takes (`linkHue(page.id)`): its mark, its open days (the hue's tag ground and text) and the picked day (the two swapped).

## States

Weekdays open; every day open; weekends only (Saturday picked); no day open (a page whose hours are empty: every day quiet, nothing picked); a long title (cut); each hue. It never moves, so hover, focus and pressed belong to the card around it.

## Keyboard

None: it is a picture inside LinkCard's stage, hidden from assistive tech and inert. The card's title names the page.

## Differences from the artifact

Not in the artifact yet.

## Timefix prototype (spec 0072)

Takes its look from the prototype's BookingPagePicture, on the sheet LinkCard already draws (the prototype's white sheet with its `radius-md` top corners and `border-subtle` edge on the `surface-subtle` ground): a `space-12` inset with `space-16` at the foot; the head is the page's mark (a `size-icon-lg` circle in `dot-<hue>`) `space-6` from its title (`text-body-sm-strong`) over its lengths (`text-caption`, `text-secondary`), each cut on one line; `space-8` under it a week of seven days `space-4` apart, Monday first, each a `radius-sm` square holding its letter in `text-kbd` (the reader's language's narrow weekday, from the provider): closed in `text-tertiary`, open on `tag-<hue>-bg` in `tag-<hue>-text`, and the first open day picked, the two swapped. It never moves, takes no focus and says nothing.

**Use it for** LinkCard's picture on the booking pages list, and the page in EmbedPreview's box. **Don't use it for** the real page (BookingFrame) or a form (FormPicture).

**The consumer provides** `title`, `lengths` (already worded), `openDays` (seven booleans, Monday first) and `hue`.

**States**: weekdays, every day, weekends, no day open, a long title, each hue.

**Differences from the prototype**
- No host's face or name: the library takes no `host` (a new prop is owed to the screen phase that wants it); the page's mark stands in the face's place, beside the title and lengths rather than over them.
- The picked day is the hue's tag text on its tag ground, not white on its dot colour, which reads under 4.5:1 on the light hues (yellow, lime, sky).
- The lengths are `text-caption` (12px) where the prototype writes 11px regular, which no type token draws.
- The week replaces the month the library drew before (a month of dots, one picked near its middle): the prototype's picture, the same `openDays`.
- The card around it (BookingPageCard: the switch, Copy link, the menu, Hidden greying the picture) is LinkCard's.
