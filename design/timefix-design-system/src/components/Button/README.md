Buttons start an action; they are pills, and each view region has at most one ink primary.

**Use it for**: `primary` (ink) is the one thing this view is for (Save changes, Book, Create). `secondary` (white, hairline) is every other visible action. `soft` (grey) is a quiet action inside a card (Next, Complete). `ghost` is for toolbars, rows and icon buttons. `danger` is only the last step of something that cannot be undone. **Don't** fill a button with blue (blue means selected) or put two primaries side by side.

**The consumer provides**: a verb label in sentence case, optional `icon` / `iconEnd` (Lucide, 16px; 14px at `sm`), `size` (`sm` 28, `md` 36, `lg` 44), `isPending`, `isDisabled`, `onPress`. `IconButton` needs a `label` for screen readers and a Tooltip.

**States**: rest, hover (background washes in, 100ms), pressed (scales to 0.97, icon buttons 0.92), focus-visible (2px ring), pending (spinner replaces the icon, width holds, presses ignored), disabled (45% and not-allowed, still focusable for its tooltip). A menu trigger stays pressed (`surface-selected`) while its menu is open.

**Interaction**: Enter and Space press. Labels that change state crossfade through `TextSwap` (Save changes → Saving → ✓ Saved → back), so the button never jumps in width.

**Replaces**: Button, the dashed variant (now an `Add` row pattern), ad hoc icon buttons.
