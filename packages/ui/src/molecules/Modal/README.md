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
        <Button slot="close" kbd="ESC">
          Cancel
        </Button>
        <Button variant="danger-solid" icon="trash" onPress={remove}>
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
- `peek` is a page read and written in place, as Notion's centre peek: a note. The panel is the writing column (`size-column-max`, 640px) with three `space-32` either side (832px), a `size-bar` from the window's top and bottom (the whole window, edge to edge, under `bp-page-compact`). Its bar is quiet: no hairline, no icon and no title drawn (the `title` still names the dialog, for screen readers, since the page shows its own title), with `context` first as a crumb (the note's record) and `status`, `headerActions` and Close at the end. The body is the page: a centred column at most `size-column-max` wide (`space-16` from the edge on a phone), with room under the text to write into. Why a variant: it is still a modal over the page, with the same focus, Esc, click outside and motion; only its size and its quiet bar differ, and a window's title bar and 780px box made a note read as a form (the owner's call, 21 October 2026).
- Every modal but the palette is centred in the viewport, across and up and down (the owner's call on 19 October 2026, replacing the earlier fixed distance from the top). The palette alone sits near the top (twice `size-bar`), as command palettes do. A peek is centred too, nearly the window's height.
- `actions` is the footer: Cancel first (`slot="close"` closes the modal), the primary last. Give Cancel `kbd="ESC"` and a form's primary `kbd="⌘↵"`: a `Form` submits on ⌘↵ (Ctrl+Enter elsewhere) from any of its fields. A destructive confirm uses `tone="danger"` with a `danger-solid` commit (When to ask first, below).
- `tone="danger"` makes it an alert dialog with a warning icon; a click outside won't close it, so a destructive answer is always deliberate.
- `isDismissable={false}` keeps a click outside from closing a form once something is typed in it, so only Cancel or Esc throws input away (as Outlook does). `isBusy` while its form saves disables the title bar's close button and the click outside too; disable the footer's Cancel yourself.
- Open it from a `ModalTrigger`, or control it with `isOpen` and `onOpenChange`.

## When to ask first

The house rule (the owner's ask, 21 October 2026): anything that ends something, or can't be taken back in one click, asks first in a confirm. That is sign out, a delete with no Undo, removing or revoking access, disconnecting, cancelling, leaving, transferring, resetting, purging, discarding unsaved changes, and any change to many records at once.

- **Two shapes.** Destructive: `tone="danger"` (an alert dialog that a click outside won't close) with a `danger-solid` commit. A non destructive end (sign out, unpublish, a restore of many): the plain dialog with a `primary` commit.
- **Copy.** The title is the question, naming the thing: "Delete the Q4 pipeline view?", "Cancel Quick chat with Ada Lovelace?". Then one or two short sentences: what happens, and whether it can be undone ("They stay in the trash for 30 days.", "This can't be undone."). The footer: the dismiss first with `kbd="ESC"`, the verb last, naming what it does ("Delete view", "Remove block"), never OK, Yes or Confirm. The dismiss reads Cancel; where the verb is itself Cancel or Discard it names what it keeps instead ("Keep booking", "Keep job", "Keep editing").
- **While it works.** The commit shows busy (`isPending`, its label saying so: "Deleting…") and the dialog is `isBusy`, so Esc and the dismiss wait. A refusal shows inside, as a danger `Callout` above the text, and the dialog stays open to try again or cancel. Where the data layer already says a refusal itself (the jobs store's toast), the dialog closes once the answer comes. A change that shows at once behind the dialog (an optimistic delete) still waits there for the server: keep what the dialog stands on mounted until then.
- **Focus.** Cancel and Esc put focus back on the trigger (`ModalTrigger` does it; a controlled Modal returns it to whatever had focus when it opened). When the trigger went with the change (a deleted card, a row's Confirm), move focus with `focusLater` to the nearest sensible place: the row, the day, else the page's title. Never leave it on the page.
- **The Undo exception.** An action that acts at once with an Undo toast, and can be restored (the `ghost-danger` pattern in Button's README: a task, a note, a question, one record to the trash), stays one click. A second step on top of an Undo adds friction without adding safety. So does a stop: a running bulk change's Cancel stays one click, since a confirm would let more batches run while it waits.
- Working examples: `ArchiveObjectDialog` and `ArchiveAttributeDialog` in `apps/web/src/features/settings`, the booking page delete in `apps/web/src/features/booking/LinksScreen.tsx`, and SaveBar's Discard.

## States

Opening grows it from the centre over the scrim in `duration-modal`; closing fades it in `duration-exit`. Opened from the keyboard it appears at once. Reduced motion keeps the fade.

## Keyboard

Focus moves into it when it opens and stays inside; Tab cycles. The title bar and footer are plain boxes, never `header` and `footer`, so an open dialog adds no second banner or contentinfo landmark. Esc closes it (unless the caller keeps it open) and focus returns to the trigger.

## Differences from the artifact

- `variant`, `icon`, `actions` and `context` keep their meaning; `width` is gone (`size-dialog` 480px or `size-dialog-wide` 780px); `ariaLabel` is the `title`. The `peek` variant is new (21 October 2026).
- `tone="danger"` (an alert dialog that a click outside won't close), `isDismissable`, `isBusy` and the exit animation are new.
