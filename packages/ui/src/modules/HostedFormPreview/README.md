# HostedFormPreview

The form a visitor fills in, inside the app: the builder's live preview column, and a draft opened to try.

## Why it exists

New. The builder must show exactly what goes live (spec 0023, `0023-experience.md`, The editor: layout), so it renders the hosted page's own component, `HostedForm` (`src/public-form/`), which draws with the library's Field, Select, CountryPicker, PhoneField and the rest. Since 19 October 2026 the hosted page, the embed and this preview are one component tree.

## Use

```tsx
<HostedFormPreview form={previewOf(draft)} />
<HostedFormPreview form={previewOf(draft)} mode="page" />
```

- `preview` (the default) is inert: nothing in it takes focus or submits, assistive tech skips it, and a visually hidden note says it is a preview.
- `page` checks the answers as the server would and shows the thank you, but sends nothing.
- The look is the form's own (`look.colour`, `look.corners`), whatever the app's theme. It sits on the form's own ground (`surface` in that look), which fills whatever height its container gives it: in PreviewLayout's phone, a short form's colour runs to the frame's foot, a light form in dark mode included (spec 0058).

## States and keyboard

- `preview`: nothing in it is reachable; the note is read once.
- `page`: Tab follows the question order, Enter in a single line field submits, errors sit under their fields with the first one focused, the alert line sits over the button, and the thank you takes focus on its heading.

## Differs from the artifact

The artifact has no form preview. `logo` (the Timefix wordmark at the foot) defaults to the web app's own files; stories pass a stand in.
