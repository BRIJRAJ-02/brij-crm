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
- The look is the form's own (`look.colour`, `look.corners`), whatever the app's theme.

- The layout is the form's own (`layout`, spec 0063): Classic draws `HostedForm`, Steps and One at a time `HostedFormSteps`; a change of layout starts the preview again from its first step.

## FormLayoutThumbnail

A form's layout in miniature, for the editor's Layout tiles (TileGrid's `choice` variant, spec 0063 AC-6302): Classic as a small card of three fields over its button, Steps as a card with a progress line, two fields and Back beside Continue, and One at a time as one larger question and its OK, with no card.

```tsx
<TileGrid variant="choice" label="Layout" value={layout} tiles={[{ id: 'steps', name: 'Steps', thumbnail: <FormLayoutThumbnail layout="steps" /> }]} />
```

Why here and new: a choice tile takes a Lucide mark or a thumbnail, and no mark draws a form's layout (each new mark would also cost every page's first load, `packages/ui/AGENTS.md`). LinkPageThumbnail draws a link page's look, not a form's shape, and Skeleton is a loading state, not a picture. It lives beside the preview because it pictures the same thing: the form a visitor gets. It is shapes only, in tokens, still, inert and hidden from screen readers (the tile's name says which layout). States: the three layouts, in light and dark (`HostedFormPreview.stories.tsx`, Layout tiles).

## States and keyboard

- `preview`: nothing in it is reachable; the note is read once.
- `page`: Tab follows the question order, Enter in a single line field submits, errors sit under their fields with the first one focused, the alert line sits over the button, and the thank you takes focus on its heading.

## Differs from the artifact

The artifact has no form preview. `logo` (the Timefix wordmark at the foot) defaults to the web app's own files; stories pass a stand in.
