BookingFlow is the public booking card a guest opens once, usually on a phone: pick a day, pick a time, add details, and land on "You're booked".

**Use it for**: every public booking page (one-on-one, team, round robin). **Don't use it for** booking inside the app for someone else; that is a dialog with the same parts.

**The consumer provides**: `host` (name, optional photo), `title`, `durationMinutes`, `location` (video, phone or place, with a label), `today`, `isDayOpen(date)`, `slotsFor(date)` as minutes from midnight, `timeZones` and `defaultTimeZone`, and `onBook(request)`, a promise. Nothing inside fetches.

**States**: month days are rounded-square tiles: open days soft blue with blue numbers, closed days quiet text, today a small dot under its number, the chosen day solid accent, and a nearly full day (1 to 3 times left) carries the count on its corner (read out as "2 times left"). A picked time splits into the grey time and an ink Next. The chosen moment reads "Monday 9 November, 9:30 – 10:00 AM" (`formatLongDay` and `formatClockRange`). Details are the shared `TextField` and `TextArea` at `lg`, validating on Book (empty name, bad email, with a shake); a rejected booking keeps the guest there with a plain message. Booked shows a check, two lines, a summary and Add to calendar buttons.

**Interaction**: arrows move through the month, Page Up and Page Down change month, Enter picks. The month slides 8px with a 3px blur the way the arrows went; the steps slide side by side (transitions.dev page side-by-side) while the card eases to the new height (card resize). Presses ease to 0.97. The time zone row opens the shared Menu; the pick ticks, then it closes 120ms later. 12h/24h is a sliding segmented pill. The booked moment runs the success check (rotate, blur, bob, draw), then the texts reveal with a 40ms stagger. Focus follows each step.

**Replaces**: BookingFrame, MonthTiles, SlotList, BookingDetails, BookingReceipt and the public-booking page parts.
