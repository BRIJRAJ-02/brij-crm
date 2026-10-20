# FormEditorLayout

The form builder's page under the TopBar: the status line, the tabs, notices, and the body beside its live preview.

## Why it exists

New. The builder (spec 0023, `0023-experience.md`, The editor: layout) opens full width, outside SettingsLayout's navigation, with a status line ("● Published · v7", "○ Not published") and a sticky 400px preview column that moves under the body, in "Show preview", when both don't fit. SettingsLayout keeps its navigation and has no side column, and RecordLayout's side panel holds fields, not a preview; a variant of either would have bent it. The TopBar above holds the name (with its rename pencil), Preview, Publish and the menu.

## Use

```tsx
<FormEditorLayout
  status={{ tone: 'changed', text: 'Published · Unpublished changes' }}
  tabs={<SegmentedControl … />}
  notices={problem && <Callout tone="danger">{problem}</Callout>}
  previewControls={<><Select label="Colour" isLabelHidden size="sm" … /><Select label="Corners" isLabelHidden size="sm" … /></>}
  preview={<HostedFormPreview form={previewOf(draft)} />}
>
  <QuestionList … />
</FormEditorLayout>
```

- `status.tone`: `live` (success dot), `changed` (warning dot), `draft` and `paused` (hollow dot).
- Two columns from 880px of its own width; under that the preview sits in a Disclosure under the body. The width is measured, since a Disclosure can't be switched on and off by a container query.
- Beside the body, the preview has its own header row, level with the body's first header: a "Preview" heading (which names the column) and, at its end, `previewControls`, the look's compact Selects with hidden labels and values that say what they set ("Light", "Rounded corners"). Under the body, in "Show preview", the controls sit alone above the frame. Why: the Selects sat over the frame with no heading, and did not read as the preview's settings (owner feedback F27, 20 October 2026).
- Leave `tabs` out for a form that was never published, and `preview` out on tabs that have none.
- `actions` puts a page's own action at the top end (the forms list's New form, which sits under the Captures tabs with no TopBar of its own).
- `FormEditorStatus` is the status line on its own, for the TopBar's meta beside the form's name, so the header stays one line; the editor passes no `status` to the layout then.

## States

- Wide (two columns, the preview sticky) and narrow (the preview in "Show preview" under the body); with or without tabs and notices; each status tone.

## Keyboard

Nothing of its own: focus moves through the body, then the preview's Selects (the preview itself is inert).
