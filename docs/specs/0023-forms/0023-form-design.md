# 0023. Forms: the visitor's form, its design and its types

**Date**: 2026-10-20
**Status**: Classic redesign built; Steps and Conversational drawn as library stories, pending owner confirmation
**Extends**: [0023-experience.md](0023-experience.md), The visitor. Where this file and that section differ on the look, this file wins; the contract stays as that file has it until the owner confirms the changes below.

## The brief

- **What it is for**: a stranger tells a business who they are and what they want, and the business hears about it in the CRM a moment later.
- **The one main task**: answer a few questions and press Send, without hesitating, on a phone as much as a laptop.
- **What it leaves out**: anything about the CRM, the workspace or its members; marketing; a progress bar on a one page form; asterisks; analytics or third party scripts; motion that isn't feedback.

We believe a calmer, more confident Classic form (a real headline, a steady field rhythm, a quiet "(optional)", errors that arrive at the right moment and a thank you that lands) will turn more visits into enquiries, because the drop off on short lead forms comes from doubt (what is required, did it send, what was wrong) rather than from length.

## What the references do

Looked at on Mobbin: Typeform (one question at a time, "press Enter", the OK button and the up and down arrows bottom right, "Powered by" badge), Tally (a document page, bold labels, big title, a green Submit with an arrow, an optional progress bar setting, "Made with Tally" toggle), Workable and Langdock (a centred card on a tinted ground, labels above, full width button), Dropbox Dash and Canny (sizes as chips, "Choose a role" placeholders, Back and Continue), Melio (multi step onboarding: a progress line above Back and Continue, one topic per step), Retool's stepped container (numbered steps), Calendly and Workable thank you screens (a check badge, a heading, one muted line). HoneyBook marks each field "This question is required", which is the noise we avoid.

What we take: the headline does the talking; labels sit above; optional is the marked case, never required; one primary button; the thank you replaces the form in place; branding is one small mark, never a banner.

## Form types

Three types are worth offering. They are one setting, **Layout**, with three values, because the questions, the check and the submit are the same; only how many questions show at a time, and the chrome around them, differ.

| Type | What the visitor sees | When it fits |
|---|---|---|
| **Classic** (today, the default) | Every question on one card (on its own page) or one column (in an embed), one Send button | Short lead forms: up to about eight questions, the common case |
| **Steps** | Questions grouped into steps, a thin progress line with "Step 2 of 3", Back and Continue, each step checked before moving on, the last step's button is the form's button text | Longer forms that fall into topics: about you, your company, your project |
| **Conversational** | One question at a time, the question large, Enter to continue (an "OK ↵" button for pointers), Back, a progress line, the same check per question | Brand forms, surveys, qualification where a warmer pace helps |

**Inline embed** is not a fourth type: it is where any type is drawn. The `embed` mode already drops the page card, the page height and the ground, and uses an h2. It inherits nothing from the host page today beyond its width (an iframe can't read the host's fonts or colours); the form's own Colour picks light or dark. That stays.

### Steps versus Conversational

Conversational is Steps with one question per step and a bigger, quieter frame. So the data is one thing: a list of steps, each a run of questions. The editor offers the three Layout values; Conversational ignores step breaks and puts each question on its own step.

| | Steps | Conversational |
|---|---|---|
| Questions per screen | a group (the editor's step breaks) | one |
| Frame | the Classic card, with the progress line at its top | no card, the question at heading size, centred in the page |
| Enter | submits a single line field's step, like Classic | continues from any single line field; a choice continues on Enter |
| Progress | "Step 2 of 3" and a line | a line only (the count reads "2 of 7" to screen readers) |
| Back | a ghost button left of Continue | a ghost button left of OK |
| Last step | its button reads the form's button text ("Send") | the same |
| Review step | none: lead forms are short, and Back covers a change of mind | none |

Both keep every Classic rule: labels above, "(optional)" after an optional label, the same messages from `checkAnswers`, the first problem focused, the button always enabled, one `role="alert"` line for failures that aren't about a question, and the thank you replacing the form with focus on its heading. A step change moves focus to the step's first question and announces "Step 2 of 3" politely; the step fades in with a short rise (`duration-modal`, `ease-out`), a fade only under reduced motion; nothing animates when the step was reached from the keyboard twice in a row beyond the fade.

### How the editor groups questions into steps (for the questions builder)

The questions list (QuestionsSection, owned by the inputs builder) would need:

- A **"New step" divider** you add from the list's add menu or with a menu action on a question ("Start a step here"). It draws as a hairline with "Step 2" and an optional title field, and drags like a question. Removing it merges its questions into the step above.
- Step breaks are shown only when Layout is Steps. With Classic they are kept but hidden (a quiet note says "Steps show when Layout is Steps"); with Conversational they are ignored.
- A step may hold at most one file question and at least one question; the publish check refuses an empty step ("Step 3 has no questions. Add one or remove the step.").

### Recommendation: what to build now

1. **Classic, redesigned, now.** It is every form that is live, it needs no contract change, and the owner's notes ("better design", "(optional)", "Choose one", "a field checker") all land here.
2. **Steps next, as the second type,** once the owner confirms the contract change below. It serves the longer forms the owner described ("maybe a multi step form setting") and reuses the Classic card, so it costs least and reads most like the product.
3. **Conversational after Steps,** on the same data, as a frame over one question per step.

Steps and Conversational are built now as **library stories only** (`Public form/Steps`, `Public form/Conversational`), drawn by `HostedFormSteps` in `@crm/ui/public-form`, so the owner can try them. Nothing on the live page or in the editor switches to them.

## Data each type needs: pending owner confirmation

These change `FormDocument` and `PublicForm` (spec 0023, Contract changes) and need a migration of nothing (the document is JSON, the defaults fill in), but they are load bearing for the published version, so they wait for the owner.

**Recommended (pending owner confirmation):**

- `FormDocument.layout: 'classic' | 'steps' | 'conversational'`, default `'classic'`. It lives in the version's document, so it publishes with the questions and a live form never changes shape under a visitor mid fill.
- `FormDocument.steps: { id, title?, startsAt: questionId }[]`, default `[]`: each step starts at a question and runs to the next step's start. Kept as breaks rather than nesting questions inside steps, so reordering questions never loses one, Classic ignores it, and Conversational ignores it.
- `PublicForm.layout` and `PublicForm.steps: { title?: string, keys: string[] }[]` (question keys per step, already resolved by `publicFormOf`), so the hosted page groups without the editor's ids.
- `checkAnswers` unchanged: the page checks a step by passing that step's questions; the server checks the whole form on submit, as today.
- **Colour and Corners** apply as now, to every type: `data-theme` redefines the colour tokens and `data-corners='square'` points the radius tokens at the smallest step, so the progress line, Back and Continue square with the fields. Conversational uses the page ground (`surface`) rather than the card in both colours.
- The builder's Settings tab gets a **Layout** SegmentedControl (Classic, Steps, One at a time) above Colour; the preview frame draws the chosen layout. (Owned by the form editor's builder; nothing here edits it.)

## The field checker

Owner's note: "add a field checker". Built in Classic, and shared by the step types:

- **When**: a question is checked when it loses focus with something typed in it, and every question on submit. An error, once shown, clears the moment the answer is fixed (checked on each change), but a new error never appears while typing.
- **What**: required, the answer's shape (email, phone, website, number), length (a long answer shows its count near the limit), and choices among the question's own: all from `checkAnswers`, so the message is the server's.
- **Email typos**: "Did you mean ada@gmail.com?" under an email that looks like a common provider misspelt (gmial.com, hotmal.com, outlok.com, yaho.com and the like), with a **Use it** button that fixes the address. A hint, never an error: the address may be right.
- **Error summary**: a submit that finds problems lists them above the button, "2 answers need a look", each a link that focuses its question; the first problem also takes focus. It is announced politely (`aria-live="polite"`), and it updates as problems are fixed and leaves when they are.
- **Phone**: the records builder is adding a per country example placeholder and a live validity check to PhoneField (additively). The hosted form keeps its PhoneField usage unchanged so that work lands into it with no edit here.

**Pending owner confirmation: attribute rules on the visitor's page.** Spec 0023 asks for `checkRules` (spec 0013 validation patterns) on the visitor's page and the server. Today neither runs them on a form submit: `checkAnswers` checks the answer type only, and `PublicForm` carries no rules. Recommended: `PublicQuestion.rules` (the filed attribute's pattern and length rules, as `checkRules` reads them, with their messages), filled by `publicFormOf`, and `checkAnswers` running `checkRules` on each answer, so the page and the server give the same message. A contract change, so it waits.

**Spam checks**: a separate builder is adding a server side spam checker. The page keeps only what it already sends for that: the hidden honeypot field (`company_url`) and the fill time from first render (`fillMs`). Nothing else is added on the client until that builder asks.

## The Classic redesign, in short

- **Page**: a centred card on the `surface-subtle` ground from the page breakpoint, `surface` edge to edge below it. In an embed: no card, no ground, no page height.
- **Header**: the headline at `text-note-title` on the hosted page (28/36), `text-heading` in an embed; the sub heading at body size in `text-secondary`, 8px under it; 32px to the first question.
- **Rhythm**: 20px between questions; label, control and message 4px apart (Field's own); 24px before the button.
- **Optional**: the label, then "(optional)" in `text-tertiary`, part of the accessible name. Required carries nothing. Checkbox and yes or no questions carry nothing either.
- **Placeholders**: the question's own; a dropdown or country with no answer reads "Choose one" whether optional or not ("Prefer not to say" read as an answer, which it isn't). An optional dropdown can be cleared from its list.
- **Button**: full width, the input's height (`lg`), the form's button text; while sending it keeps its width, shows the spinner and reads "Sending…" to screen readers, and a second press does nothing.
- **Errors**: under their question, in `danger` with the alert icon; the summary above the button on submit; a failure that isn't about a question in one alert line above the button.
- **Thank you**: replaces the form in place with the same card height settling, a green check badge that grows in, "Thank you. That is with us.", the form's own words or "We will come back to you at the address you gave.", and Send another as a quiet button. Focus moves to the heading.
- **Branding**: "Made with" and the Timefix wordmark, small and quiet, centred under the card on the page (inside the frame in an embed), full strength on hover or focus. The captcha's notice sits above it when reCAPTCHA is on.
- **Phones (390)**: no card, 24px side padding, the button full width; inputs at 16px text on touch screens so iOS doesn't zoom (pending a type token for it, below).
- **Keyboard**: Tab follows the questions; Enter in a single line field submits; every control has the focus ring; the summary's links focus their questions.
- **Budget**: the hosted page stays under its 220 kB JS and 16 kB CSS (`apps/web/.size-limit.js`). The step types are not in the hosted page's bundle until a form uses them.

**Pending owner confirmation: a touch type size token.** Inputs need 16px text on phones or iOS zooms on focus. The design system's body is 13px and it has no 16px type token. Until the artifact gains one (recommended: `text-body-touch`, 400 16px/24px), the hosted form's root sets its body to 16px on coarse pointers from the spacing scale (`--space-16` / `--space-24`), noted in its CSS.
