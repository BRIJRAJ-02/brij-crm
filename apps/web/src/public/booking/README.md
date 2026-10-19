# The public booking page (spec 0025)

`/b/<publicKey>`, served `book.html` (the second Vite input) by Vercel's rewrite and by `publicBookingPage()` in `vite.config.ts` locally.

## Why it has its own stylesheet

Spec 0023's visitor rules: public pages use plain HTML inputs with the design tokens compiled in (`@crm/tokens/tokens.css`), never the component library or the CRM's field editors, so a visitor downloads a small page and nothing of the app. `booking.module.css` styles that markup with tokens only; lint lets only `src/public/**` carry a stylesheet and `className`, and refuses `@crm/ui` and `@crm/data` there (the page reaches the API only through `@crm/data/booking`).

## The page

- The host's name, the title, the description and where it happens; the meeting length (when the page offers several) and the visitor's zone (detected, changeable), as native selects with their labels above.
- The week: previous and next week, a live heading, seven day radios (a day with no time disabled), the next free day chosen, its times as buttons.
- Details: name and email (and a phone number for a phone page), labels above inputs, errors under their field with the first focused, one `role="alert"` line for anything else, and a `company_url` honeypot. A time taken meanwhile goes back to fresh times with "That time was just taken". No captcha and no analytics.
- The thank you replaces the page and takes focus.
- Prefill (`prefill.ts`): the seam for a form's signed, single use, two hour link; a stub until milestone 3.
