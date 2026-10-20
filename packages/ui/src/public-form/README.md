# Hosted form

`@crm/ui/public-form`: the form a visitor fills in (spec 0023, `0023-experience.md`, The visitor, and `0023-form-design.md`), on the hosted page at `/f/<address>`, inside a site's embed, and in the builder's preview. All three draw `HostedForm`, so they are one component tree.

- `mountHostedForm(root, form, { mode, countryGuess?, onSubmit?, onRedirect?, logo? })` mounts HostedForm inside UiProvider into a new element at the end of `root`, synchronously, so the page can measure it for an embed's height at once. It answers `{ update(form), destroy() }`. `mode` is `page` (an h1 at `text-note-title`, full height, a centred card from the page breakpoint), `embed` (an h2 at `text-heading`, no card, no page height) or `preview` (inert, never submits, a visually hidden note says it is a preview).
- `mountFormMessage(root, { mode, kind })` draws a message in the form's place: not found, or a page that couldn't load.
- `HostedFormPreview` (a module) renders HostedForm directly for the builder.

## The files

| File                  | Owns                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HostedForm.tsx`      | Classic: every question on one card, the error summary, the alert line and the button                                                                                                                                                                                                                                                         |
| `HostedFormSteps.tsx` | Steps (questions grouped, a progress line, Back and Continue, each step checked before moving on) and Conversational (one question at a time, large, Enter to go on). Library stories only until the owner confirms the form's `layout` and `steps` (`0023-form-design.md`); the hosted page never imports it, so its bundle doesn't carry it |
| `use-hosted-form.ts`  | The state every layout shares: answers, the field checker, the email typo hint, the send, the thank you                                                                                                                                                                                                                                       |
| `Question.tsx`        | One question drawn with the library's control for its answer type, the "(optional)" mark, and what an answer sends                                                                                                                                                                                                                            |
| `FormParts.tsx`       | The frame (the look as tokens, the card, the touch type size), the header, the thank you, the closed line, the summary, the alert, the honeypot, the foot, and the not found message                                                                                                                                                          |

## Why it uses the library

Until 19 October 2026 this was plain DOM, drawn to look like the library, to stay under a 40 kB budget. The owner asked for one input system everywhere, so it now draws with the library's own Field, Select, CountryPicker, PhoneField, RadioGroup, Checkbox, Switch and Button. The page loads React and React Aria, under its own budget in `apps/web/.size-limit.js` (220 kB JavaScript, 16 kB CSS, gzipped). The phone library loads later, on demand.

## Rules it follows

- Every word comes from `formStrings` in `@crm/contracts/forms`, and every check from `checkAnswers`, the one the submit endpoint runs again, so a visitor sees the server's own message.
- Labels sit above inputs. An optional question's label is followed by a quiet "(optional)" in `text-tertiary` (each control's `labelAside`), part of its name; required ones carry nothing, and neither does a tick box or a yes or no. A dropdown or country with no answer reads "Choose one".
- **The field checker**: a question is checked when focus leaves it with something in it (or when a required one is emptied again), and every question on submit. A shown error clears the moment the answer passes, but a new one never appears while typing. Errors sit under their field; a submit that finds problems focuses the first and lists them above the button ("2 answers need a look"), each a link that focuses its question, announced politely. Failures that aren't about a question show in one `role="alert"` line above the button. The button stays enabled.
- **Email typos**: an address whose domain is a common provider misspelt ("gmial.com") gets "Did you mean ada@gmail.com?" with Use it (`suggestEmail`), a hint and never an error.
- While sending, the button keeps its width, shows the spinner and reads "Sending…"; a second press does nothing.
- A phone answer is `{ number, country }` with the number in E.164 (`toE164`); a country answer is the country's name in the form's language. PhoneField is used unchanged, so its own per country example and check arrive here when they land.
- The honeypot, the fill time and the idempotency round work as before: "Send another" starts a new round, which the page gives a new idempotency key.
- The thank you replaces the form in place, with focus on its heading, in the booking confirmation's shape: a green tinted check, the heading, a muted line, then Send another.
- The look maps onto tokens, with no CSS of its own for a control: `data-theme` (Colour) redefines the tokens for light or dark, and `data-corners='square'` (Corners) points the radius tokens at the smallest step, so every control inside squares its corners. On touch screens the form's body and input text is 16px and its inputs taller, so phones don't zoom into a field; until the design system has a touch type size token, that size is drawn from the spacing scale (pending owner confirmation).
- The Timefix wordmark sits centred under the card (or under the form in an embed), quiet until pointed at, linking to timefix.ai (in a new tab inside an embed). It defaults to the web app's own files in `public/brand`.
- It never touches the network: the page's client sends the answers through `onSubmit`.

## States

Book after sending and its Stay here (`HostedForm.stories.tsx`; the countdown itself in `FormBooking.browser.test.tsx`). Classic, every answer type, embed, dark and square, errors with the summary, checked on blur, the email hint, sending, failed, thanks, paused (`HostedForm.stories.tsx`). Steps, a step's errors, the second step, the last step and its thanks, steps dark and square, one at a time, its next question, its error, and one at a time dark (`HostedFormSteps.stories.tsx`).

## Keyboard

Tab follows the questions. Enter in a single line field submits (Classic), continues (Steps, Conversational) or sends on the last step. The summary's links focus their questions. A step change moves focus to its first question and announces its place politely.
