# DateNav

The date stepper a time grid's bar leads with: Today, previous, next, and Go to date when the screen has a month to open. Bookings' Calendar (week, day and Team day) and Roster (Team week) both draw it inside SectionBar's `start`, with the range as SectionBar's `title`.

## Why it exists

New (the bookings critique, A13, 5 November 2026). The Calendar and the Roster each built their own stepper from Buttons and Tooltips, and they drifted: "Today" on one and "This week" on the other, keys taught on one only, and two formats for the week's dates. Neither SectionBar (the row) nor Button (one control) can hold the order and the tooltips, and there is no closer component to vary, so the three or four buttons became one molecule.

## Use

```tsx
<SectionBar
  variant="bar"
  start={
    <DateNav
      today={{ label: 'Today', hint: 'Go to today', onPress: goToday, kbd: 'T' }}
      previous={{ label: 'Previous week', onPress: back, kbd: 'K' }}
      next={{ label: 'Next week', onPress: on, kbd: 'J' }}
      jump={{ label: 'Go to date', isExpanded, onPress: toggleMonth, ref: jumpRef }}
    />
  }
  title={weekRangeLabel(monday, locale)}
  isTitleQuiet
/>
```

- `today` is a secondary Button, never off once the screen has loaded (`isDisabled` only for a loading bar), so the arrows after it never move under the pointer. Its label can carry the date while another week shows ("Today · 19 Oct").
- `previous` and `next` are ghost icon Buttons with their name in a tooltip, and their key with it when they have one (`ShortcutTooltip`, which also sets `aria-keyshortcuts`). `isDisabled` at the first or last place there is to go.
- `jump` is the Go to date button; the screen draws the Popover and month it opens, with this button as its trigger.
- `weekRangeLabel(monday, locale)` is the one format for a week's dates: "2 – 8 November 2026", short months only across a year.

## States

None of its own: the buttons' (hover, pressed, focus, disabled).

## Keyboard

Tab moves through the buttons in order. The single keys (T, J, K) belong to the screen, which listens for them; DateNav only teaches them.

## Timefix prototype (spec 0072)

Takes its look from the prototype's DateNav (folded into DatePicker, spec 0072): it renders Button and Tooltip (Today, the two steps, Go to date), so its look is theirs and it has no CSS of its own. The prototype's Day, Week and Month switch is the screen's own SegmentedControl beside it.

**Repeats from its replacer**: nothing.

**Differences from the prototype**: the range it moves through is the bar's title (SectionBar's `title`), so the prototype's crossfading `text-heading` label is not drawn here.
