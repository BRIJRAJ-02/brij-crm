# BookingsView

The live demo's Bookings: the team's week in the library's WeekCalendar, with each booking's MeetingCard a click away.

## Why it exists

The home page's live demo (the owner, 23 October 2026: "build it with the real components", like Twenty's hero). It feeds the library's WeekCalendar and MeetingCard with the demo workspace (`src/live/data.ts`) and keeps only the screen's own state: the picked day and the week. A booking made on the demo's booking page lands here at once.

## Use

```tsx
<BookingsView
  meetings={meetings}
  people={people}
  openId={openId}
  onOpen={setOpenId}
  onOpenPerson={openPerson}
  week={19}
  onWeekChange={setWeek}
/>
```

## States

The week's own (picked day, an open card, keyboard). The previous and next week buttons turn off at the demo's two weeks' ends.
