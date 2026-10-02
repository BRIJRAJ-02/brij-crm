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
        <Button variant="danger" onPress={remove}>
          Delete records
        </Button>
      </>
    }
  >
    Their notes, tasks and history are deleted too. You can't undo this.
  </Modal>
</ModalTrigger>
```

- `variant`: `dialog` (the default, `size-dialog`, 480px) for a question or a short form; `window` (`size-dialog-wide`, 780px) for a larger task, with a header that holds an `icon`, the `title`, a `context` (the record or list) and a close button. `palette` (`size-palette`, 640px) is the command palette's: near the top, its `title` for screen readers only, its body flush. Like every modal it appears at once when opened from the keyboard, which is how ⌘K opens it.
- `actions` is the footer: Cancel first (`slot="close"` closes the modal), the primary last. A destructive confirm uses `tone="danger"` with a `danger` Button.
- `tone="danger"` makes it an alert dialog with a warning icon; a click outside won't close it, so a destructive answer is always deliberate.
- Open it from a `ModalTrigger`, or control it with `isOpen` and `onOpenChange`.

## States

Opening grows it from the centre over the scrim in `duration-modal`; closing fades it in `duration-exit`. Opened from the keyboard it appears at once. Reduced motion keeps the fade.

## Keyboard

Focus moves into it when it opens and stays inside; Tab cycles. Esc closes it (unless the caller keeps it open) and focus returns to the trigger.

## Differences from the artifact

- `variant`, `icon`, `actions` and `context` keep their meaning; `width` is gone (`size-dialog` 480px or `size-dialog-wide` 780px); `ariaLabel` is the `title`.
- `tone="danger"` (an alert dialog that a click outside won't close) and the exit animation are new.
