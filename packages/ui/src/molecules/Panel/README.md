# Panel

A side panel that slides in from the end and leaves the page usable beside it.

## Why it exists

New. The record panel (#17), notifications (#28) and the assistant (#54) open beside the table rather than over it, so they can't be a Modal, which blocks the page. Panel gives them one sheet, one slide (`ease-drawer`) and one way to close.

## Use

```tsx
<Panel
  title="Northwind Traders"
  isOpen={isOpen}
  onClose={close}
  actions={<Button icon="ellipsis" label="Record actions" />}
>
  …
</Panel>
```

- `isOpen` and `onClose` are the caller's; the close button and Esc call `onClose`.
- `actions` go at the end of the header, before the close button; `footer` holds a form's buttons.
- `width`: `md` (`size-panel`, 400px) for a record, `lg` (`size-panel-wide`, 520px) for notes, email and larger tasks.
- `variant`: `sheet` (the default) runs the full height against the end of the page; `floating` sits `space-8` in from the edges on `radius-xl`, for the record panel (`RecordPanel`).
- `leading` goes before the title, such as the record's avatar.
- `isFlush` runs the content to the edges and gives it the panel's height, for Tabs and lists that scroll themselves.
- It is not modal: the page beside it stays usable, so focus can leave it with Tab or a click.

## States

Opening slides it in over `duration-modal` on `ease-drawer`; closing slides and fades it out in `duration-exit`, and it is removed when that ends. Opened from the keyboard it appears at once. Reduced motion keeps a fade.

## Keyboard

Focus moves to the first thing in it when it opens. Esc closes it and focus returns to where it was before.

## Differences from the artifact

Not in the artifact.
