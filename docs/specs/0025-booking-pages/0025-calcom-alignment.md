# 0025 · Booking pages: the Cal.com alignment

**Status**: Proposed
**Date**: 2026-10-19

The owner asked on 19 October 2026 to study Cal.com (through Mobbin) and align the booking pages, availability and bookings screens to it. This file is the study, kept as the design target. Where it differs from `0025-experience.md`, this file wins for layout and interaction; the experience file still owns the contract and the acceptance criteria.

Calls made with it:

- Cal.com's layouts and density, in Timefix's tokens: the one blue marks the primary action and the selection, never Cal.com's black.
- Bookings tabs start as Upcoming, Past and Canceled. Unconfirmed and Recurring arrive with the features that make them.
- Settings and the theme switch move into the Settings area, spec 0026.

## The study

Mobbin covers Cal.com's web app well; Calendly, SavvyCal, Linear and Attio fill gaps. Cal.com is monochrome. Keep its layouts and density, but use Timefix's blue for the primary action and selection.

### Patterns shared by the host app

- **Page header:** an 18px semibold title with a one-line muted subtitle ("Create events to share for people to book on your calendar.") and "+ New" at the top right. Content is one bordered card with 1px row dividers.
- **Detail header:** a back arrow, then the name, with a muted live summary under it ("Mon - Fri, 9:00 AM - 5:00 PM"). On the right: a toggle, icon buttons, delete, then **Save**, separated by thin vertical rules.
- **Dialogs:** centred, about 480px wide. Title and muted subtitle, then the fields. A grey footer strip holds a ghost "Cancel" and the primary button.
- **Save:** disabled until something changes. Confirm with a small toast at the bottom centre, with a check and an ×: "Event type updated successfully".

### 1. The visitor's booking page

The page is one card, about 880 × 340px, centred on a tinted background, split into three columns.

- **Facts, about 28%:** a 24px host avatar (stacked avatars for a team), the host name muted, and the title in 20px semibold. The description is clamped to about 6 lines. Below it, icon rows: duration, location ("2 location options") and time zone ("America/Los Angeles ▾").
- **Month, about 44%:**
  - The header reads "**April** 2025", with the year muted and chevrons on the right.
  - Weekday labels are small, spaced capitals ("SUN MON").
  - Available days are filled grey squares, about 40px with a 4px radius. Unavailable days are bare, muted numbers.
  - The selected day is solid blue. Today gets a dot under its number.
- **Slots, about 28%:** a "Thu 01" header with a **12h | 24h** segmented control. Below it, a scrolling list of outlined buttons, about 32px tall, each with a green dot and the time ("9:00am").

**Duration and views.** When an event has several durations, a segmented pill row in the facts column offers them ("1h | 1h 15m | 1h 20m ›"). It scrolls sideways, and changing it re-flows the slots. Month, week and column views sit outside the card at the top right. Build the month view first.

**Time zone picker.** An inline text trigger, not a boxed select, that opens a searchable combobox. Show the local time beside each zone, as Calendly does ("Indochina Time (11:34)").

**Interactions.**
- Picking a day swaps only the slots (120–150ms fade).
- Picking a slot changes the card, on the same URL, to two columns: facts and a form. Animate the width change over about 200ms, ease-out.
- The facts column then adds the chosen date and time ("Monday, April 28, 2025 / 2:15 – 3:30pm").
- Errors appear inline as small amber callouts ("Please enter a number between 1 and 12").

**Form, about 60% of the card.** Fields, in order:
- "Your name \*" and "Email address \*".
- Location radios, when there is a choice of location.
- "Additional notes", with the placeholder "Please share anything that will help prepare for our meeting."
- A "+ Add guests" link that expands into an email field.
- The host's own questions.

Then terms fine print, "Back" (ghost) and "Confirm".

**Confirmation.** A centred card about 560px wide:
- A green tinted check badge.
- "This meeting is scheduled", with "We sent an email with a calendar invitation with the details to everyone."
- A two-column list of **What, When, Who, Where, Additional notes** and the answers to the host's questions. When includes the zone name. Who has a small "Host" badge on the host.
- "Need to make a change? Reschedule or Cancel".
- An "Add to calendar" row of icon buttons.

**Cancel** opens inside the same card, with no new page. It asks for a "Reason for cancellation", with the hint "Cancellation reason will be shared with guests", and offers "Nevermind" or "Cancel event".
- Afterwards the badge becomes a red ×, the heading reads "This event is canceled", a Reason row appears, and the When value is struck through.

**Reschedule** reuses the booker, with the old time struck through. On the host's side, "Request reschedule" is a dialog: "This will cancel the scheduled meeting, notify the scheduler and ask them to pick a new time."

**Don't copy:** the help button, chat bubble, branding, spam banner, full-week timeline.

### 2. Event types list

**Rows, about 60px tall.**
- **Left:** the title (14px medium), then the slug inline in 12px muted ("/alex/15min"). Under it, an optional two-line description and clock chips for each duration ("60m 75m 90m").
- **Right:** a grey "Hidden" badge (only when the event type is hidden), the visibility toggle, then a joined icon group: open, copy link, "…".

Hidden rows dim only the toggle. Above the list: a 260px search field and avatar tabs per team.

**New event type** is a dialog: "Add a new event type / Create a new event type for people to book times with."
- Fields: Title, URL (a fixed muted prefix, with the slug **filling itself from the title as you type**), Description, and Duration (with a "Minutes" suffix inside the field).
- "Continue" spins in place, shows a toast, then opens the editor.

Reorder with drag handles that appear on hover (dnd-kit).

### 3. The event type editor

**It is a page.** The header holds the hidden toggle | preview, copy link, embed, delete (red) | **Save**.

A left sub-nav, about 200px wide, lists each section with an icon, a label and a **muted live summary**: "Event Setup / 60, 75, 80, 90 mins", "Availability / Working Hours", "Limits / How often you can be booked", "Advanced / Calendar settings & more…", "Workflows / 0 active". The active item gets a grey fill and a chevron. Content is a stack of bordered cards, one per concern.

**Setup.**
- Title, Description and URL (prefix plus slug).
- **Durations card:** an "Available durations" chip multi-select, a "Default duration" select, and an "Allow booker to select duration" toggle. With the toggle off, the card collapses to one field with a "Minutes" suffix.
- **Location card:** a select grouped into Conferencing, In person, Other and Phone, with an icon on each option. Each location gets its own row with an × to remove it, plus "+ Add a location". A link location shows an indented URL field (↳) and a "Display on booking page" checkbox.

**Availability.** A schedule select, then a **read-only** preview of the week. Days off are struck through and marked "Unavailable", and the zone shows beside "Edit availability ↗".

**Advanced.**
- **Booking questions:** each row shows the label, a badge (Required, Optional or Hidden) and the field type, muted ("Short Text"). At the right sit a show/hide toggle, Delete (for custom questions only) and "Edit".
- The **question dialog** asks for Input type, Identifier, Label, Placeholder, Options ("+ Add an Option") and **Required as a Yes/No segmented control**.
- Toggle rows follow: "Requires confirmation", "Disable Cancelling".

**Limits** (not on Mobbin): cards for buffers, minimum notice, slot interval, frequency limits.

**Saving.** One Save for the whole editor. The header's hidden toggle applies at once.

**Don't copy:** AI translation, Apps, Webhooks, Routing.

### 4. Availability

**The list.** "Availability / Configure times when you are available for bookings." with a "My Availability | Team Availability" segment and "+ New", which opens a dialog asking only for a name.
- Rows: bold name, green "Default" badge, muted summary lines ("Tue - Fri, 9:00 AM - 5:00 PM"), the zone, and a "…" menu: Set as default, Duplicate, Delete.
- The footer link reads "Temporarily Out-Of-Office? Add a redirect".

**The editor.** The name has a pencil for **renaming inline**, with a live summary underneath. On the right of the header: a "Set to Default" toggle, delete, Save.

The body splits about 70/30:
- **Left:** a card of seven day rows, about 36px each. A row holds a toggle, the day, a time range ("9:00am – 5:00pm", in fields about 90px wide), a "+" to add a range, and a copy icon. Extra ranges stack beneath, each with a trash icon. A day that's off shows only its toggle and name.
- **Right:** a "Timezone" select, then "Something doesn't look right?" and "Launch troubleshooter".

Time fields are typeable comboboxes in 15-minute steps.

**Copy times to** (Calendly's version) is a popover anchored to the copy icon, not a dialog. It shows "COPY TIMES TO…", one checkbox per weekday (the source day checked and disabled), and "Apply".

**Date overrides.** The section reads "Add dates when your availability changes from your daily hours." with "+ Add an override", which opens a split dialog about 560px wide:
- **Left:** "Select the dates to override", a month calendar that takes multiple dates.
- **Right:** "Which hours are you free?", with time ranges and a "Mark unavailable (All day)" toggle that replaces the ranges with a disabled field reading "Unavailable all day".
- **Footer:** "Save Override".

Saved overrides list as rows ("Sunday, April 27 / Unavailable").

### 5. Bookings list

- **Tabs**, in a segmented strip: **Upcoming, Unconfirmed, Recurring, Past, Canceled**.
- **Filter chips** ("Attendee is Jane Doe") with "Clear" and "Save", the save keeping them as a segment. Reuse the CRM filter bar.
- **Rows** sit under grey bands labelled "TODAY" and "NEXT". Each row is about 70px tall:
  - **Date column, about 140px:** "Mon, 28 Apr" in bold, the time muted, then a blue "Join Cal Video" link with the provider's icon.
  - **Main:** the title, the attendee's note quoted and truncated, and "You and Jane Doe", with the attendee linked to their person record.
  - **Right:** "× Cancel event" and an "Edit ▾" menu: Reschedule booking, Request reschedule, Edit location, Add guests.
  - **Status:** a "Rescheduled" badge in amber. Unconfirmed bookings show Confirm and Reject buttons.
- **Empty state:** a 40px round grey icon tile, "No unconfirmed bookings" in bold, and muted copy: "You have no unconfirmed bookings. Your unconfirmed bookings will show up here." Write one for each tab.
- Virtualise instead of paginating.

### 6. Settings

**The nav** replaces the app sidebar and is about 220px wide, laid out as Attio does it:
- "Settings" with a back chevron.
- Collapsible small-caps groups: **Account** (Profile, Email and calendar accounts, Notifications), **Workspace** (General, Members, Billing, Security, Integrations), **Data** (Objects, Lists, Import), and **Automations**.
- A 14px icon on each item, and a grey fill on the active one.
- A **Scheduling** group holds Cal.com's Calendars, Conferencing, Out of office and booking Appearance.

**Pages.**
- **Header:** a breadcrumb ("Workspace settings › General"), the title and a description, then a divider.
- **Body:** Linear's density. Grouped cards under section headings ("Interface and theme"). Each row is a title, a muted description and a control on the right.
- **Forms:** use a card whose grey footer holds an "Update" button, disabled until something changes.

**Theme.** Cal.com uses three thumbnail cards and splits dashboard from booking page theme. Use Linear's row instead, "Interface theme: System preference ▾", in Account › Preferences, applied instantly. Booking page theme stays a setting of each booking page.

**General:** Language; Timezone, with a "Schedule timezone change" dialog (from, until, zone); Time format ("This is an internal setting and will not affect how times are displayed on public booking pages"); Start of week.

**Don't copy:** impersonation, referrals, Update buttons on toggle-only pages.

### Motion and keyboard

- **Timing:** 120–200ms, ease-out.
- **Popovers:** scale up from 0.97, anchored at the trigger.
- **Dialogs:** fade in while rising 4px.
- **States:** hover is a faint grey fill, selected is solid blue, focus is a 2px ring.
- **Calendar keys:** arrow keys move between days, with roving focus.
- **Typed times:** "930" becomes 9:30am.

### Mobbin references

Screens are at https://mobbin.com/screens/{id}.

- **Booker:**
  - Flow https://mobbin.com/flows/23bf0af9-943c-4ed2-ad8f-6203131d5560
  - Screens 9ceabcf6-6119-419d-b2fb-e413c27151e4, 5cc79401-5300-4436-86d2-a909f6d45ac7, b54dd443-6187-4a45-8abe-fea609add960, 21e0a06b-28b7-4868-b56c-393eb6c90c05, fe5be1dc-9641-4f12-afec-42fb828ec631, 2c6cbbcc-b63e-4ba3-a9db-681315baf551, d383dc96-5e70-41fb-9cd2-fce0a382a2a6
  - Calendly 1235177b-c97a-4585-95e6-ac1015225808
- **Confirm, cancel and reschedule:**
  - Screens 9d826d23-ed7e-4ec6-9f7f-c2b23f7d8f2a, 89fb725d-05c6-4acd-9091-66c50f16e4ec
  - Flows https://mobbin.com/flows/f2adf995-c18d-4c0e-8f8c-969a16ca517e, https://mobbin.com/flows/5dca9c69-b27c-4b13-bfca-088efc9d7781
- **Event types:**
  - Flow https://mobbin.com/flows/d294d00f-832d-4bfe-8ec0-cfc42f9ce9d8
  - Screens 5fcf726f-0ca5-40db-a289-615169c84c6a, fd4e7ae6-3f72-4f56-820b-59c69da801c0, e56eb43c-983f-49ef-96bb-8794d9cbb16b
- **Editor:**
  - Screens 01c05e0e-f0be-4120-be91-5c7d0c19e865, cae4f3f0-2a05-449e-af92-2867d0adad21, 26a997af-de49-42d2-a45c-2fd59921fc38, 8ba012ca-e451-46c0-b04d-7042b4ddd6dd, fa376303-5e4c-40e7-b788-b32ff1c7fdf7, d6c7f238-3b7d-402a-9637-8988f63141b0, 6ab84d4f-a737-47a0-b604-03d8c68a9fe5
  - Calendly e0fe094e-5144-47e9-a84d-6ec63a743b4a
- **Availability:**
  - Flow https://mobbin.com/flows/a008f689-8397-4e35-b303-f5c4e5621ce8
  - Screens 540c3f6a-48fe-4df4-872a-9ac422d31e1b, 0edb3b6f-d5ab-4383-b106-dfbd97af1a49, ddd3c6fb-3e7b-4956-b535-c85ea55f5f47, 599f0196-e1bc-4fde-8706-0c49b3856755
  - Calendly 8d8f560e-fbdf-47f2-9a7b-af0e4c5a5c30, 48cc96f4-7380-4de6-887d-dd1f7b7c3223
- **Bookings:** screens 6f3ffd70-91f0-45a8-a5ee-1b1c32263598, 88a3ad34-c6f6-4bf4-a9bb-bac7165b29e4, c04b55c3-4050-42ed-ada0-f84389d62a5a, ce574b1c-702b-44b1-bc3e-a8f14abe169f, 6ad3b467-859b-440d-aa04-c3df5837d92d
- **Settings:**
  - Cal.com d5f4f721-9e90-431b-aebe-a220723d6547, 7a2e3a4a-5068-4fe5-8e6d-da5840336db9, e0dfdd5c-c5e8-41d3-bf83-c597461c64cb, 1d616112-5c65-405e-b505-f598c5866c74
  - Linear aa0b9e71-c5a0-4245-b30a-ee5059de6235, c968b3b2-82a5-4044-8e4a-0bec5683dec5
  - Attio 9542aa91-30f9-49a0-997d-aa3efe0c72f9
  - SavvyCal fb1eb9f7-6fb1-413a-9e73-00752a3a72ef
