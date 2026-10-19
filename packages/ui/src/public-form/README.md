# Hosted form renderer

`@crm/ui/public-form`: the form a visitor fills in (spec 0023, `0023-experience.md`, The visitor), drawn with plain DOM and no React, so the hosted page at `/f/<address>` and the embed stay far under their 40 kB budget. The builder's preview draws the same markup through `HostedFormPreview`, inert.

- `mountHostedForm(root, form, { mode, countryGuess?, onSubmit?, onRedirect? })` draws the headline, sub heading, every question in order and the button, and answers `{ update(form), destroy() }`. `mode` is `page` (an h1, full height), `embed` (an h2, inside a site's iframe) or `preview` (inert, never submits, a visually hidden note says it is a preview).
- `mountFormMessage(root, { mode, title?, text, look? })` draws a message in the form's place: not found, or a page that couldn't load.

## Why it isn't built from the library's components

The library's controls are React Aria components; the visitor's page can't carry React within its budget, and must not import the CRM's field editors. So the controls here are plain HTML inputs drawn with the same tokens as `Field`, `Checkbox` and `Button`: one look, two implementations, and this one only for the public form.

## Rules it follows

- Every word comes from `formStrings` in `@crm/contracts/forms`, and every check from `checkAnswers`, the one the submit endpoint runs again, so a visitor sees the server's own message.
- Labels sit above inputs, "optional" follows an optional question's label, errors sit under their field, the first one takes focus, and the button stays enabled. Errors that aren't about a field show in one `role="alert"` line above the button.
- The thank you replaces the form in place, with focus on its heading; "Send another" starts a new round, which the page gives a new idempotency key.
- The look is `data-theme` (Light or Dark, which redefines the tokens) and `data-corners` (Rounded or Square) on the frame.
- On a phone width the inputs read at 16px so phones don't zoom. The type scale has no 16px step yet, so `--space-16` stands in; that is an owner call.
- It never touches the network: the page's client sends the answers through `onSubmit`.
