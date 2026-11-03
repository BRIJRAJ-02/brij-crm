# Table seating (spec 0066 B7 lite)

The staff side of table reservations, behind the Hospitality section's Reservations and Service pages while Table
seating is installed. Both read through `data.tables` (the setup and each day) and `data.hospitality` (the places
and their tables); nothing here calls the network.

| Screen                   | Brief                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ReservationsScreen.tsx` | Set up a place's reservations and publish its page: the checklist (hours, tables, rules, Publish), checklabs' "Online booking" rules as settings sections with the defaults filled in, Publish refusing a broken page with its one line fix and a link to it, and the page's link on the public origin (`/r/<key>`, never the app's).                                                  |
| `ServiceScreen.tsx`      | Run the evening: one place's day as a list (time, guest, party, table, status; Seat, Finish, No show and Cancel, the last two asking first; Undo for 10 seconds) or a floor of table tiles (free, booked soon, seated with its timer, needs attention 15 minutes past a booking), covers counted. Live through the `visits` change event, and every minute where live updates are off. |

The guest's side is `src/public/reserve/` (its own bundle, `reserve.html`).
