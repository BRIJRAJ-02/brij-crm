# Spec 0037 L10 (managed booking pages) — notes for /architect

Written by the L10 lane. Nothing under `docs/specs/` was touched: spec 0037 lives only on
`origin/docs/0037-amended`, and lanes never edit specs.

## 1. AC-1333's lane table never defines its own criteria

`index.md`'s lane table names "AC-1333 to AC-1336" but does not define them; they are only in
`0037-round-robin.md` lines 55 to 58. Worth a cross reference in `index.md`, since a reader of the lane table alone
cannot find them.

## 2. Which settings each lockable part owns was undefined — decided here

The spec names seven lockable parts (Details, Durations, Location, Questions, On booking, Limits, Hours rule) but
never says which of `BookingPageSettings`' keys each one covers, and the lock is an access rule, so the mapping has
to be exact. `MANAGED_PART_KEYS` in `packages/contracts/src/booking/managed.ts` is the decision:

| Part | Keys |
|---|---|
| `details` | `title`, `description` |
| `durations` | `durations`, `slotStep` |
| `location` | `location` |
| `questions` | `questions` |
| `on_booking` | `fileToCrm`, `answersObjectId` |
| `limits` | `bufferBefore`, `bufferAfter`, `minNoticeMinutes`, `windowDays`, `dailyLimit` |
| `hours` | `scheduleId` |

Deliberately **never lockable**, so they stay the member's own whatever the template says: `slug`,
`profileSection`, `profilePosition`, `showSocials`, `status`, `isPrivate`, `defaultView`, `rescheduleHost`,
`formOnly`. These are the member's address, their place on their own profile, and whether their page is on — a
template that could pause someone's page or move it on their profile would contradict spec 0025's rule that
placement is the owner's alone (`updateBookingPage` already refuses an admin changing it).

## 3. Locked Hours cannot be a copied value (AC-1334 vs AC-1336 vs spec 0035 AC-966)

AC-1334 says saving the template copies its locked parts to every member page. AC-1336 says a member page books on
*that member's own* hours — their default schedule when Hours is locked. Spec 0035 AC-966 refuses a schedule
belonging to anyone else on a page. So the template's `schedule_id` must **never** be copied: it names the template
owner's schedule, which would be refused on every member's page.

Decision: locking `hours` propagates `schedule_id = null` (which already means "follow this page owner's default
schedule"), not the template's value. Unlocked, nothing is propagated and the member's own choice stands. This is
the one locked part whose propagation is not a copy, and the spec should say so.

## 4. The template's own row: paused and private, not just "not bookable"

AC-1333 says the template's public link answers "This page is no longer available". It does not say what the
template row looks like otherwise. Decision: the template is stored `status = 'paused'` and `is_private = true`, so
it is on nobody's profile and in nobody's link page (spec 0051), and the refusal itself is a kind check in
`liveOf`/`readAddressedPage` (`kind === 'managed'`), not a reliance on the status. Both together, so no future change
to one of them makes a template bookable.

## 5. Who may change a template, and who may change who it covers

AC-1333 says `booking.admin` **or a template's editor** makes a managed page. AC-1331 says an editor changes
everything on a resource except its editors, its deletion and, for a page, its owner. AC-1340 says adding a member
needs `booking.admin` or Manage over them.

Decisions taken, which the spec does not state outright:
- `create` and `delete` of a template are `booking.admin`'s alone (a template is the workspace's, not a person's,
  and AC-1331 keeps deletion from editors).
- `update` (settings and locks) is open to `booking.admin` and the template's editors.
- `setMembers` is `booking.admin`'s alone. Reading AC-1340 as "Manage over that member" would let an editor make a
  page in someone else's name under a template they do not own; the stricter reading was taken. If the spec means
  the looser one, this is the line to change.
- A member whose page a template made is **not** by that fact an editor of the template: `getManagedPage` answers
  NOT_FOUND to them, as every other unreachable resource does.

## 6. A template is not refused when a locked part is changed by an admin on a member page

AC-1334 says "a member sees locked parts read only". It does not say what happens when `booking.admin` writes a
locked part directly on a member page. Decision: refused for everyone, with `FORBIDDEN` and
"Your workspace sets this part of the page." A write let through there would be silently undone by the template's
next save, which is worse than a refusal.

## 7. `follow_team_id` is modelled but not driven

AC-1333 allows "a team it follows" as an alternative to chosen members. The column, its `on delete restrict`
foreign key and the read (`wantedMembers` resolves the team's active non guest members) are built, and
`setMembers` is refused on a following template. What is **not** built: reacting to someone joining or leaving the
team, which is how AC-1327 handles the same question for rotations (through the `rotation_roster` view, lane L3b).
A following template therefore makes pages for whoever is in the team at the moment of a save, not continuously.
This needs either a view like `rotation_roster` or a hook on `team_members`, and should be its own slice.

## 8. AC-1341 interacts with removing a member

Removing a member deletes their page (AC-1335). If a published form's rule books that page, AC-1341 refuses the
deletion `ROUTING_IN_USE`. The whole removal is then refused rather than partly applied. The spec does not name
this interaction; refusing wholly is the safe reading, but it means one routed page blocks an unrelated member's
removal from the same save.

## 9. Does a locked page stay live? (from the security review, finding 5) — spec question

`MANAGED_PART_KEYS` deliberately leaves `status`, `isPrivate`, `slug`, `defaultView`, `formOnly` and the profile
placement unlockable (note 2 above). The consequence, which AC-1333 does not address: a member whose page the
workspace made can **pause it, make it private, or move its address**, and the server lets all three through. So the
lock is over the page's *content*, not over its existence.

If "the workspace mandates this page" is the intent, `status` and `isPrivate` need a part of their own. If the
intent is "the workspace sets what the page asks, the member still owns whether they take bookings", the spec should
say so outright. **This lane chose the second reading** and did not invent a part for it.

## 10. Owed follow-ups this lane did not build (from the security review)

Carried here rather than fixed, so they are not lost:

- **Per owner audit and notice on propagation and removal.** `updateBookingPage` writes a `booking_page.changed_for`
  row and queues the owner's notice whenever someone else changes their page (AC-1263, AC-1264). `propagateLocked`
  and `removePagesOf` write one aggregate `managed_page.changed` row on the template instead, so the audit log does
  not say that page X of member Y was changed or deleted. Needs one `booking_page.changed_for` row per affected
  owner inside the same transaction.
- **The live page wall check is not run on propagation.** `updateBookingPage` refuses an edit that takes away the
  required question filling a required field (`checkNoNewWall`, `checkPageCanGoLive`). A locked `questions` change
  propagated to 200 live member pages skips that check and can wall every one of them. The template's own save is
  checked; the member pages' are not.
- **Batching.** `makePagesFor` calls `freeSlug` and `nextProfilePosition` per member and `removePagesOf` calls
  `checkNotRouted` per page, inside a transaction holding the template's row lock: a 200 member template is several
  hundred round trips. Only the locked propagation is the single statement AC-1334's performance note demands.
  `listManagedPages` is N+1 in the same way.
- **The template consumes its owner's slug namespace**, so the admin who created `intro-call` can never have a real
  page of their own at that address.
