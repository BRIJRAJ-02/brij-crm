# Form

A form that maps the server's refusals to its fields: fields stacked `space-16` apart, a refusal about no one field above them, and the submit button last, filling the width (or, in a Modal, in the Modal's footer).

## Why it exists

New (spec 0005, pulled forward from spec 0003's milestone 4). Sign in, verify, the welcome screen and the core loop's dialogs (new person, add attribute) all send a few fields and get refusals back: `{ code, message, attributeId? }`, about one attribute or about nothing in particular. Nothing in the library mapped a server's refusals to fields: Field takes one `error` at a time, and every screen would have wired its own. A variant of Field couldn't do it, since the mapping spans every field in the form. It is a thin layer over React Aria's `Form`, so the fields read their refusals from it by `name`.

## Use

```tsx
<Form
  submitLabel="Create workspace"
  busyLabel="Creating workspace"
  isBusy={pending}
  refusals={refusals} // [{ code: 'SLUG_TAKEN', message: 'That address is taken. Try another.', attributeId: 'slug' }]
  fieldFor={(refusal) => refusal.attributeId}
  onSubmit={({ name, slug }) => create(name, slug)}
>
  <Field label="Workspace name" name="name" defaultValue={suggested} />
  <Field label="Web address" name="slug" />
</Form>
```

- Give every field a `name`. `onSubmit` gets each named field's text.
- `refusals` are the last answer's refusals, in any shape with `code`, `message` and an optional `attributeId` (`FormRefusal`). `fieldFor` turns one into the `name` of the field it is about (often straight from `attributeId`, or through a map from attribute ids to field names). That field shows the message until its value differs from the one refused: as soon as a key is typed (not on blur, so the form never shifts under a press of the submit), or when the screen fills the field in itself (a web address following a name). Clearing never moves focus. A dropped refusal stays dropped for that answer: changing the value back to the refused one doesn't bring it back, so a screen never keeps its own copy of what was dropped. Only the next answer (a submit, or new `refusals`) shows it again.
- The form reads its fields' values only while a field still shows a refusal of the current answer, so a form with nothing to drop does no work per keystroke. It listens on the document, after React has handled the event: a listener on the form ran first and its re-render put a controlled field's old value back. React's own `onInput` on the form would avoid that too, but it reaches only fields in the form's React tree, while the browser also sends a field outside it that names the form with `form` (a field in a portal, or beside a Modal's footer). Such a linked field counts as the form's own: it is sent, takes its refusal by `name` (when it is rendered inside the Form, as through a portal), and loses it as it changes.
- A refusal `fieldFor` doesn't map (no attribute, a rate limit, a lost connection) shows above the fields as a danger Callout, which is announced. Without `fieldFor`, every refusal shows there. So does one mapped to a name no field in the form has (an attribute this form doesn't show), so no message ever vanishes; give the field that `name` to show it in place.
- Each submit is a new answer: the same refusal again shows again, even on a field the person had changed. Refusals are hidden while `isBusy`.
- `isBusy` while the server answers: the submit spins and reads `busyLabel`, and Enter or a second press does nothing. `isDisabled` turns the submit off (disable the fields too). `submitDescribedBy` takes the ids of lines that describe the submit, such as why it is off (SignInForm points it at its email field's reason, through Field's `descriptionId`).
- The submit (`size="lg"`, `isFullWidth="center"`) fills the width under the fields, as on a sign in page or the welcome screen. `actions` go under it: another way to go on, such as Continue with Google, as a `Button` with `size="lg"` and `isFullWidth="center"`. The column never stretches a button; each asks to fill through Button's own variant.
- **In a Modal**, the submit lives in the Modal's footer, not in the form. Leave out `submitLabel` (and `busyLabel` and `actions`), give the Form an `id`, and put the primary in Modal's `actions` as a `Button` with `type="submit"` and `form` set to that `id`. Pressing it, or Enter in a field, submits the form; Cancel comes first with `slot="close"`. The Form can't reach a submit outside it, so pass each state to both: while the server answers, `isBusy` to the Form (so a second submit does nothing) and `isPending` with the ongoing verb to the Button; when the form can't be sent, `isDisabled` to the Form (so Enter in a field does nothing) and `isDisabled` to the Button (so it reads and acts as off), with `aria-describedby` on the Button pointing at the line that says why:

  ```tsx
  <Modal
    title="New person"
    actions={
      <>
        <Button slot="close">Cancel</Button>
        <Button variant="primary" type="submit" form="new-person" isPending={pending} isDisabled={!canAdd}>
          {pending ? 'Adding person' : 'Add person'}
        </Button>
      </>
    }
  >
    <Form
      id="new-person"
      isBusy={pending}
      isDisabled={!canAdd}
      refusals={refusals}
      fieldFor={toField}
      onSubmit={add}
    >
      <Field label="Name" name="name" />
    </Form>
  </Modal>
  ```
- It checks nothing itself and the browser's checks are off: a module or screen says what is wrong in the library's words, as a refusal (SignInForm turns its "Enter your email address." into one) or a Field `error`.
- `label` names the form for screen readers when no heading near it does.

## States

Idle, field refused (on the field, in its hint's place, which reads as invalid, until its value changes, and then not again until the next answer), form refused (Callout above the fields, also for a refusal mapped to a field the form lacks), busy (the submit spins, refusals hidden), disabled (the submit is off), another way to go on (under the submit), in a Modal (the submit in its footer).

## Keyboard

Enter in a single line field submits, in a Modal too (the footer's submit names the form). Tab goes through the fields, then the submit, then any `actions`. When a new answer brings refusals, focus moves to the first refused field, whose description reads the refusal; if focus is already there (the person pressed Enter in it), the refusal is announced instead.

## Differences from the artifact

Not in the artifact.
