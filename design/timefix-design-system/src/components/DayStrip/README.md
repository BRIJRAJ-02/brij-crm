DayStrip is a horizontal row of days for choosing which day a list or a day view shows.

**Use it for**: the top of a phone day view, the Meetings list's day jump, a team day page. **Don't use it for** picking a date far away (a calendar) or for tabs that are not days.

**The consumer provides**: `days` (id, weekday, date, a full label for screen readers, `count` of meetings, `isToday`), `value` and `onChange`, and optional `onPrevious` / `onNext` to move a week.

**States**: rest (grey weekday and number), hover (soft wash, number darkens), selected (a white pill, number in ink), today (weekday reads "Today" and both lines are blue). Up to three dots show how busy a day is; they turn blue on the selected day. A day with no meetings has no dots.

**Interaction**: it is a radio group, so Tab enters it and arrow keys move the choice. The white pill is measured and slides to the new day over 250ms with the smooth-out ease (transitions.dev tabs sliding); a resize snaps it without sliding. Moving a week slides the pill to that week's first day.

**Replaces**: DayStrip.
