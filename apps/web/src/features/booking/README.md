# Booking pages (spec 0025)

## Captures › Links (`/w/$slug/captures/links`; the old `/settings/booking-pages` redirects here)

- Purpose: the member's booking pages (an admin sees everyone's) with their status and bookings this month (AC-645).
- Main task: make a page and open its builder; copy a link, pause or take bookings again, delete one after a confirm.
- Leaves out: a page's settings (its builder), the bookings list (milestone 2) and team pages (milestone 3).

Built from Table, Badge, CopyButton, Button, Modal (new page, and the delete confirm with `tone="danger"`: Delete page stays busy until the server answers while the card has already left, a refusal shows inside it with the card back, and once deleted focus goes to the page's title), Field, Callout and EmptyState. Pause shows at once and rolls back on a refusal.

## The builder (`/w/$slug/captures/links/$pageId`; the old `/settings/booking-pages/$pageId` redirects here)

- Purpose: one page's details, meeting lengths, location, availability and limits (AC-623, AC-624).
- Main task: change a setting and have it saved half a second after the last change; what failed is said where it happened.
- Leaves out: questions and the deal step (milestone 2), team members (milestone 3) and a live preview of the public page.

Cards of Switch, Field, Checkbox, Select and DatePicker. The Hours card picks the schedule the page books by (spec 0035, AC-965): the default schedule by its name with a Default badge, which follows whichever schedule is the owner's default at each slot read, or one of the owner's schedules by name, then says that schedule's week and zone; Edit hours opens that schedule's editor. The owner's schedules come from the data layer's held list (`data.schedules.view`), so a save elsewhere shows in the card. While the reader has no calendar connected (`data.calendar.view`, read through `useCalendar`), a Callout says the page offers their hours minus its bookings (AC-631), with a link to Settings, Calendar when sync is on here. The editor sits in PreviewLayout, the one Captures editor layout it shares with the form editor: notices above, the groups as Cards with a live summary each (Page, Meeting, Hours, Days off, Limits) beside the sticky preview (the page in a frame, Phone, Tablet or Desktop wide), and the save bar in its `footer`.

The Meeting card ends with Add events to (`PageDestination.tsx`, spec 0024 AC-997): for the page's owner, Your default (naming it) then each calendar they can write, under its account when there are two or more, with its colour, saved at once like the Live switch; an error when the chosen calendar can't take bookings now (they go to the default); a colleague reads it only, never a name (spec 0037). Under it, Conflicts says how many calendars hold the page's times back, linking to Settings › Calendars, where that switch lives. The Limits card groups its six settings as rows (Buffers, Booking window, Pace, the library's SettingsRowGroup), each with an InfoTip saying what it does with an example, and its line sums up what is set ("15 min buffers · 4 h notice · up to 60 days").

## Availability (`/w/$slug/bookings/availability`, spec 0035)

- Purpose: the open schedule's editor, the Calendly way (22 October 2026): the default opens first, `?schedule=<id>` opens another (AC-969, AC-970).
- Main task: change the weekly hours (add or remove a day's ranges, copy them to other days), the time zone or the days off, each saved as it changes; switch, make, rename, set as default, duplicate or delete a schedule from the switcher.
- Leaves out: a list of schedules as rows (the switcher's menu lists them), which schedule a page uses (each page picks in its own editor) and a calendar view of a schedule.

The tab strip's end holds the switcher, as the other tabs' tools sit there (the owner, 22 October 2026: no row of its own floating over the card) (`ScheduleSwitcher.tsx`: the open schedule's name as a menu button, Default beside it; the menu hugs its content: the schedules to switch to (the open one checked, Default tagged), New schedule, then this schedule's Rename, Duplicate, Set as default and Delete, with no item descriptions; an action that can't apply is left out, not disabled (no Set as default on the default, no Delete on the default or the only schedule, nothing while unsaved), and the Schedules and This schedule headings show only with two or more schedules, the owner's ask of 22 October 2026. The week (HoursEditor) is a card with the time zone Select at its head and, beside it, the days off (DaysOff) and Used by (the pages booking by it, each opening its editor). New schedule stays the TopBar's primary too; at 20 schedules both wait and say why. The old `/bookings/availability/$scheduleId` address redirects into the tab.

Saving follows the owner's save rule (21 October 2026): the hours, the zone and the days off save as they change (`useScheduleAutosave` in `scheduleDraft.ts`), half a second after the last pick so a run of picks saves once, one save at a time, each naming the version the last stored. Each landed save says "Saved <name>." in one quiet toast with Undo (a newer one replaces it); a failure keeps the hours on screen with Try again; one beaten by another tab or person (`STALE`) shows theirs and says so. A range that doesn't read yet waits on screen, unsaved, with the editor's own error. The name is a text field, so Rename asks in a Modal with its own button. The schedules come from the data layer's held list (`data.schedules.view`), so another tab's save shows within a second. Until the member saves any hours, the list holds the virtual default, "Working hours", weekdays 9 to 5 in the browser's zone (AC-963), which opens like any other and is stored by its first change.

An admin (`booking.admin`) has a Viewing Select at the strip's end: their own schedules or a colleague's by name (`?member=`, AC-971), the choices from one service (`data.schedules.members`). A colleague's confirms and toasts say whose they are ("their default"); a day off's note stays its member's alone, so an admin sees the days without the reasons, and the server keeps the reasons through an admin's save.

Deleting asks first (the owner's confirm rule, 21 October 2026): "Delete the Evenings schedule?", one sentence naming the pages it moves to the default and that it can't be undone, Cancel (Esc) then Delete schedule. The dialog waits for the server and says a refusal inside itself; once it's gone the tab opens the default. The default can't be deleted: its menu item says to set another first.

The page editor's Hours card picks the default schedule (its name with a Default badge, `scheduleChoices` in `schedules.ts`) or one of the owner's schedules, says its week and zone, and links to it (Edit hours). The copy is in `schedule-strings.ts`, apart from `strings.ts`, so it never loads with the route loaders.

## The public page (`/b/<publicKey>`)

See `src/public/booking/README.md`: its own small bundle with plain inputs and the tokens compiled in, per spec 0023's visitor rules.

## New booking page (22 Oct 2026)

`NewPageDialog`: Title, Duration (a compact SegmentedControl with a visible label: 15, 30, 45 or 60 minutes, or Custom, which shows a Minutes field: 5 to 480 in steps of 5, the same bound as the contract and the database check from migration 0062) and Schedule (the same `scheduleChoices` as the editor, one sentence InfoTip), then Cancel and Create page. No web address field: the server makes a free slug from the title, and no visitor sees it since links use the page's key, so the editor drops its Short name field too. The page takes one length here; more are added in the editor, whose Durations chips show the ready picks plus the page's own custom lengths, with an Add a length field under them (at most four lengths, as the public page shows four; the contract refuses a fifth, `durations.ts`).
