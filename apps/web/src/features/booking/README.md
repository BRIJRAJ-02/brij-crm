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

Cards of Switch, Field, Checkbox, Select and DatePicker. The Hours card picks the schedule the page books by (spec 0035, AC-965): "Default schedule (<name>)", which follows whichever schedule is the owner's default at each slot read, or one of the owner's schedules by name, then says that schedule's week and zone; Edit hours opens the default on Availability. The owner's schedules come from the data layer's held list (`data.schedules.view`), so a save elsewhere shows in the card. While the reader has no calendar connected (`data.calendar.view`, read through `useCalendar`), a Callout says the page offers their hours minus its bookings (AC-631), with a link to Settings, Calendar when sync is on here. The editor sits in PreviewLayout, the one Captures editor layout it shares with the form editor: notices above, the groups as Cards with a live summary each (Page, Meeting, Hours, Days off, Limits) beside the sticky preview (the page in a frame, Phone, Tablet or Desktop wide), and the save bar in its `footer`.

## Availability (`/w/$slug/bookings/availability`, spec 0025 experience and spec 0035)

- Purpose: the member's default schedule (weekdays 9 to 5 in the browser's zone until they save any hours, then stored as "Working hours"), its weekly hours, zone and days off, which every page following the default books by.
- Main task: change the week, the zone or the days off, then Save from the SaveBar.
- Leaves out: the member's other schedules (their list and editor come with spec 0035's milestone 2), a page's choice of schedule (its editor), and anyone else's hours.

The week, the zone and the days off are one draft over the held schedule (`useScheduleDraft` in `scheduleDraft.ts`): undefined until something changes, so another tab's save shows while nothing is being edited (AC-977); a save names the version the draft began from, so a schedule changed elsewhere meanwhile is refused `STALE` and said on the SaveBar, and the next Save replaces it knowingly. Your pages lists the member's pages, each with the schedule it books by and that schedule's week.

## The public page (`/b/<publicKey>`)

See `src/public/booking/README.md`: its own small bundle with plain inputs and the tokens compiled in, per spec 0023's visitor rules.
