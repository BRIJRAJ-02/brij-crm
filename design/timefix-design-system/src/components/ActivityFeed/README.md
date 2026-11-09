A record's timeline: what happened, newest first, grouped by day.

**Use it for**: the Activity tab of a record and the activity section of a meeting or booking. **Don't** use it for a workspace audit log (a Table) or for notifications (NotificationList).

**The consumer provides**: `events` newest first, each with `at` (a Date), `actor` and a kind: `change` (one or more attribute changes, drawn with each attribute's own display, so a stage reads "Lead → Qualified" in its tags), `created`, `booked` and `cancelled` (with the meeting's `when`), `emailed`, `note`, `comment`. Plus `older` for the "Show n older" fold, `freshIds` for live arrivals, and `hour12` (default) or 24-hour. The feed words every date itself: day headings through `relativeDayLabel` (Today, Yesterday, Mon 3 Nov), times through `formatClock` (2:05 PM), older items through `formatDate`, meetings as "Thu 13 Nov, 2:00 PM".

**States**: one change, several changes (first shown, "Show all n changes" pill), comment inline as a grey card, email with a two-line preview, meetings with a blue calendar well (blue marks time), empty day groups never render.

**Interaction**: new events drop in at the top: the row opens from 0 height and rises 12px into place (250ms). "Show all changes" and "Show n older" fold open on the measured height with a 2px blur (accordion), and their labels flip to Hide.

**Replaces**: ActivityFeed, BookingChanges.
