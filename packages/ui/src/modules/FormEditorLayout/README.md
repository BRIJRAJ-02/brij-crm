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
  previewControls={<><Select label="Colour" … /><Select label="Corners" … /></>}
  preview={<HostedFormPreview form={previewOf(draft)} />}
>
  <QuestionList … />
</FormEditorLayout>
```

- `status.tone`: `live` (success dot), `changed` (warning dot), `draft` and `paused` (hollow dot).
- Two columns from 880px of its own width; under that the preview sits in a Disclosure under the body. The width is measured, since a Disclosure can't be switched on and off by a container query.
- Leave `tabs` out for a form that was never published, and `preview` out on tabs that have none.
