# 0023. Forms: the experience (builder, visitor, after submit)

**Date**: 2026-10-19
**Status**: Proposed (revision of milestone 1 and 2's screens, asked for by the owner on 19 October 2026)

## Summary

How forms look and behave for the member who builds one and the visitor who fills one in. It replaces the earlier "build a form from an object's attributes" builder with a model proven in production in the owner's earlier scheduling product: a form is a short list of questions, each with a plain answer type, filed onto the CRM only where the member says so; publishing is one deliberate act; the visitor sees one calm page; and the thank you is a step toward a meeting, not a dead end. The data and processing rules in [index.md](index.md) still hold; this file decides the screens, the interactions and the copy, and the few contract changes they need.

## The idea in five lines

1. **A form exists to feed the CRM and the calendar.** Every accepted submission becomes a person (matched on email), and can open a deal and hand the visitor to a booking page.
2. **Questions first, mapping second.** A member writes questions in plain words. Where each answer is filed is a separate, optional choice ("Not filed, kept with the enquiry" is a fine answer).
3. **Publish is the moment that matters.** The screen always says whether what you see is live. It never says "Saved just now".
4. **One page for the visitor.** Every question on one page, no progress bar, no steps, no captcha.
5. **Nothing is ever dropped.** Spam and failures are stored and flagged, never lost.

## Builder

Lives at Settings, Forms (the route the lane already built) and opens full width from there.

### The forms list

- A list of cards, not a table: the form's name, then facts as small chips: submissions this month, "N spam" (only when there is any), "Last enquiry Tue, Sep 1 · 1:44 PM", and an Accepting switch ("Accepting enquiries" / "Not accepting"), which is pause and resume.
- A row's menu: Open, Copy the address, Duplicate, Delete. Delete asks once, naming the form and its submission count.
- **New form** creates "Untitled form" at once, with the default questions (Name, Email, Phone) and a generated address (`form-a1b2c3`), and opens it. No dialog first: the builder is the dialog.
- Empty state (EmptyState): "No forms yet", one line on what a form does, and New form.
- Members without `forms.manage` see the list read only, with no New form and no switches.

### The editor: layout

- **Header**: the name with a pencil to rename in place (Enter saves, Esc cancels), then a status line:
  - `● Published · v7` in the success colour when the live version matches the screen;
  - `● Published · Unpublished changes` in the warning colour when they differ;
  - `○ Not published` (hollow dot) before the first publish;
  - `○ Not accepting` when paused.
  On the right: **Preview** (opens the hosted page of the draft in a new tab, marked "Preview, not live"), then **Publish** (primary). A menu (`…`) holds Copy the address, Pause or Resume, Duplicate and Delete this form. Delete never sits next to Publish.
- **Tabs** under the header, a SegmentedControl: `Form · Settings · Install · Submissions`. A form that was never published shows no tabs, only the Form content, so a new member is never lost in settings before they have questions.
- **Body** on Form: two columns, `1fr` and a 400px sticky preview on the right. Below the container width where both fit, the preview moves under a "Show preview" Disclosure.
- **Preview column**: a live rendering of the draft with the same renderer the visitor gets, inert (`inert`, not submittable, not focusable, hidden from assistive tech, with a visually hidden note that it is a preview). Above it, the look, as two Selects: **Colour** (Light, Dark) and **Corners** (Rounded, Square). That is the whole theme. No desktop and phone toggle: the preview is the width a visitor sees on a phone, and Preview opens the full page.

### Questions

- Section header: "Questions", a count Badge, **Add a question**, and a menu with **Add from presets** (Company, Website, Country, Address, Service, Budget, Timeframe, Message, How they heard) and **Close all questions**.
- Each question is a card, **closed until opened**. Closed it shows: a DragHandle, the label (or "Untitled question" in the muted colour), the answer type as a Tag, "Required" when it is, the number of choices for a choice question, and where it is filed as a quiet line ("Person · Budget band", or "Not filed, kept with the enquiry"). No hover fill on rows; the whole card opens on press, Enter or Space.
- Open, in this order:
  1. **Question** (Field): placeholder "What do you want to ask?"
  2. **Answer type** (Select), from the answer types below.
  3. **Choices** for a choice type: one input per choice, "Another choice" appends one and focuses it, Enter in the last one adds the next, Backspace in an empty one removes it. A choice question with none shows "No choices yet".
  4. **Placeholder** (Field): help "Shown until they type".
  5. **Where it goes** (Select): "Not filed, kept with the enquiry", then the attributes of the form's target objects whose type fits the answer type, grouped by object ("Person", "Company", "Deal"), each with its icon. An attribute already used by another question shows as taken.
  6. **Visitors must answer** (Checkbox).
  7. Footer: **Duplicate** and **Delete** as icon Buttons with tooltips.
- **Add a question** appends a Short text question labelled "Untitled question", opens it, focuses its Question field without jumping, then scrolls it smoothly into view (reduced motion: no scroll animation). The type is chosen inside the card, never in a menu first.
- **Duplicate** puts the copy right below, opened, with the key suffixed (`company` becomes `company_2`) and **not filed**, so two questions never fight over one attribute.
- **Reorder**: drag by the handle (dnd-kit, as decided for drag on 13 October), with a drop line. Keyboard: focus the handle, Space to lift, arrows to move, Space to drop, Esc to cancel; each move is announced ("Budget, moved to position 3 of 6").
- **Delete** removes at once and offers Undo in a toast. A filed question's delete says where it was filed in the toast.
- The email question cannot be deleted while the form files onto People; its Delete is disabled with the reason in its tooltip.

### Answer types

Every type yields exactly one value, and that is the test for any new one. Each maps onto attribute types for Where it goes:

| Answer type | Visitor control | Files onto |
|---|---|---|
| Short text | text input | text |
| Long text | growing textarea | text |
| Email | email input | email |
| Phone | dial code picker plus number | phone |
| Website | url input | url, domain |
| Number | number input | number, currency |
| Dropdown | select ("Choose one", or "Prefer not to say" when optional) | select, status |
| Choice | radio group | select, status |
| Checkbox | one checkbox ("Subscribe to updates") | checkbox |
| Yes or no | switch | checkbox |
| Country | searchable country picker, default guessed from the request's country | text, select |
| File | one file, PDF, Word, PNG or JPEG, 5 MB | file (waits for #32) |

Record references, people, ratings, dates and multi selects are not form questions for now.

### Publishing

- **Publish** is enabled whenever there are unpublished changes. Pressing it checks the draft and refuses with the first problem, as one full sentence in a Callout under the header, and the question at fault opens, scrolls into view, shows its error inline, and cannot be closed until fixed. The sentences:
  - "Give the form a name."
  - "The address needs 2 to 40 lowercase letters, numbers or hyphens."
  - "Keep an email question. It is how an enquiry becomes a person in your CRM."
  - "Every question needs a label."
  - "“Budget” is a choice question with nothing to choose from."
  - "“Budget” is filed on an attribute that no longer exists. Choose another in Where it goes, or Not filed."
  - "You can't write to Person · Budget band, so this form can't file answers there." (AC-546)
- **The first publish** opens a Modal, "Step 1 of 2" (a counter, not a stepper):
  1. **Set up your form**: Name (prefilled if renamed, else empty with "Untitled form" as placeholder) and Address (`/f/` plus a slug suggested from the name, checked as typed, "That address is taken" when it is).
  2. **Where the answers go**: the object the form files onto (People by default; any object with a unique email attribute or a unique attribute the form asks). For each question, Where it goes, prefilled by matching labels to attribute names. For a member with `schema.manage`, a last option, **Build one out of this form**: a new object named after the form with one attribute per unfiled question, its button naming the count ("Create Enquiries with 4 attributes").
  Then **Publish**, and the Modal turns into **Your form is live**: the address with Copy, and the three ways to use it from Install. Close lands on the Form tab, now with tabs.
- Later publishes happen straight from the header, with a toast "Published version 8."
- **Drafts**: the draft is kept on the server, saved quietly a second after the last change (the lane's `saveDraft` with its stale check), so closing the tab loses nothing and a teammate sees the same draft. The screen never shows "Saving" or "Saved"; it only shows the status line. When another member's draft save lands first, a Callout says "Bea changed this form. Load their version" and nothing is overwritten.

### Settings tab

Three groups, each a Card with a plain heading:
- **The basics**: Name, Headline (default "Fill this in and we will come back to you"), Sub heading (optional), Address (changing it warns that the old link stops working), Button text (default "Send").
- **After someone sends it**: the thank you message; **Offer a meeting** (Checkbox) and **Which booking page** (Select, booking pages from spec 0025; disabled with "No booking pages yet" until one exists); or **Send them to a web address** instead.
- **Who handles the leads**: Owner (a member, or "Nobody"); the matched record keeps its owner. Round robin appears here when #58 lands.

Each field saves on blur with a toast only when it fails. Settings changes that change the visitor's page (headline, button, after) go into the draft and need Publish, and the status line says so; the owner and the address apply at once.

### Install tab

Three Cards, each with one sentence and one action:
- **Share a link**: "Send people a link. You do not need a website." The address, Copy, and Open.
- **Embed on your site**: "Put the form on a page of your own site." A two line snippet (a script and a `div`), Copy. The embed is an iframe the script sizes to its content, so the form looks the same everywhere and the site's CSS can't break it.
- **Your own form**: "Use your own design. We just collect the answers." A generated HTML form with `data-crm-field` attributes and our script, Copy; and **Which sites can send us leads** (a list of domains, required before it works) with **Refuse unsigned posts** (a Switch) for sites that sign posts with the form's secret.

### Submissions tab

- A table (DataGrid, read only): when, the person (RecordChip, or the email when not processed), the state as a Tag (Processed, Spam, Needs review, Failed), and the first two answers. Newest first, filter by state with a SegmentedControl. Live: new submissions appear at the top as they land.
- Pressing a row opens a Panel: the answers as a DescriptionList in the form's question order, with "Not filed" marked; where it came from (UTM tags, page, referrer); the records it created or touched with what happened; and actions by state: Release (spam), Mark as spam, Retry (failed), Pick the right record (needs review), Delete.
- Empty: "No enquiries yet. Share the link from Install."

### On the record

A submission shows on each touched record's timeline as "Sent Contact us" with the answers folded under a Disclosure, and links to the submission.

## The visitor

The public bundle renders this with plain HTML inputs and the design tokens compiled in, under the 40 kB budget (it must not import the CRM's field editors).

- **One page**: the headline (h1, or h2 inside an embed), the sub heading, every question in order, the button. Centred, at most 36rem wide, full height when hosted alone. No progress bar.
- **Labels** sit above inputs. Optional questions carry the word "optional" after the label; required ones carry nothing. No asterisks.
- **Validation**: the shared answer check (`checkAnswers`) runs on submit and then on each change of a field that has an error. Errors appear under their field, the first one is focused, and the button stays enabled. Server errors that aren't about a field ("That did not go through. Try again in a moment.", "That did not go through. Check your connection and try again.") appear in one `role="alert"` line above the button.
- **The button** reads the form's button text, and "Sending…" while sending (disabled, so a double press sends once; the idempotency key also guards it).
- **Thank you**, replacing the form in place with focus moved to its heading:
  - "Thank you. That is with us."
  - "We will come back to you at the address you gave." and, when Offer a meeting is on, "…or book a time now and skip the wait." with a **Book a quick meeting** Button that opens the booking page with their name and email filled in (spec 0025's prefill hand off, a signed single use link valid for two hours). Hosted alone, the page goes to the booking page by itself after three seconds unless the visitor moves focus; inside an embed it opens in a new tab.
  - "Send another" as a quiet link.
- **Paused**: "This form isn't taking enquiries right now." **Not found**: a plain 404 page with no workspace details.
- Keyboard: Tab order is the question order; Enter in a single line input submits; every control has a visible focus ring; contrast meets AA in both colours.
- Phone width: inputs are full width, 16px text so phones don't zoom, the button full width.
- No analytics, session replay or third party scripts on the hosted page or the embed.

## Contract changes this needs (`FormDocument`)

- `questions[]` replaces `blocks[]` and `steps[]`: `{ id, key, label, answerType, choices?, placeholder?, required, filedOn?: { objectRole, attributeId }, update: 'fill' | 'always' }`. Layout blocks, steps and conditions move to a later milestone (Follow-up).
- `look: { colour: 'light' | 'dark', corners: 'rounded' | 'square' }` replaces most of `style`; `headline`, `subheading`, `buttonText` added.
- `after: { message, offerMeeting?: { bookingPageId } } | { redirect }`.
- The publish check above is one function in contracts (`publishProblem`), used by the builder and the server, returning the first problem as `{ code, message, questionId? }`.
- At most 30 questions, unique keys, at most one file question, one question per attribute.

## Bots and abuse, adjusted

- **No captcha by default.** Bots are stopped by a honeypot (`company_url`), a minimum of 2 seconds from load to submit, rate limits (5 per address per minute, 120 per form per hour, then 429 with `Retry-After`), the per load idempotency key, and for Your own form the domain list and optional signature. Spam gets the same answer as success and is stored as spam.
- reCAPTCHA stays possible: when `RECAPTCHA_SITE_KEY` and `RECAPTCHA_SECRET_KEY` are both set, its score is one more spam signal. They are optional everywhere, including production.

## Acceptance criteria added (AC-649 to AC-664)

- **AC-649**: New form creates an untitled form with Name, Email and Phone and opens it, with no dialog first.
- **AC-650**: The status line always says whether the screen matches the live version, and never says "Saved".
- **AC-651**: A never published form shows no tabs.
- **AC-652**: Questions are closed cards that open on press, Enter or Space; Add a question appends an opened, focused Short text question.
- **AC-653**: Duplicate places an opened copy below with a suffixed key and no filing.
- **AC-654**: Reorder works by pointer and by keyboard on the handle, and each keyboard move is announced.
- **AC-655**: Publish refuses with the first problem as a sentence, and the question at fault opens and can't close until fixed.
- **AC-656**: The first publish asks for name and address, then where the answers go, and can build a new object out of the form for a member with `schema.manage`.
- **AC-657**: The preview shows the draft as the visitor will see it, live, and can't be submitted or focused.
- **AC-658**: Where it goes only offers attributes whose type fits the answer type, and an attribute used once.
- **AC-659**: The visitor page shows every question on one page, marks optional questions with the word "optional", and stays under 40 kB gzipped.
- **AC-660**: A failed submit keeps every answer, shows field errors under their fields, and focuses the first.
- **AC-661**: The thank you replaces the form, takes focus, and with Offer a meeting opens the booking page prefilled.
- **AC-662**: A paused form's page says it isn't taking enquiries and refuses submissions.
- **AC-663**: Install offers the link, the embed snippet, and Your own form with its domain list.
- **AC-664**: Submissions list newest first, filter by state, update live, and open a panel with the answers and actions.

AC-547 (steps and conditions) and AC-589 (popup and slide in) move to the Follow-up. AC-550's phone and desktop widths are replaced by AC-657. AC-583 becomes optional, as above.
