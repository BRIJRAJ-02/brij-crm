# BookView

The live demo's booking page: Maya's intro call as a visitor sees it, drawn with the library's MonthTiles, SlotList, Field and Button.

## Why it exists

The home page's live demo, built from the real components (the owner, 23 October 2026). Picking a day and a time and pressing Book adds the meeting to the demo's Bookings and the guest to its People, at once, which is the product's promise ("every booking lands in your CRM") played out in front of the visitor. Not the library's BookingFrame: that frame is a whole page (a window's height, the window's breakpoints), not a panel inside a hero.

## Use

```tsx
<BookView meetings={meetings} onBook={({ name, dayKey, startMinute }) => book(name, dayKey, startMinute)} />
```

## States

Days with no free time are off in the month. A taken time leaves the list. Book is off until a time is picked and a name is typed, and says which time it will book.
