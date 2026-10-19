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

## The public page (`/b/<publicKey>`, `src/public/booking/`)

A second Vite input (`book.html`) that never loads the app shell: AuthLayout with the host's name, the page's facts, the meeting length and the visitor's zone (detected, changeable), SlotPicker for the week (the next free day chosen), then name, email (and a phone number for a phone page), Book, and a confirmation. A time taken meanwhile sends the visitor back to fresh times with "That time was just taken". It reads the API only through `@crm/data/booking`. Vercel serves it by a rewrite of `/b/:publicKey`; Vite's dev and preview servers do the same (`publicBookingPage()` in `vite.config.ts`).
