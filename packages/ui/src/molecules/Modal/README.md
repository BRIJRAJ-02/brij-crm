# Modal

A dialog over the page that waits for an answer: a confirm, a short form, a larger task.

## Why it exists

Ported from the artifact's Modal card. Confirms, invites, exports, imports and merges (#22, #23, #30, #31, #37) all open the same way. It wraps React Aria's `ModalOverlay`, `Modal` and `Dialog`, so focus is held inside while it is open and returns to its trigger after, and adds the exit animation the artifact lacks.

## Use

```tsx
<ModalTrigger>
  <Button variant="danger" icon="trash">
    Delete
  </Button>
  <Modal
    title="Delete 3 records?"
    tone="danger"
    actions={
      <>
        <Button slot="close">Cancel</Button>
        <Button variant="danger-solid" onPress={remove}>
          Delete records
        </Button>
      </>
    }
  >
    Their notes, tasks and history are deleted too. You can't undo this.
  </Modal>
</ModalTrigger>
```

- `variant`: `dialog` (the default, `size-dialog`, 480px) for a question or a short form; `window` (`size-dialog-wide`, 780px) for a larger task, whose title bar also holds an `icon` and a `context` (the record or list). Both have a title bar over a hairline with the title and a close button, and `headerActions` puts quiet icon buttons before Close, each in its Tooltip (a task's Copy link), and `status` puts a short word before them in the secondary colour, announced politely as it changes (a note's "Saving…" or "Saved"). Why a slot: an action about what the dialog shows sits with its title, and a footer band holding only it read heavy (the owner's call, 20 October 2026); an alert (`tone="danger"`) asks with its buttons only, so it has no close button. `palette` (`size-palette`, 640px) is the command palette's: near the top, its `title` for screen readers only, its body flush. Like every modal it appears at once when opened from the keyboard, which is how ⌘K opens it.
- `peek` is a page read and written in place, as Notion's centre peek: a note. The panel is the writing column (`size-column-max`, 640px) with three `space-32` either side (832px), a `size-bar` from the window's top and bottom (filling the window's height under `bp-page-compact`). Its bar is quiet: no hairline, no icon and no title drawn (the `title` still names the dialog, for screen readers, since the page shows its own title), with `context` first as a crumb (the note's record) and `status`, `headerActions` and Close at the end. The body is the page: a centred column at most `size-column-max` wide (`space-16` from the edge on a phone), with room under the text to write into. Why a variant: it is still a modal over the page, with the same focus, Esc, click outside and motion; only its size and its quiet bar differ, and a window's title bar and 780px box made a note read as a form (the owner's call, 21 October 2026).
- Every modal but the palette is centred in the viewport, across and up and down (the owner's call on 19 October 2026, replacing the earlier fixed distance from the top). The palette alone sits near the top (twice `size-bar`), as command palettes do. A peek is centred too, nearly the window's height.
- `actions` is the footer: Cancel first (`slot="close"` closes the modal), the primary last. Give Cancel `kbd="ESC"` and a form's primary `kbd="⌘↵"`: a `Form` submits on ⌘↵ (Ctrl+Enter elsewhere) from any of its fields. A destructive confirm uses `tone="danger"` with a `danger` Button.
- `tone="danger"` makes it an alert dialog with a warning icon; a click outside won't close it, so a destructive answer is always deliberate.
- `isDismissable={false}` keeps a click outside from closing a form once something is typed in it, so only Cancel or Esc throws input away (as Outlook does). `isBusy` while its form saves disables the title bar's close button and the click outside too; disable the footer's Cancel yourself.
- Open it from a `ModalTrigger`, or control it with `isOpen` and `onOpenChange`.

## States

Opening grows it from the centre over the scrim in `duration-modal`; closing fades it in `duration-exit`. Opened from the keyboard it appears at once. Reduced motion keeps the fade.

## Keyboard

Focus moves into it when it opens and stays inside; Tab cycles. The title bar and footer are plain boxes, never `header` and `footer`, so an open dialog adds no second banner or contentinfo landmark. Esc closes it (unless the caller keeps it open) and focus returns to the trigger.

## Differences from the artifact

- `variant`, `icon`, `actions` and `context` keep their meaning; `width` is gone (`size-dialog` 480px or `size-dialog-wide` 780px); `ariaLabel` is the `title`. The `peek` variant is new (21 October 2026).
- `tone="danger"` (an alert dialog that a click outside won't close), `isDismissable`, `isBusy` and the exit animation are new.
