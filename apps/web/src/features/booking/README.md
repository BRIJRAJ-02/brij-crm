# Booking pages (spec 0025)

## Captures › Links (`/w/$slug/captures/links`; the old `/settings/booking-pages` redirects here)

- Purpose: the member's booking pages (an admin sees everyone's) with their status and bookings this month (AC-645).
- Main task: make a page and open its builder; copy a link, pause or take bookings again, delete one after a confirm.
- Leaves out: a page's settings (its builder), the bookings list (milestone 2) and team pages (milestone 3).

Built from Table, Badge, CopyButton, Button, Modal (new page, and the delete confirm with `tone="danger"`: Delete page stays busy until the server answers while the card has already left, a refusal shows inside it with the card back, and once deleted focus goes to the page's title), Field, Callout and EmptyState. Pause shows at once and rolls back on a refusal.

## The builder (`/w/$slug/captures/links/$pageId`; the old `/settings/booking-pages/$pageId` redirects here)

- Purpose: one page's details, meeting lengths, location, availability and limits (AC-623, AC-624).
- Main task: change a setting and have it saved half a second after the last change; what failed is said where it happened (a taken web address on its field).
- Leaves out: questions and the deal step (milestone 2), team members (milestone 3) and a live preview of the public page.

Cards of Switch, Field, Checkbox, Select and DatePicker. The Hours card picks the schedule the page books by (spec 0035, AC-965): "Default schedule (<name>)", which follows whichever schedule is the owner's default at each slot read, or one of the owner's schedules by name, then says that schedule's week and zone; Edit hours opens that schedule's editor. The owner's schedules come from the data layer's held list (`data.schedules.view`), so a save elsewhere shows in the card. While the reader has no calendar connected (`data.calendar.view`, read through `useCalendar`), a Callout says the page offers their hours minus its bookings (AC-631), with a link to Settings, Calendar when sync is on here. The editor sits in PreviewLayout, the one Captures editor layout it shares with the form editor: notices above, the groups as Cards with a live summary each (Page, Meeting, Hours, Days off, Limits) beside the sticky preview (the page in a frame, Phone, Tablet or Desktop wide), and the save bar in its `footer`.

## Availability (`/w/$slug/bookings/availability`, spec 0035)

- Purpose: the member's schedules, each with its Default badge, its week, its zone and how many booking pages use it (AC-969).
- Main task: open a schedule, make one (New schedule asks for a name, then opens it), or set the default, duplicate or delete one from its ··· menu.
- Leaves out: editing hours (each schedule's editor) and a calendar view of a schedule.

Built from LinkList (its framed rows: the name with the zone after it, the week under it, "Used by N booking pages", the Default badge, the ··· menu), Modal (New schedule; the delete confirm) and Field. New schedule sits at the end of the Calendar · List · Availability strip, as each tab's tools do; at 20 schedules it waits and says why. The rows come from the data layer's held list (`data.schedules.view`), so a save in another tab shows within a second. Until the member saves any hours, the list holds the virtual default, "Working hours", weekdays 9 to 5 in the browser's zone (AC-963), which opens like any other and is stored by its first save.

An admin (`booking.admin`) has a Viewing Select at the strip's end, before New schedule: their own schedules or a colleague's by name (`?member=`, AC-971), the choices from one service (`data.schedules.members`). A colleague's list, editor and confirms say whose they are ("Bea Lee's schedules", "their default"); a day off's note stays its member's alone, so an admin sees the days without the reasons, and the server keeps the reasons through an admin's save.

Deleting asks first (the owner's confirm rule, 21 October 2026): "Delete the Evenings schedule?", one sentence naming the pages it moves to the default and that it can't be undone, Cancel (Esc) then Delete schedule. The dialog waits for the server and says a refusal inside itself; the schedule leaves the list once it's gone. The default can't be deleted: its menu item says to set another first.

## A schedule (`/w/$slug/bookings/availability/$scheduleId`, spec 0035)

- Purpose: one schedule's name, time zone, weekly hours, days off and the booking pages that use it (AC-970). `default` opens whichever schedule is the default, the virtual one included.
- Main task: change the hours, the zone, the days off or the name, then Save from the SaveBar; Enter in the name saves, Esc puts the saved name back; set it as default, duplicate or delete it from the ··· menu in the bar.
- Leaves out: which schedule a page uses (each page picks in its own editor).

Its own page outside the Bookings layout, with the trail Bookings › Availability. The name, the zone and the days off sit beside the week, as Availability had them; the name, the hours and the days off are one draft (`useScheduleDraft` in `scheduleDraft.ts`): undefined until something changes, so another tab's save shows while nothing is being edited (AC-977), and a save names the version the draft began from, so a schedule changed elsewhere meanwhile is refused `STALE` and said on the SaveBar, and the next Save replaces it knowingly. Used by lists the pages booking by it, each opening its editor. The virtual default's first save stores it and moves the address to its id without leaving the editor.

The page editor's Hours card picks "Default schedule (<name>)" or one of the owner's schedules, says its week and zone, and links to it (Edit hours). The copy is in `schedule-strings.ts`, apart from `strings.ts`, so it never loads with the route loaders.

## The public page (`/b/<publicKey>`)

See `src/public/booking/README.md`: its own small bundle with plain inputs and the tokens compiled in, per spec 0023's visitor rules.
