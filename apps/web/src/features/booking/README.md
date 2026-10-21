# Booking pages (spec 0025)

## Scheduling › Booking pages (`/w/$slug/booking-pages`, spec 0034; `/captures/links` and the old `/settings/booking-pages` redirect here)

- Purpose: the member's booking pages (an admin sees everyone's) with their status and bookings this month (AC-645).
- Main task: make a page and open its builder; copy a link, pause or take bookings again, delete one after a confirm.
- Leaves out: a page's settings (its builder), the bookings list (milestone 2) and team pages (milestone 3).

Built from Table, Badge, CopyButton, Button, Modal (new page, and the delete confirm with `tone="danger"`), Field, Callout and EmptyState. Pause shows at once and rolls back on a refusal.

## The builder (`/w/$slug/booking-pages/$pageId`; `/captures/links/$pageId` and the old `/settings/booking-pages/$pageId` redirect here)

- Purpose: one page's details, meeting lengths, location, availability and limits (AC-623, AC-624).
- Main task: change a setting and have it saved half a second after the last change; what failed is said where it happened (a taken web address on its field).
- Leaves out: questions and the deal step (milestone 2), team members (milestone 3) and a live preview of the public page.

Cards of Switch, Field, Checkbox, Select, DatePicker and HoursEditor (weekly hours, and date overrides with a remove per date). A range that ends before it starts or overlaps another is said on its row and holds the save back. While the reader has no calendar connected (`data.calendar.view`, read through `useCalendar`), a Callout says the page offers their hours minus its bookings (AC-631), with a link to Settings, Calendar when sync is on here. The editor sits in PreviewLayout, the one Captures editor layout it shares with the form editor: notices above, the groups as Cards with a live summary each (Page, Meeting, Hours, Days off, Limits) beside the sticky preview (the page in a frame, Phone, Tablet or Desktop wide), and the save bar in its `footer`.

## The public page (`/b/<publicKey>`)

See `src/public/booking/README.md`: its own small bundle with plain inputs and the tokens compiled in, per spec 0023's visitor rules.
