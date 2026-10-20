# Hosted form

`@crm/ui/public-form`: the form a visitor fills in (spec 0023, `0023-experience.md`, The visitor), on the hosted page at `/f/<address>`, inside a site's embed, and in the builder's preview. All three draw `HostedForm`, so they are one component tree.

- `mountHostedForm(root, form, { mode, countryGuess?, onSubmit?, onRedirect?, logo? })` mounts HostedForm inside UiProvider into a new element at the end of `root`, synchronously, so the page can measure it for an embed's height at once. It answers `{ update(form), destroy() }`. `mode` is `page` (an h1, full height, a centred card from the page breakpoint), `embed` (an h2, no page height) or `preview` (inert, never submits, a visually hidden note says it is a preview).
- `mountFormMessage(root, { mode, kind })` draws a message in the form's place: not found, or a page that couldn't load.
- `HostedFormPreview` (a module) renders HostedForm directly for the builder.

## Why it uses the library now

Until 19 October 2026 this was plain DOM, drawn to look like the library, to stay under a 40 kB budget. The owner asked for one input system everywhere, so it now draws with the library's own Field, Select, CountryPicker, PhoneField, RadioGroup, Checkbox, Switch and Button. The page loads React and React Aria: its first load went from 8.4 kB of JavaScript and 4.4 kB of CSS to 197.8 kB and 12.2 kB (gzipped), with its own budget in `apps/web/.size-limit.js`. The phone library loads later, on demand.

## Rules it follows

- Every word comes from `formStrings` in `@crm/contracts/forms`, and every check from `checkAnswers`, the one the submit endpoint runs again, so a visitor sees the server's own message.
- Labels sit above inputs, "(optional)" follows an optional question's label, an unanswered Dropdown or Country says "Choose one", errors sit under their field, the first one takes focus, and the button stays enabled. Errors that aren't about a field show in one `role="alert"` line above the button.
- A phone answer is `{ number, country }` with the number in E.164 (`toE164`); a country answer is the country's name in the form's language.
- The honeypot, the fill time and the idempotency round work as before: "Send another" starts a new round, which the page gives a new idempotency key.
- The thank you replaces the form in place, with focus on its heading, in the booking confirmation's shape: a green tinted check, the heading, a muted line, then Send another.
- The look maps onto tokens, with no CSS of its own for a control: `data-theme` (Colour) redefines the tokens for light or dark, and `data-corners='square'` (Corners) points the radius tokens at the smallest step, so every control inside squares its corners.
- The Timefix wordmark sits at the foot of every view, linking to timefix.ai (in a new tab inside an embed). It defaults to the web app's own files in `public/brand`.
- It never touches the network: the page's client sends the answers through `onSubmit`.
