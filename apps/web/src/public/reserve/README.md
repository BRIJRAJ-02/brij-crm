# The reservation page (spec 0066 B7 lite)

`/r/<key>` and `/r/<key>/manage` on the public origin (timefix.com), loaded from `reserve.html` so a guest never
downloads the app. Built on `@crm/ui/public-booking`, as the booking page is.

| File                    | Brief                                                                                                                                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ReservePage.tsx`       | Party (ChoiceChips), then a day (MonthTiles, closed days crossed out) and a time (SlotList, Lunch and Dinner on the restaurant's clock), then BookingDetails (name, email, phone, note, occasion, news and offers unticked; no invites). A time taken meanwhile comes back with the next free times. |
| `ManageReservation.tsx` | The guest's reservation (BookingReceipt): by the link's token (in the fragment) or by the code with the email; Add to calendar, change time and party (BookingChanges' Move with the page's own picker) and cancel within the cutoffs, else the restaurant's phone.                                  |
| `days.ts`               | The pure helpers: open days, Lunch and Dinner, labels on the place's clock.                                                                                                                                                                                                                          |
| `main.tsx`              | The entry: the provider, the embed's height, and the move to the manage address once reserved.                                                                                                                                                                                                       |
