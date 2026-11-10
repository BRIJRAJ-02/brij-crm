BusinessFlow is business booking as one live, full-screen prototype: a salon books services with a person, a restaurant books tables. Built from the system's components and the Bookings shell.

**Use it for**: reviewing business booking end to end (spec 0066), and as the map for the real module. **Don't use it for** one screen; compose the parts it uses.

**The consumer provides**: `initialState` (`lumen()`, the default, or `olive()`, both rebuilt relative to today) and `showDemoMenu`. Wrap it in a `ToastProvider`. State is one reducer (`bizReducer`) in `state.ts`, with the rules: who can do a service, "anyone free" picks whoever has the fewest booked minutes that day (ties by team order), clean-up time after each service, best-fit tables (the smallest free one, else up to three joinable tables in one area), and online table rules (times every, held for, book at least, how far ahead, party size, covers a time).

**How to walk it**: the salon opens on Calendar (a column a person; drag empty time or New appointment), Services (categories, options with length and price, who does it, Online), Team (title, services, usual week) and Business page (link, Publish when nothing blocks it, profile, opening hours). Switch to Olive Kitchen in Demo: Reservations (List or Floor, Confirm → Seat → Finish, Walk in, New booking, online rules behind the gear), Tables (add "T10 to T14", seats, joins neighbours, online). Demo › Your business page books as a guest; coming back drops the booking in with a toast.

**Calm by default**: rarer settings sit behind More options folds or the gear, never as extra rows.
