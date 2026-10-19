# Forms

Spec 0023, milestone 1. Public forms that turn what visitors send into records: built and published in Settings, filled in at a hosted link, processed into records by a background job.

## Settings, Forms (`/w/$slug/settings/forms`, FormsScreen)

- **Purpose**: the workspace's forms, live, paused and draft, and the archived ones apart.
- **Main task**: owners and admins make a new form (its name and the object it fills, People first), or open one.
- **Leaves out**: analytics, sites and embeds (milestones 3 and 4), and anything about one form.

## A form (`/w/$slug/settings/forms/$formId?tab=build|submissions`, FormScreen)

- **Purpose**: one form's builder and its submissions, with its public link, status and publish.
- **Main task**: shape the draft, preview it, publish it, share its link, and read what comes in.
- **Leaves out**: steps and conditions, consent blocks, linked person, company and deal targets, round robin, notices, booking (milestone 2).

## The hosted page (`/f/<publicKey>`, `src/public/`)

- **Purpose**: the form a visitor fills in, outside the CRM app (its own build entry, `form.html`).
- **Main task**: answer the questions and send them, then read the thank you or go where the form sends them.
- **Leaves out**: steps, prefill, the offline retry queue, branding and custom domains (later milestones).

## Notes

- Every question draws through its type's one editor (`AttributeEditor`, surface `form`) in the hosted page and the builder's preview alike (`FormFields`), so a form asks exactly what the record would take. Form only questions take a type from a short list (`FORM_ONLY_CHOICES`).
- The builder edits a local copy of the draft (`draft.ts`, plain functions over the document). Save draft and Publish wait for the server; the route then reloads the form, and the screen is keyed by the form's revision, so it starts again from what the server holds. A save someone else's change beat (`FORM_CHANGED`) says so and reloads.
- Publish names every refusal in a danger Callout: a field the person can only read (AC-546), the match field no required question asks, an owner who left.
- Preview saves the draft, then draws it in a Modal through the same fields as the hosted page; Submit checks the answers and sends nothing (AC-550).
- Submissions: a Table newest first with a state filter (`&state=`), Show more for older pages, and the open one (`&submission=`) in a Panel: its answers through each type's display, the records it touched (links to their pages), the bot check's verdict, the owner it gave, refused answers and why it failed. Retry (failed only) and Delete need `forms.manage`.
- Not live yet: the submissions list doesn't update while open (no `forms` change event in milestone 1); Refresh is reloading the page.
