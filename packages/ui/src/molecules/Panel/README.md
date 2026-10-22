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
- `actions` go at the end of the header, before the close button; `footer` holds a form's buttons, at its end. `footerStart` puts a destructive action at the footer's start, away from the main one (a submission's Delete beside Not spam invited a slip, 22 October 2026).
- `width`: `md` (`size-panel`, 400px) for a record, `lg` (`size-panel-wide`, 520px) for notes, email and larger tasks.
- `variant`: `sheet` (the default) runs the full height against the end of the page; `floating` sits `space-8` in from the edges on `radius-xl`, for the record panel (`RecordPanel`).
- `leading` goes before the title, such as the record's avatar.
- `subtitle` puts one quiet line under the title: what the subject belongs to and when (a form submission's form and its time, as Attio's side panel names the object under a record). Why a prop: a screen can't set a line under the panel's heading itself, and a bare "Submission" title said nothing about who sent it (22 October 2026).
- `isStacked` lays the content out as a column of sections, `space-20` apart: a form submission's state, its answers, where it came from and the records it touched, each a FieldGroup. Why a variant: the body stacked its children with no space, so a screen's section headings sat on the line before them, and screens can't space blocks themselves (22 October 2026). It is for content that scrolls with the panel; `isFlush` content scrolls itself, so the two are never set together.
- `isFlush` runs the content to the edges and gives it the panel's height, for Tabs and lists that scroll themselves.
- It is not modal: the page beside it stays usable, so focus can leave it with Tab or a click.

## States

Opening slides it in over `duration-modal` on `ease-drawer`; closing slides and fades it out in `duration-exit`, and it is removed when that ends. Opened from the keyboard it appears at once. Reduced motion keeps a fade.

## Keyboard

Focus moves to the first thing in it when it opens. Esc closes it and focus returns to where it was before.

## Differences from the artifact

Not in the artifact.
