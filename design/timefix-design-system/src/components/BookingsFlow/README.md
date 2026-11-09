BookingsFlow is the whole Bookings module as one live, full-screen prototype over a dummy team: Meetings, Pages, Availability and Routing, plus the guest's side, built only from the system's components.

**Use it for**: reviewing every booking feature end to end, and as the map for building the real module. **Don't use it for** one screen; compose the parts it uses.

**The consumer provides**: `initialState` (`NORTHWIND`, the default, rebuilt relative to today; or `FIRST_VISIT`) and `showDemoMenu`. Wrap it in a `ToastProvider`; the root fills its parent's height. State is one reducer (`bookingsReducer`, typed `BookingsAction`s) in `state.ts`; the seed is `seed.ts`; screens live in `meetings.tsx`, `drawer.tsx`, `pages.tsx`, `editor.tsx`, `create.tsx`, `share.tsx`, `availability.tsx`, `routing.tsx` and `guest.tsx`.

**How to walk it**: Meetings opens on Northwind: List / Week / Team day, Mine / Everyone / a person, Upcoming / Past / Cancelled, "Needs your OK" with Confirm and Decline, a clash card (See conflict opens Week at that hour), New meeting, and drag on empty time in Week or Team day to block, hold or book. Open a row for the drawer (Join, Reschedule, Cancel with Undo, Reassign, no-show, notes, Link to record). Pages has Mine / Team rows with Share (Offer specific times, One-time links, Embed) and the editor (stats, Basics, When, Who with round robin and Manage groups, Questions, After booking, Look). Availability holds saved hours, time off, calendars and the team week. Routing tests rules. The Demo menu starts fresh (brief steps 1 to 3: the Create sheet), plays the edge cases, and the guest scenarios (step 6; closing one plays step 7 on the host side).

**Interaction**: keyboard throughout (Tab, arrows, Enter, Esc; ⌘↵ creates, ⌘S saves). Motion: modal, page side-by-side, card resize, accordion, text morph and soft swap, rows dropping in with a wash, Undo toasts.

**Replaces**: BookingsScreen, BookingsTabs, BookingsTopBar, PageEditor, NewPageDialog, LinksScreen, SharingPanel, ShareTimesCard, EmbedCard, OneOffLinksCard, AvailabilityScreen, TeamWeekScreen, TeamDayView.
