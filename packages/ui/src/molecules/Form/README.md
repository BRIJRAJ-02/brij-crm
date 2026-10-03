# Form

A form that maps the server's refusals to its fields: fields stacked `space-16` apart, a refusal about no one field above them, and the submit button last.

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
- `refusals` are the last answer's refusals, in any shape with `code`, `message` and an optional `attributeId` (`FormRefusal`). `fieldFor` turns one into the `name` of the field it is about (often straight from `attributeId`, or through a map from attribute ids to field names). That field shows the message until the person changes it.
- A refusal `fieldFor` doesn't map (no attribute, a rate limit, a lost connection) shows above the fields as a danger Callout, which is announced. Without `fieldFor`, every refusal shows there. Make sure a mapped name matches a field, or the message has nowhere to show.
- Each submit is a new answer: the same refusal again shows again, even on a field the person had changed. Refusals are hidden while `isBusy`.
- `isBusy` while the server answers: the submit spins and reads `busyLabel`, and Enter or a second press does nothing. `isDisabled` turns the submit off (disable the fields too).
- `actionsLayout="end"` (the default) puts the buttons in a row at the end, with `actions` (Cancel) before the submit, as in a dialog. `"stack"` fills the width with them, the submit first and `actions` (another way to go on, such as Continue with Google) under it, as on a sign in page.
- It checks nothing itself and the browser's checks are off: a module or screen says what is wrong in the library's words, as a refusal (SignInForm turns its "Enter your email address." into one) or a Field `error`.
- `label` names the form for screen readers when no heading near it does.

## States

Idle, field refused (on the field, which reads as invalid), form refused (Callout above the fields), busy (the submit spins, refusals hidden), disabled (the submit is off).

## Keyboard

Enter in a single line field submits. When refusals arrive, focus moves to the first refused field, whose description reads the refusal; if focus is already there (the person pressed Enter in it), the refusal is announced instead.

## Differences from the artifact

Not in the artifact.
