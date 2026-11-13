# Panel

A side panel that slides in from the end and leaves the page usable beside it.

## Why it exists

New. The record panel (#17), notifications (#28) and the assistant (#54) open beside the table rather than over it, so they can't be a Modal, which blocks the page. Panel gives them one sheet, one slide (`ease-smooth-out`) and one way to close.

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
- The title is cut with an ellipsis when it doesn't fit, and shows whole in a tooltip (TruncatedText), so a long sender's name can still be read (22 October 2026).
- `subtitle` puts one quiet line under the title, the head then padded `space-16` above and below as the body is (lane 3c: the name sat 13px from the top edge): what the subject belongs to and when (a form submission's form and its time, as Attio's side panel names the object under a record). Why a prop: a screen can't set a line under the panel's heading itself, and a bare "Submission" title said nothing about who sent it (22 October 2026).
- `isStacked` lays the content out as a column of sections, `space-20` apart: a form submission's state, its answers, where it came from and the records it touched, each a FieldGroup. Why a variant: the body stacked its children with no space, so a screen's section headings sat on the line before them, and screens can't space blocks themselves (22 October 2026). It is for content that scrolls with the panel; `isFlush` content scrolls itself, so the two are never set together.
- `isFlush` runs the content to the edges and gives it the panel's height, for Tabs and lists that scroll themselves.
- `pushesPage` narrows the page beside it by its width while it is open: AppShell's main column, bars and all, gives up `size-panel` (`size-panel-wide` for `lg`) through `PanelPushContext`, so nothing on the page sits under it (a form's submission beside its table: the table's search and the editor's header stayed hidden under the sheet, lane 3c, 4 November 2026). Why a prop: only the panel knows it is open, and only the shell can narrow its column. The room comes back as it starts to leave. At AppShell's compact width, or outside AppShell, it lies over the page as before. For `sheet`: a `floating` panel sits inset, so the page would give up its width only.
- `closeAs="back"` draws the close as Back (`arrow-left`, named by `backLabel`, "Back" by default) at the head's start, and no X at its end, for a panel that fills a phone's screen, where the way out is looked for at the top left (lane 3c). It still calls `onClose`. Why a prop: a screen could add a Back button in `leading`, but the X stayed, so the phone had two ways out of one panel.
- `onStep` hears ↑ (`previous`) and ↓ (`next`) pressed inside the panel where nothing else owns the arrows (a field, contenteditable, tabs, a list, a grid, a menu, a radio group): the record panel steps through the list it was opened from (Twenty's side panel, the CRM flow pass, 31 October 2026). Why a prop: only the panel knows a key happened inside it, and a document listener would also hear keys meant for a dialog opened over it. The content swaps at once, with no motion, since it is a key pressed many times a day.
- It is not modal: the page beside it stays usable, so focus can leave it with Tab or a click.
- Toasts keep off its `footer`: a toast that would sit over the footer's buttons rises above them, as it does for a Modal's (4 November 2026).

## States

Open overlaid; open pushing the page (`pushesPage`, the AppShell story `PushedByPanel`); closing with Back on a phone (`CloseAsBack`).

Opening slides it in over `duration-fast` on `ease-smooth-out` (the floating record panel over `duration-slow`); closing slides and fades it out over `duration-quick`, the house's exit, for both variants, and it is removed when that ends. Opened from the keyboard it appears at once. Reduced motion keeps a fade.

## Keyboard

Focus moves to the first thing in it when it opens. Esc closes it and focus returns to where it was before. With `onStep`, ↑ and ↓ step to the item above or below, except inside a field, tabs, a list, a grid or a menu, whose arrows stay theirs.

## Differences from the artifact

Not in the artifact.
