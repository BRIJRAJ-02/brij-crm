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

- `onTextChange` (T21, 5 November 2026, after Tally) makes the headline and the button editable where they are: a quiet press target is laid exactly over each (measured, and again as the preview resizes), with a dashed accent edge on hover, focus or while open, and pressing it opens a Popover by it with the words (Headline and Line under it; or Button text), which change the preview as they are typed. The rest of the preview stays inert. The button is editable where it shows the form's own words (Classic, or the last step). Why an overlay and not editable parts in the form: the hosted page's tree is what every visitor loads, against the tightest budget in the product, so it carries nothing for the builder.
- The layout is the form's own (`layout`, spec 0063): Classic draws `HostedForm`, Steps and One at a time `HostedFormSteps`; a change of layout starts the preview again from its first step.

## FormLayoutThumbnail

A form's layout in miniature, for the editor's Layout tiles (TileGrid's `choice` variant, spec 0063 AC-6302): Classic as a small card of three fields over its button, Steps as a card with a progress line, two fields and Back beside Continue, and One at a time as one larger question and its OK, with no card.

```tsx
<TileGrid
  variant="choice"
  label="Layout"
  value={layout}
  tiles={[{ id: 'steps', name: 'Steps', thumbnail: <FormLayoutThumbnail layout="steps" /> }]}
/>
```

`rows` draws a _particular_ form's answers instead of the layout's own one line fields, as shapes rather than controls (spec 0063, AC-6323): `field` a one line box, `long` a taller box, `choices` a stack of lines, `rating` five round marks, `scale` a row of boxes across the width, `date` a short box, `upload` a dashed box. That is what a template's tile shows, so a glance tells a feedback form from a signup one; without it the layout decides, which is what the three Layout tiles want.

```tsx
<FormLayoutThumbnail layout="classic" rows={['field', 'rating', 'long']} />
```

Why here and new: a choice tile takes a Lucide mark or a thumbnail, and no mark draws a form's layout (each new mark would also cost every page's first load, `packages/ui/AGENTS.md`). LinkPageThumbnail draws a link page's look, not a form's shape, and Skeleton is a loading state, not a picture. It lives beside the preview because it pictures the same thing: the form a visitor gets. It is shapes only, in tokens, still, inert and hidden from screen readers (the tile's name says which layout). States: the three layouts, and a template's own rows, in light and dark (`HostedFormPreview.stories.tsx`, Layout tiles and Template tiles).

- `ending` draws the thank you (`{}`) or an ending (its `heading` and `line`) in the form's place while the owner has it open in the builder (5 November 2026, from the builder lane), exactly as a visitor reads it after sending; only in `preview` mode. Left out, the form shows.

## States and keyboard

- `preview`: nothing in it is reachable; the note is read once.
- `page`: Tab follows the question order, Enter in a single line field submits, errors sit under their fields with the first one focused, the alert line sits over the button, and the thank you takes focus on its heading.

## Differs from the artifact

The artifact has no form preview. `logo` (the Timefix wordmark at the foot) defaults to the web app's own files; stories pass a stand in.
