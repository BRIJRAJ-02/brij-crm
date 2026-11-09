A dialog asks one question or collects a short form over a scrim, and holds the page until it is answered.

**Use it for**: `ConfirmDialog` only for sign out, delete, remove, disconnect and cancel: a question title that names the thing ("Delete Acme Corp?"), one line of consequence, a red (or ink, for sign out) action and a ghost Cancel. `InviteDialog` is the form pattern: one email per row and "Add another". `StepDialog` is a two to four step wizard in one card. **Don't** confirm anything reversible (offer Undo in a toast), stack a dialog on a dialog, or add header, body and footer bands.

**The consumer provides**: `title`, `description`, the body, `actions` (quiet way out first, one primary last), `size` (`sm` confirm, `md` 480, `wide` 720), `isOpen`/`onOpenChange` or a `DialogTrigger`. `DialogField` is the filled text input for overlay forms. `DialogPreview` draws one in place for docs.

**States**: closed, opening, open, pending (the action shows a spinner; Esc and the scrim are held), invalid rows (red edge plus one line), step n of m.

**Interaction**: focus moves in and is trapped; Cancel takes focus first in a confirm. Esc, × and a click outside mean "keep editing" and close without acting. Enter submits a form. Opens with transitions.dev modal (0.96 → 1, 250ms; out 150ms); steps slide side by side (8px, 3px blur, 250ms) while the card's height eases to fit; new invite rows drop in.

**Replaces**: Modal, ModalTrigger, the confirm patterns, InviteDialog.
