# PreviewLayout

An editor beside a live preview of what it edits, with a Phone, Tablet and Desktop width switch (spec 0025 experience, the booking page editor).

## Why it exists

New. The booking page editor shows the real public page beside its groups, sticky, at the width a visitor would see it. No layout in the library puts a sticky side column beside a form, and the public page can't render inside the app (it is its own bundle), so the preview is the page itself in a frame.

## Use

```tsx
<PreviewLayout
  previewSrc={`/b/${page.publicKey}`}
  previewTitle={page.title}
  previewVersion={page.updatedAt}
  previewDraft={draft}
  footer={isDirty ? <UnsavedBar /> : undefined}
>
  <Card title="Meeting">…</Card>
</PreviewLayout>
```

- The preview loads `previewSrc` in a frame titled "Preview of {title}", and loads again when `previewVersion` changes (after a save).
- The switch sets the width the page is laid out at (phone 390, tablet 768, desktop 1280 CSS pixels); the frame scales that down to fit the side column (24rem, or 40% of a small screen), so the page never scrolls sideways.
- `previewDraft` is posted to the frame (`{ type: 'crm:preview', draft }`, same origin only) when it changes and when the frame loads, so the page can show unsaved edits.
- Below the page breakpoint, the preview sits under a "Show preview" Disclosure after the editor.
- The frame is `inert` and out of the tab order: the preview is to look at, so pressing in it never books a real time.
- `previewNote` is said above the frame when what it shows needs a word (a paused page shows its closed state).
- `footer` sticks to the editor's foot while given.

## States

Phone, tablet and desktop; wide and narrow; with and without a footer.

## Keyboard

Tab moves through the editor, its footer, then the width switch (arrows change it) and into the frame.

## Differences from the artifact

Not in the artifact. Pressing a region of the preview to scroll the editor to its group is left for later: the frame is a separate page.
