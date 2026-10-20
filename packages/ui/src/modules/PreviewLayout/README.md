# PreviewLayout

Every Captures editor's body under its TopBar: the Tabs, notices, then the editor beside a sticky live preview (the booking page editor, spec 0025; the form editor, spec 0023).

## Why it exists

New for the booking page editor (no layout put a sticky side column beside a form), then made the one editor layout on 20 October 2026. The two Captures editors had been built two ways: PreviewLayout (24px padding, a window media query, a footer bar) and FormEditorLayout (16, 24 and 32 padding, a measured width, a status line with its own dot). Two layouts for one job drift apart, so FormEditorLayout was merged into this one and removed.

It kept this name, not the form's: it is the general one (any editor beside its preview, a page in a frame or a drawn one), and the booking page editor's footer, which the SaveBar replaces, already sat in its `footer`. SettingsLayout brings the settings navigation and has no side column; RecordLayout's side panel holds fields, not a preview; PageColumn has no sticky column or Disclosure. A variant of any of them would have bent it.

## Anatomy

- **TopBar** (the shell's, above): crumbs back to the list, the name as the title, `EditorStatus` in its `meta` when the subject has a published state, and the actions.
- **Tabs** (optional): the library Tabs, edge to edge under the TopBar, with one TabPanel per tab holding a PreviewLayout, the Captures strip's way. The first tab's label lands on the page gutter, its hairline runs the view's width, and each tab is a real tab panel for screen readers.
- **Notices** (`notices`, Callouts), full width inside the gutter.
- **Body**: the children stacked `space-16` apart (SettingsStack's rhythm), groups of fields as `Card`s with a live summary as each Card's description, as on a settings page. It takes the whole width, with the preview column beside it (owner rule, 20 October 2026: every page is full width).
- **Preview column**: a header row (a "Preview" heading that names the column, then `previewControls` at its end, level with the body's first header; owner feedback F27), then `previewNote` over the `preview` in one hairline frame with `radius-lg`, the panel's width (`size-panel`), sticky `space-16` from the top, right beside the body.
- **Footer** (`footer`): a bar pinned to the body's foot while given.

Everything under the tabs sits inside the page gutter, `space-16`, PageColumn's, so an editor lines up with the list it opened from.

## Use

```tsx
<PreviewLayout
  notices={problem && <Callout tone="danger">{problem}</Callout>}
  previewControls={<PreviewDeviceSwitch value={device} onChange={setDevice} />}
  preview={<PreviewFrame src={`/b/${page.publicKey}`} title={page.title} device={device} version={page.updatedAt} draft={draft} />}
  footer={isDirty ? <SaveBar … /> : undefined}
>
  <Card title="Meeting" description="30 min · Video">…</Card>
</PreviewLayout>
```

- **Two columns while the body keeps at least 480px** (`bp-container-md`) beside the 400px column and the gutter: a container query on the layout's own width, never the window's. Container conditions take only breakpoint tokens, so the container (`.measure`) is the width left for the body, and its children reach back over that padding to the full width. Narrower, the column hides and the preview sits under the body in a "Show preview" Disclosure (the controls alone above the frame, the Disclosure naming it), drawn only while open, so a narrow page loads no second frame until asked.
- **`footer` is the SaveBar's slot.** Pass the bar while there is something to save and leave it out otherwise; it sticks `space-16` above the view's foot while the body scrolls.
- **`bodyLayout="grid"`** sets the body's groups in as many columns as fit, each at least the panel's width (`size-panel`), with `repeat(auto-fill, minmax(…))`, so it needs no container query: a settings tab's Cards sit side by side on a wide view and stack on a narrow one. The footer spans every column. Why a variant: a settings tab's groups are short Cards that read well side by side on a full width page, while a question list or a table needs one column; a screen can't lay out a grid itself.
- **`preview`** is a `PreviewFrame` or a drawn preview (`HostedFormPreview`). Leave it out on a tab with nothing to preview.
- **`PreviewFrame`** loads `src` in a frame titled "Preview of {title}", laid out at the device's width (phone 390, tablet 768, desktop 1280) and scaled to fit, so nothing scrolls sideways. It loads again when `version` changes and posts `draft` (`{ type: 'crm:preview', draft }`, same origin only) when it changes and when the frame loads. The frame is `inert` and out of the tab order. What it shows is the public page itself, untouched.
- **`PreviewDeviceSwitch`** is the Phone, Tablet and Desktop SegmentedControl for `previewControls`; the editor holds the device.
- **`EditorStatus`** is the TopBar's status: a StatusDot, green when live, orange when changed since publishing, gray when not published or paused, and its words always say it. It is an editor's own state, not an attribute value, so StatusDot draws it here rather than through the field set.

## States

With and without tabs (around it), notices, preview controls, a note and a footer; wide and narrow (the Disclosure closed and open); phone, tablet and desktop; each status tone. Loading, empty, error and read only are the body's (Skeleton, EmptyState, Callout, read only Fields).

## Keyboard

Tab moves through the notices, the body and its footer, then the preview's controls. The preview takes no focus. In the narrow layout, Enter or Space on "Show preview" opens it.

## Differences from the artifact

Not in the artifact. Pressing a region of the preview to scroll the editor to its group is left for later: the frame is a separate page.
