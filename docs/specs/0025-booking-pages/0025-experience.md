# 0025. Booking pages: the experience (visitor, guest, host)

**Date**: 2026-10-19
**Status**: Proposed (asked for by the owner on 19 October 2026: keep the booking design of their earlier scheduling product)

## Summary

How a booking page looks and behaves for the visitor who books, the guest who later changes the booking, and the member who sets it up. It follows a design proven in production in the owner's earlier product: a calm two column page, a month calendar with times beside it, one commit bar, a short details step, and a guest page that can move, add guests or cancel without an account. The data, slot and no double booking rules in [index.md](index.md) still hold; this file decides the screens, interactions and copy. Where they differ, this file wins. Look comes from our tokens; where the earlier product had its own sizes, the nearest token is used.

## The visitor's booking page (`/b/<publicKey>`)

### Layout

- A page on the ground colour, content at most 66rem wide, an optional cover image on top.
- **Wide screens**: a sticky left rail (15rem) with the host's avatar, name and title; a **What** row (the page title and a location icon: video, pin or phone); the **time zone** row; the workspace's name and a quiet "Made with" line at the rail's foot. On the right: the page headline, then the booking card.
- **Phone**: everything stacks; the rail facts sit above the card; the footer moves to the page's end. 16px text so phones never zoom, gutters 16px.
- The length is said in the title and in each time's accessible name; there is no separate duration row. A page with several durations shows them as a SegmentedControl above the calendar ("15 min · 30 min · 60 min").
- On entry the rail, headline and card rise in with a short stagger (0, 60, 120 ms; reduced motion: fade only). Once the visitor reaches details, the headline steps back so the form has the stage.

### Step 1: Choose a time

- Heading "Choose a time", with a **Month · List** switch on the right. Month is the default; the visitor's last choice is remembered on that browser.
- **Month view**: a 7 column grid (week starts on the locale's first day), with previous and next arrows that are disabled outside the first and last month with openings; swipe moves months on touch.
  - Days with no times are disabled, named "…, no times". Today carries a dot. The chosen day is filled with the primary colour.
  - Beside the grid (below it on a phone), an 18rem times column headed by the day ("Mon 17 Aug") and a **12h · 24h** switch. The column is no taller than the calendar and scrolls inside, with a soft fade at its foot.
- **List view**: a horizontal strip of chips for days that have openings only (weekday over date), above a grid of times: 2 columns on a phone, 3 on a wide phone, 4 on desktop.
- **The first open day is chosen on arrival**, so times show at once.
- **Times** are 44px tall buttons with tabular numbers. Chosen: primary border and a faint primary fill. Picking a time does not move on.
- **Commit bar**: a full width pill under the times, always visible, disabled until a time is picked. It reads "Book" and then "Book 9:30 AM" (the label crossfades on each new time). Only the bar moves to details.
- **Time zone**: defaults to the browser's, shown in the rail as "Dubai time (GMT+4)". Pressing it opens a searchable list ("Search city or GMT offset"); arrows move, Enter picks, Esc closes, focus returns to the row. 12h or 24h defaults from the locale and is remembered. Changing either regroups the times by day in that zone at once.

### Step 2: Your details

- Header row: a back arrow named "Change time", the slot ("Tue, Aug 19, 9:30 AM") and the zone under it. Back returns focus to the chosen day.
- Fields, labels above: **Your name**, **Email** (placeholder "you@example.com") with **+ Add guest** beside it (each guest one more email row, up to 10), the host's questions (forms answer types and cards, [0023-experience.md](../0023-forms/0023-experience.md); "optional" after optional labels), then **Anything else the host should know?** (optional).
- **Prefill**: arriving from a form (the signed hand off) fills name and email, still editable, with the line "Booking as Asha. Not you?"; "Not you?" clears both.
- A legal line in small text: "By booking you agree to {workspace}'s terms and privacy policy." with links only when the workspace has set them.
- Button **Confirm booking**, then "Booking…" while sending.
- **Errors** sit in one reserved line above the button (`aria-live`), so the button never moves: "Someone just took that time. Pick another.", "That time is no longer available. Pick another.", "Too many attempts just now. Wait a moment and try again.", "This page isn't taking bookings any more." A taken time sends the visitor back to step 1 with the day kept and the times refreshed.
- On success the visitor lands on the guest page with the welcome state.

### States

- Loading: a skeleton the size of the month view and its commit bar, so nothing jumps.
- No times at all: "No open times in the next two months." and "Check back soon."
- Host calendar unreachable (fail closed, index.md): "{Name} can't show times right now. Their calendar is temporarily unreachable. Try again shortly."
- Paused: "Nothing is bookable here right now."
- Not found: a plain 404 with no workspace details.

### Keyboard, announcements and motion

- Month grid: one day is tabbable; arrows move between open days only, Up and Down jump a week, Home and End go to the first and last open day of the month.
- A status line announces "6 times on Mon 17 Aug" when the day changes.
- The card's height eases when its content changes; the pick and details swap fades with a small rise; times stagger in when the day changes; buttons scale to 0.97 on press. On a phone, choosing a day scrolls its times into view, and picking a time scrolls the commit bar into view. Reduced motion keeps fades only.

## The guest page (`/b/<publicKey>/manage?t=<token>`)

The manage token (index.md) is the only key; no account. Destructive actions always confirm, so a mail scanner opening the link changes nothing.

- **Title by state**: "You're booked" (on arrival from booking), "Your booking", "This booking was cancelled", "This booking has passed", with a state mark (Confirmed, Cancelled, Finished).
- **Time card**: a date block (weekday, day, month), the time range, "Thursday, 20 August 2026 · Dubai time", and a relative line ("Tomorrow morning", "In 3 minutes").
- **Facts**: What, Who (the host marked), Where (the video link or address), Your note.
- **Add to calendar**: Google, Outlook, Apple / .ics.
- **Need a change?**
  - **Move to another time** opens the same picker under "Pick a new time" with "Times in Dubai time"; the bar reads "Move to 2:00 PM on Thu 20 Aug", then "Moving…". Empty: "{Host} has no free times in the next three weeks. Cancelling and booking again later may be easier."
  - **Add guests** ("Guests (2)" once there are some): email rows and **Send invitations**; the result line "Invited 2 people." or "They were already on it."
  - "Can't make it at all? **Cancel booking**" opens a confirm: "Cancel this booking?", "{Host} will be told and it comes off both calendars. You can always book again afterwards.", **Yes, cancel it** and **Keep it**.
- **Done**: "Cancelled." or "Moved." with "Both calendars are updated and a confirmation is on its way."
- Errors: "That time has just gone. Pick another.", "That meeting has already happened, so it can no longer be cancelled."
- Rate limits: 20 a minute per address and 8 a minute per booking on cancel, move and guests.
- Add guests needs one more public endpoint beside cancel and reschedule: `POST /api/public/booking/manage/:token/guests` (`emails[]`, at most 10 in all), which adds them to the calendar event and sends each an invitation.

## The host's builder (Settings, Booking pages)

### The list

- Rows, not a table: the page's title, a "Private" tag when unlisted, the address (`/b/…`), chips for durations, custom hours and a non video location, and a **Copy link** button that also opens in a new tab from its menu.
- Row menu: **Visibility** (Public: on your page; Unlisted: link only; Off: the link stops working), Duplicate, Hours, Delete ("The link stops working. This cannot be undone.").
- **New booking page** opens a side Panel, "Add a booking page": Title (placeholder "Quick chat"), Address (suggested from the title), **Duration** as chips (15, 30, 45, 60, 90, more than one allowed), **Hours** ("Same as my hours", "Any time", "Custom"), and a **Make it private** Switch. **Continue** ("Creating…") opens the page's editor; Esc closes.

### The editor

- Two columns: the editor on the left (at most 52rem) and a sticky 24rem preview on the right, with a **Phone · Tablet · Desktop** switch that changes the preview's width. Pressing a region of the preview (cover, details, headline, booking card) outlines it and scrolls the editor to its group. Below the width where both fit, the preview moves under a "Show preview" Disclosure.
- Groups, all on one scroll, each a Card:
  - **Page**: Headline, Your name, Your photo, the address.
  - **Meeting**: Title, Durations, Location (Video, In person with "Address or room", Phone with "Number to call").
  - **Hours** (`id="hours"`), below.
  - **Limits**: buffer before and after, minimum notice, how far ahead, a daily limit. (The earlier product had these with no screen; ours shows them, closed in a Disclosure by default.)
  - **Questions**: "Questions for {title}". Name, Email and Notes are fixed rows marked Required or Optional. Custom questions use the forms question cards and answer types; Where it goes files an answer on the person.
  - **On booking**: the deal step from index.md.
- **Saving**: each group saves on its own. A sticky "Unsaved changes" bar with **Save** ("Saving…") appears only while something is unsaved, and leaving with unsaved changes asks first. A Live or Paused Switch sits in the header.

### Weekly hours and days off

- A time zone Select at the top (the member's zone by default).
- **All days start** and **All days end** Selects at the top, showing "Mixed" when days differ.
- One row per day: an on/off Switch, then start and end Selects on a 30 minute step ("Midnight" as the last end). **+** adds another window on that day, **−** removes one. **Copy times to** opens a Popover listing the days with "Select all" and **Apply**.
- A secondary page can **Follow my hours** (the inherited week shown read only) or use **Own hours**.
- **Days off**: "{n} upcoming days are closed, whatever your weekly hours say." Each with **Open this day**. **Add a day off** picks a date (or every week on that weekday) with "Why? (only you see this)".

## Acceptance criteria added (AC-665 to AC-680)

- **AC-665**: The first open day is chosen on arrival and its times show at once.
- **AC-666**: Month and List views both exist; the choice is remembered on that browser.
- **AC-667**: Picking a time never moves on; only the commit bar does, and it names the time.
- **AC-668**: Changing the time zone or 12h/24h regroups every time at once.
- **AC-669**: The month grid works by keyboard as specified, with one tabbable day, and announces the day's count.
- **AC-670**: Details show the slot with Change time; going back keeps the day and returns focus to it.
- **AC-671**: A prefilled visitor sees "Booking as {name}. Not you?", and Not you clears both fields.
- **AC-672**: Booking errors appear in a fixed line above the button; a taken time returns to step 1 with fresh times.
- **AC-673**: Loading, no times, unreachable calendar, paused and not found each have their state as written.
- **AC-674**: The guest page shows the title by state, the time card, the facts and Add to calendar.
- **AC-675**: Move to another time uses the same picker and updates both calendars.
- **AC-676**: Add guests invites new addresses only and says how many.
- **AC-677**: Cancel always confirms first.
- **AC-678**: New booking page opens a side panel with title, address, durations, hours and private, then the editor.
- **AC-679**: The editor's preview follows the edits, switches width, and pressing a region scrolls to its group.
- **AC-680**: Weekly hours support several windows a day, all days start and end, Copy times to, and days off.

## Left out on purpose

The earlier product's chat assistant above the booking card, the overlay of a signed in visitor's own calendar, and the "claim a link of your own" prompt after booking: none fit a CRM's booking page.
