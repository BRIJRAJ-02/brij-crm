# HostedFormPreview

The form a visitor fills in, inside the app: the builder's live preview column, and a draft opened to try.

## Why it exists

New. The builder must show exactly what goes live (spec 0023, `0023-experience.md`, The editor: layout), so it draws with the hosted page's own renderer (`src/public-form/`, plain DOM, no React) rather than with the library's React Aria controls. This is the React wrapper that mounts it and redraws it as the draft changes. No variant of an existing component could do that: the visitor's controls are plain HTML on purpose, to keep the public page under its budget.

## Use

```tsx
<HostedFormPreview form={previewOf(draft)} />
<HostedFormPreview form={previewOf(draft)} mode="page" />
```

- `preview` (the default) is inert: nothing in it takes focus or submits, assistive tech skips it, and a visually hidden note says it is a preview.
- `page` checks the answers as the server would and shows the thank you, but sends nothing.
- The look is the form's own (`look.colour`, `look.corners`), whatever the app's theme.

## Differs from the artifact

The artifact has no form preview; this draws the public renderer's markup, styled by `HostedForm.module.css` beside it.
