# PreviewLayout

Every Captures editor's body under its TopBar: the Tabs, notices, then the editor in the first two thirds of the width, beside a sticky live preview drawn in a phone, centred in the last third (the booking page editor, spec 0025, and the form editor's Form tab, spec 0023). The owner, 22 October 2026: the booking editor's tabs split into loose masonry columns read badly, so the preview came back, phone only, with the editor as one column of sections beside it. The preview is optional: a tab with nothing to preview leaves it out and the body takes the whole width (the `FullWidth` story).

## Why it exists

New for the booking page editor (no layout put a sticky side column beside a form), then made the one editor layout on 20 October 2026. The two Captures editors had been built two ways: PreviewLayout (24px padding, a window media query, a footer bar) and FormEditorLayout (16, 24 and 32 padding, a measured width, a status line with its own dot). Two layouts for one job drift apart, so FormEditorLayout was merged into this one and removed.

It kept this name, not the form's: it is the general one (any editor beside its preview, a page in a frame or a drawn one), and the booking page editor's footer, which the SaveBar replaces, already sat in its `footer`. SettingsLayout brings the settings navigation and has no side column; RecordLayout's side panel holds fields, not a preview; PageColumn has no sticky column or Disclosure. A variant of any of them would have bent it.

## Anatomy

- **TopBar** (the shell's, above): crumbs back to the list, the name as the title, `EditorStatus` in its `meta` when the subject has a published state, and the actions.
- **Tabs** (optional): the library Tabs, edge to edge under the TopBar, with one TabPanel per tab holding a PreviewLayout, the Captures strip's way. The first tab's label lands on the page gutter, its hairline runs the view's width, and each tab is a real tab panel for screen readers.
- **Notices** (`notices`, Callouts), full width inside the gutter.
- **Body**: the children stacked `space-16` apart (SettingsStack's rhythm), groups of fields as `Card`s with a live summary as each Card's description, as on a settings page. It takes the whole width, with the preview column beside it (owner rule, 20 October 2026: every page is full width).
- **Preview column**: the last third of the width, `space-32` after the body: a header row (a "Preview" heading that names the column, then `previewControls` at its end, level with the body's first header; owner feedback F27), then `previewNote`, then the `preview` in a phone (375 by 812, laid out at that size and scaled to fit the column's width and the view's height, never above 1), centred in the column with a hairline, `radius-xl` and `shadow-xs`, sticky `space-16` from the top. There is no width switch: the phone is the one preview (the owner, 22 October 2026).
- **Footer** (`footer`): a bar at the view's foot while given, `space-16` above it and centred on the body's column, whether the body is short or long (the owner, 22 October 2026: on a short tab the SaveBar floated mid page under the last field). The layout fills the view's height so the bar sits at its foot; on a long body it is sticky after the last field, so scrolled to the end it never covers it. This holds for the default stacked body in the two column layout; with `bodyLayout="grid"`, or in the narrow layout, the bar follows the last group and sticks while the body scrolls. The bar's own motion is the FloatingBar's.

Everything under the tabs sits inside the page gutter, `space-16`, PageColumn's, so an editor lines up with the list it opened from.

## Use

```tsx
<PreviewLayout
  bodyWidth="form"
  notices={problem && <Callout tone="danger">{problem}</Callout>}
  preview={<PreviewFrame src={`/b/${page.publicKey}`} title={page.title} version={page.updatedAt} draft={draft} />}
  footer={<SaveBar … />}
>
  <Card title="Details">…</Card>
  <Card title="Sharing">…</Card>
</PreviewLayout>
```

- **Two columns while the phone's column would keep at least `bp-container-sm`** (320px, a layout of about 992px): a container query on the layout's own width, never the window's. Container conditions take only breakpoint tokens, so the container (`.measure`) is as wide as the phone's column would be (its end padding takes the body's two thirds and the `space-32` between), and its children reach back over that padding to the full width. The body then takes `2fr` and the phone column `1fr`, so the phone is never drawn below about 85% of its size. Narrower, the column hides and a "Preview" button (smartphone icon) at the end of a row over the body opens the phone in a Modal `sheet`, with a "Preview" heading and the controls above it, drawn only while open, so a narrow page loads no second frame until asked. The body's column is a size container of its own, so a SettingsRow inside it answers to the column's width.
- **`footer` is the SaveBar's slot.** Pass the bar while there is something to save and leave it out otherwise; it sticks `space-16` above the view's foot while the body scrolls.
- **`bodyWidth="form"`** holds each of the body's groups to `size-column-max`, centred in the body's column, the footer still spanning it: a tab of fields keeps each Select near its label instead of across the page (the owner, 22 October 2026: selects 1600px from their labels, then fields floating in masonry columns). Why a variant: a screen can't size its own column. The masonry `columns` width was removed with it.
- **`bodyLayout="grid"`** sets the body's groups in as many columns as fit, each at least the panel's width (`size-panel`), with `repeat(auto-fill, minmax(…))`, so it needs no container query: a settings tab's Cards sit side by side on a wide view and stack on a narrow one. The footer spans every column. Why a variant: a settings tab's groups are short Cards that read well side by side on a full width page, while a question list or a table needs one column; a screen can't lay out a grid itself.
- **`preview`** is a `PreviewFrame` or a drawn preview (`HostedFormPreview`), which the layout draws in the phone. When what it draws runs past the phone's foot (a long form), the screen scrolls and becomes a focusable region named "Phone preview", the phone's outline showing focus, so the keyboard can scroll it as the pointer does. Leave it out on a tab with nothing to preview.
- **The body's Cards are `h2`** (CardTitleLevel 2), level with the Preview heading beside them, under the TopBar's `h1`.
- **`PreviewFrame`** loads `src` in a frame titled "Preview of {title}" that fills the phone. It loads again when `version` changes and posts `draft` (`{ type: 'crm:preview', draft }`, same origin only) when it changes and when the frame loads. The frame is `inert` and out of the tab order. What it shows is the public page itself, untouched.
- **`EditorStatus`** is the TopBar's status: a StatusDot, green when live, orange when changed since publishing, gray when not published or paused, and its words always say it: beside the dot from 480px, and as one word on a phone's bar (Live, Edited, Draft, Paused: StatusDot's `shortLabel`), so the name keeps its room while the dot is never the only cue; screen readers read the full words. It is an editor's own state, not an attribute value, so StatusDot draws it here rather than through the field set.

## States

With and without tabs (around it), notices, preview controls, a note and a footer; wide and narrow (the sheet closed and open); the form width; each status tone. Loading, empty, error and read only are the body's (Skeleton, EmptyState, Callout, read only Fields).

## Keyboard

Tab moves through the notices, the body and its footer, then the preview's controls. The preview's page takes no focus; a long one's screen takes one stop, where the arrows scroll it. In the narrow layout, Enter or Space on "Preview" opens the sheet; Esc or Close shuts it and focus goes back to the button.

## Differences from the artifact

Not in the artifact. Pressing a region of the preview to scroll the editor to its group is left for later: the frame is a separate page.
