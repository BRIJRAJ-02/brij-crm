A kanban board: a column per status, white cards that move between and within columns by pointer, keyboard or screen reader.

**Use it for**: board views and pipelines grouped by a status or single select. **Don't use it for** more than about eight columns (use the table grouped) or for ordering a short list (a sortable list).

**The consumer provides**: `label`, `noun`, `columns` (id, title, status shape, optional hue, cards, `isCollapsed`), `onMove` (apply it with the exported `moveCards` for an optimistic update), `onAdd`, `onToggleCollapse`, `onOpen`. A card has tags, a title, a two-line description, people and a `date` (a Date, worded Today, Tomorrow or "13 Nov").

**States**: column with cards, empty column (dashed "No deals" slot), collapsed rail, card hover, focused, lifted (the card follows the pointer, a dashed gap where it will land, the cards around it sliding aside), incoming (the target column's header reads "Lead → Qualified"), settling, new card.

**Interaction**: drag from anywhere on a card (after a 4px move, so a press still opens it); a copy lifts under the pointer (`shadow-md`, 1.02, no tilt) and where it will land stays open as a dashed `border-strong` gap. The other cards slide aside live, in its own lane and in any lane it crosses into (dnd-kit sortable, 250ms on `--ease-smooth-out`), and on release the copy glides into the gap and settles. Every lane takes a drop down its full height. Under a CSS zoom (the prototype draws the dashboard at 88%) the board measures in the page's own units, so the copy stays under the pointer. While a card from another column is over a column, that column's header crossfades to "Lead → Qualified" (source status, arrow, target status) like Jira's, fading in with a 4px rise over 250ms (04 text states swap) and out over 150ms; reordering within a column shows nothing. By keyboard: focus the grip, Space or Enter to lift, Left and Right jump to the next lane at the same height, Up and Down step past the card above or below, Space or Enter drops, Esc puts it back; focus returns to the grip and a screen reader hears each step. With `prefers-reduced-motion` nothing slides or glides. Counts roll. Added cards drop in at the top (0fr to 1fr and a 12px rise). The chevron folds a column to Attio's 24px rail with a vertical title; its width eases (01 card resize).

**Production note**: virtualise long columns with RAC's `Virtualizer` and a `ListLayout`.

**Replaces**: Board.

**Lanes**: every lane runs the board's full height (the tallest lane, or the space the screen gives the board), and the whole lane takes a drop: between cards slots it there, anywhere below the last card puts it last.
