Breadcrumbs show where a page sits: its parents as grey links and the current page in bold ink, with a long trail folding its middle into a menu.

**Use it for**: the top bar title of a record or nested setting (Companies › Acme Corp), and deep settings paths. **Don't use it for**: a single-level page (show the title alone) or steps in a flow (use a stepper).

**The consumer provides**: `items` (`id`, `label`, optional `href`, optional 16px icon or 20px `Avatar`), `onAction` for router navigation, `maxVisible` (default 4: the first crumb, a "…" menu, then the last two), and `size` (`title` 15px in the top bar, `md` 14px, `sm` 13px).

**States**: parent (grey, washes on hover), current (bold ink, not a link, `aria-current="page"`), folded (a 28px "…" button that stays pressed while its menu is open), truncated (parents shrink before the current page and end in an ellipsis).

**Interaction**: each parent is a tab stop; Enter follows it. The "…" button opens a menu of the hidden pages that grows from the button (transitions.dev 05, menu dropdown: 250ms in to full scale from .97, 150ms out to .99); arrows move through it, Esc closes it and returns focus.

**Replaces**: Breadcrumbs.

**Phone**: under 40rem only the current page shows; the earlier steps and separators fold away, so the title never pushes the top bar's actions off screen.
