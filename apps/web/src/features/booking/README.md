# Booking pages (spec 0025)

## Settings › Booking pages (`/w/$slug/settings/booking-pages`)

- Purpose: the member's booking pages (an admin sees everyone's) with their status and bookings this month (AC-645).
- Main task: make a page and open its builder; copy a link, pause or take bookings again, delete one after a confirm.
- Leaves out: a page's settings (its builder), the bookings list (milestone 2) and team pages (milestone 3).

Built from Table, Badge, CopyButton, Button, Modal (new page, and the delete confirm with `tone="danger"`), Field, Callout and EmptyState. Pause shows at once and rolls back on a refusal.

## The builder (`/w/$slug/settings/booking-pages/$pageId`)

- Purpose: one page's details, meeting lengths, location, availability and limits (AC-623, AC-624).
- Main task: change a setting and have it saved half a second after the last change; what failed is said where it happened (a taken web address on its field).
- Leaves out: questions and the deal step (milestone 2), team members (milestone 3) and a live preview of the public page.

Cards of Switch, Field, Checkbox, Select, DatePicker and HoursEditor (weekly hours, and date overrides with a remove per date). A range that ends before it starts or overlaps another is said on its row and holds the save back. Until calendar sync is wired in, a Callout says the page offers your hours minus its bookings (AC-631).

## The public page (`/b/<publicKey>`)

See `src/public/booking/README.md`: its own small bundle with plain inputs and the tokens compiled in, per spec 0023's visitor rules.
