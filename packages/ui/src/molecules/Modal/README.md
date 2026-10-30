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
    variant="confirm"
    tone="danger"
    actions={
      <>
        <Button slot="close">Cancel</Button>
        <Button variant="danger-solid" icon="trash" onPress={remove}>
          Delete records
        </Button>
      </>
    }
  >
    Their notes, tasks and history are deleted too. This can’t be undone.
  </Modal>
</ModalTrigger>
```

- `variant`: `dialog` (the default, `size-dialog`, 480px) for a question or a short form; `window` (`size-dialog-wide`, 780px) for a larger task, whose title bar also holds an `icon` and a `context` (the record or list). Both have a title bar over a hairline with the title and a close button, and `headerActions` puts quiet icon buttons before Close, each in its Tooltip (a task's Copy link), and `status` puts a short word before them in the secondary colour, announced politely as it changes (a note's "Saving…" or "Saved"). Why a slot: an action about what the dialog shows sits with its title, and a footer band holding only it read heavy (the owner's call, 20 October 2026); an alert (`tone="danger"`) asks with its buttons only, so it has no close button. `palette` (`size-palette`, 640px) is the command palette's: near the top, its `title` for screen readers only, its body flush. Like every modal it appears at once when opened from the keyboard, which is how ⌘K opens it.
- `form` (`size-dialog-form`, 560px) is a dialog for several fields: New record and an attribute's settings. Why a variant: at 480px a label and its value crowded, and a 780px window read as a larger task than a short form (Attio's Create attribute and Invite sit at 560 to 640px; 30 October 2026).
- `confirm` (`size-dialog-sm`, 400px) asks one question before an ending action, as Attio's do: no title bar, no icon and no close button; the `title` opens the body in the title's 15px as the question, and `children` is the one line of consequence under it, in the secondary colour. The footer has no hairline. With `tone="danger"` it stays an alert dialog (a click outside won't close it, the line is its description); without it (Sign out) it is a plain dialog. Why a variant: a title bar with a triangle and a grey footer band made a two button question read as a form (30 October 2026). Use it for every confirm in When to ask first. A confirm draws only `title`, `children`, `actions`, `tone`, `isBusy` and the open state: `icon`, `context`, `headerActions` and `status` live in the title bar it doesn't have, so they are ignored.
- `isWide` makes a `window` 980px (`size-dialog-wide` plus a `size-column`), for a reference laid out as a settings page is: a rail of sections down the left beside their content (the marketing site's All features sheet, 23 October 2026). Why a variant: at 780px the rail and two columns of features fought for room; nothing else in the app needs it, so it is a flag on `window`, not a size every modal takes.
- `sheet` is a phone's card for one thing on the page, as Google Calendar's event sheet: the window's width, pinned to its foot with its top corners rounded, at most the window less a `size-bar`, rising from the foot (`ease-drawer`, a fade under reduced motion). Its bar holds Close alone (the `title` names it for screen readers), since what it holds has its own heading. Why a variant: a week's block opens its MeetingCard in a Popover beside it, which on a phone covered the day it was about; the sheet keeps the same focus, Esc, press outside and return of focus as every modal (22 October 2026). PreviewLayout opens its phone preview in one on a narrow layout (any window too narrow for the preview column, not only a phone), with its own Preview heading inside (22 October 2026).
- `peek` is a page read and written in place, as Notion's centre peek: a note. The panel is the writing column (`size-column-max`, 640px) with three `space-32` either side (832px), a `size-bar` from the window's top and bottom (the whole window, edge to edge, under `bp-page-compact`). Its bar is quiet: no hairline, no icon and no title drawn (the `title` still names the dialog, for screen readers, since the page shows its own title), with `context` first as a crumb (the note's record) and `status`, `headerActions` and Close at the end. The body is the page: a centred column at most `size-column-max` wide (`space-16` from the edge on a phone), with room under the text to write into. Why a variant: it is still a modal over the page, with the same focus, Esc, click outside and motion; only its size and its quiet bar differ, and a window's title bar and 780px box made a note read as a form (the owner's call, 21 October 2026).
- Every modal but the palette is centred in the viewport, across and up and down (the owner's call on 19 October 2026, replacing the earlier fixed distance from the top). The palette alone sits near the top (twice `size-bar`), as command palettes do. A peek is centred too, nearly the window's height.
- `actions` is the footer: Cancel first (`slot="close"` closes the modal), the primary last, on one row at the end, the same height. Below 480px wide (a phone) they stack, each the dialog's width, the primary on top; the order in the markup stays Cancel then the primary on purpose, so Tab still reaches the safe choice first. Don't swap it to match the stacked look. A form in a dialog puts its submit here too (`Form` with an `id`, the primary a `type="submit"` Button naming it in `form`), never its own full width submit under the fields, which is a sign in page's. The footer gives its buttons their keys by itself (30 October 2026): the `slot="close"` button shows `ESC` and a `type="submit"` primary shows `↵`, or `⌘↵` while the body holds a long text or an editor (where Enter writes a line; an element turned `contenteditable` later counts too). A submit that names a library `Form` by `form` always shows `⌘↵`: the Form submits on ⌘↵ (Ctrl+Enter elsewhere) from any control in it, while Enter submits only from a text field, so ↵ was a promise a Select or a Switch broke (UX review, 30 October 2026). A plain `confirm` (no `tone`, as Sign out) opens with focus on its `primary`, which shows `↵`, so Enter answers it; a danger confirm keeps focus on the dialog, so Enter never destroys. Don't pass `kbd` for them; a button's own `kbd` still wins, and `kbd={[]}` shows none. A destructive confirm uses `tone="danger"` with a `danger-solid` commit (When to ask first, below).
- `hint` is a quiet line at the start of the footer, before the buttons, saying what the primary will do beyond the obvious: the link page's Add item says "It goes to the end of the section. Drag it anywhere afterwards.", so nobody hunts for a place to put the block. It needs `actions`, it is one short sentence, and it is never a warning, which belongs in the body as a Callout. Below 480px it sits over the stacked buttons. Why a slot and not a line in the body: it is about the button, not about what is being filled in, and at the end of the body it read as one more field's help.
- `footerStart` is a control at the start of the footer, before the buttons, in `hint`'s place: a choice about what the primary does next, such as New record's "Create more" Switch (Create keeps the dialog open for the next one, as Attio's does). Below 480px it sits over the stacked buttons, as `hint` does. Why a slot and not `hint`: `hint` is a quiet line of text in a paragraph, never a control, and a Switch in the body read as one more field of the record (30 October 2026).
- The scrim: `dialog`, `form`, `window` and a plain `confirm` dim the page lightly (`scrim-soft`), letting `shadow-lg` lift the dialog, as Attio's do; a `peek`, a `sheet`, the palette, every alert and any dialog with `isDismissable={false}` (a form holding input) keep the full `scrim`, since they block more, ask before destroying, or won't close on a click outside, which a light dim made look possible (30 October 2026).
- The title bar is compact (30 October 2026): the close button's height and `space-8` above and below it (42px), the title in `text-body-strong` (13px), the footer the body's own `surface-raised` under its hairline, not a grey band.
- `tone="danger"` makes it an alert dialog (with a warning icon, unless it is a `confirm`); a click outside won't close it, so a destructive answer is always deliberate. Its body is the dialog's description (`aria-describedby`), so a screen reader says what happens with the question.
- **One inset.** The title bar, the body and the footer share `--overlay-inset` (styles/base.css, `space-16`): the title, the fields and the footer's buttons start and end on the same lines, the body's top padding is the gap under the title bar's hairline, and the footer is the title bar's height. The close button's glyph, not its box, ends on the inset. Put the body's pieces straight in the Modal: no `SettingsStack`, Card or other padded wrapper around them, since the body already stacks its children `space-16` apart (the owner, 22 October 2026: "the popup has the same padding issues across").
- `isDismissable={false}` keeps a click outside from closing a form once something is typed in it, so only Cancel or Esc throws input away (as Outlook does). `isBusy` while its form saves (or a confirm's commit works) disables the title bar's close button, the click outside and Esc; disable the footer's Cancel yourself.
- `isClosable={false}` keeps the person on a step until they answer it with the footer's buttons: the title bar has no close button, and Esc and a click outside do nothing. It is for what can't be shown again, as two factor's backup codes are until "I've saved these" is ticked (then the caller sets it back to `true` and Done ends it). Why a flag: `isBusy` disables Close for a moment's work and says "wait", while this step says "answer first", so Close is gone rather than greyed; never use it on an ordinary form or confirm, which Esc should always be able to leave (Q103, 23 October 2026).
- Open it from a `ModalTrigger`, or control it with `isOpen` and `onOpenChange`.

## When to ask first

The house rule (the owner's ask, 21 October 2026): anything that ends something, or can't be taken back in one click, asks first in a confirm. That is sign out, a delete with no Undo, removing or revoking access, disconnecting, cancelling, leaving, transferring, resetting, purging, discarding unsaved changes, and any change to many records at once.

- **Two shapes**, both `variant="confirm"`. Destructive: `tone="danger"` (an alert dialog that a click outside won't close) with a `danger-solid` commit. A non destructive end (sign out, unpublish, the trash's counted restore): no tone, with a `primary` commit. A confirm that holds a form or a choice (a counted change's picker) stays a `dialog`.
- **Copy.** The title is the question, naming the thing: "Delete the Q4 pipeline view?", "Cancel Quick chat with Ada Lovelace?". Then one or two short sentences in the body: what happens, and whether it can be undone ("They stay in the trash for 30 days.", "This can’t be undone."). An alert's body is its description, said with the question. The footer: the dismiss first (its ESC keycap comes by itself), the verb last, naming what it does ("Delete view", "Remove block"), never OK, Yes or Confirm. The dismiss reads Cancel; where the verb is itself Cancel or Discard it names what it keeps instead ("Keep booking", "Keep job", "Keep editing"), and where declining leaves the thing waiting, it says so ("Not now", on a counted change waiting for its confirm, whose row has a Cancel of its own).
- **While it works.** The commit shows busy (`isPending`, its label saying so: "Deleting…") and the dialog is `isBusy`, so Esc and the click outside wait; disable the dismiss too. A refusal shows inside, as a danger `Callout` above the text, and the dialog stays open to try again or cancel. Where the data layer already says a refusal itself (the jobs store's toast), the dialog closes once the answer comes. A change that shows at once behind the dialog (an optimistic delete) still waits there for the server: keep what the dialog stands on mounted until then.
- **Focus.** Cancel and Esc put focus back on the trigger (`ModalTrigger` does it; a controlled Modal returns it to whatever had focus when it opened). When the trigger went with the change (a deleted card, a row's Review), move focus with `focusLater` to the nearest sensible place: the row, the day, else the page's title. Never leave it on the page.
- **The Undo exception.** An action that acts at once with an Undo toast, and can be restored (the `ghost-danger` pattern in Button's README: a task, a note, a question, one record to the trash), stays one click. A second step on top of an Undo adds friction without adding safety.
- **Two more, for now (the owner may change them).** The bulk bar's Cancel on the change its person just started, while it runs, stays one click: it stops a change rather than makes one, and a confirm would let more batches run while it waits. Background jobs still asks before Cancel, since it lists every member's jobs for owners and admins. And a restore from the trash of up to 500 picked records goes at once: it ends nothing, and past 500 the counted restore asks.
- Working examples: `ArchiveObjectDialog` and `ArchiveAttributeDialog` in `apps/web/src/features/settings`, the booking page delete in `apps/web/src/features/booking/LinksScreen.tsx`, and SaveBar's Discard.

- The scrim is a named size container, `modal-scrim` (the viewport's width less its padding). It is public: what sits in a dialog may query it, as the footer stacks under 480px and Button hides its keycaps there. Keep the name when changing the scrim.

## States

Opening grows it from the centre over the scrim in `duration-modal`; closing fades it in `duration-exit`. Opened from the keyboard it appears at once. Reduced motion keeps the fade.

## Keyboard

Focus moves into it when it opens and stays inside; Tab cycles. The title bar and footer are plain boxes, never `header` and `footer`, so an open dialog adds no second banner or contentinfo landmark. Esc closes it (unless the caller keeps it open: `isBusy`, or `isClosable={false}`) and focus returns to the trigger.

## Differences from the artifact

- `variant`, `icon`, `actions` and `context` keep their meaning; `width` is gone (`size-dialog` 480px or `size-dialog-wide` 780px); `ariaLabel` is the `title`. The `peek` variant is new (21 October 2026).
- `tone="danger"` (an alert dialog that a click outside won't close), `isDismissable`, `isBusy`, `isClosable` and the exit animation are new.
