A drawer is a side sheet from the right for editing or reading one thing without leaving the page.

**Use it for**: editing a contact, a booking or a record's fields; a submission's answers; notifications. `DrawerPanel` is the same surface placed in the layout, for a record panel or an aside that pushes the page. **Don't** open a dialog on top of a drawer (use a popover), or use a drawer for a one-question confirm (use ConfirmDialog).

**The consumer provides**: `title`, optional `subtitle` and `leading` (an avatar), header `actions`, the body, `footerStart` (Delete, as a ghost button), and for a form `saveState` (`clean`, `dirty`, `saving`, `saved`), `onSave`, `onDiscard`, `saveLabel`. `width` is `md` (440) or `lg`. Mark optional fields "(optional)" rather than starring required ones.

**States**: clean (footer shows Done), dirty (Discard and Save changes crossfade in), saving (spinner), saved (drawn tick and "Saved"), scrolled (a hairline appears under the sticky header).

**Interaction**: focus moves into the drawer and returns to the trigger; Tab cycles inside. When clean, Esc, × and a click outside close it. With unsaved changes they keep it open and shake the footer once with "Save or discard first", so nothing is lost by accident. Opens with transitions.dev panel reveal along x (a quarter of its width, 400ms), closes in 350ms; the footer's groups swap over 150ms.

**Replaces**: Panel, ItemSheet, AsideLayout's sheet, the RecordPanel and QrSheet shells.
