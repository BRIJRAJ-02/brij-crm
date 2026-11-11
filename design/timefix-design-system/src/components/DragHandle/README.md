DragHandle is the 6-dot grip a row or card is moved by; SortableList is the list that orders rows with it. Both sit on `lib/drag.ts`, the one drag wrapper (dnd-kit), so every drag in the app moves the same way.

**Use it for**: every list the owner orders by hand: booking and form questions, pipeline stages, select options, view fields, sidebar items, menu sections and dishes, services, tables. **Don't** draw a grip on a row that can't move, or make the whole row the only way to drag.

**The consumer provides**: DragHandle `label` ("Move Work email"), `isLifted`, `reveal` (`hover` default, `always` on touch-first lists), `size` and `drag` (the `grip` props from `useDragRow`). SortableList `items` (with `id`), `label`, `getText`, `onReorder` (the whole list in its new order) and a render function for the row's content. For a list with its own markup, use `DragList` (or `DragArea` with `DragGroup` for several groups, like stage groups) and `useDragRow` from `lib/drag.ts` directly: spread `row` on the row and `grip` on its DragHandle.

**States**: hidden until its row is hovered or holds focus (always shown on touch screens), hover (grey wash, text-secondary), focus-visible (2px ring), lifted (accent, grabbing cursor).

**Interaction**: one feel everywhere. Pointer: grab the grip and move 4px; a copy lifts under the pointer (`shadow-md`, scale 1.02, no tilt, class `tf-drag-lift`), where it will land stays open as a dashed `border-strong` gap (`[data-drag-row][data-dragging]`), and the rows around it slide aside live over 250ms on `--ease-smooth-out`. On release the copy glides into the gap and the row settles. Under a CSS zoom (the dashboard draws at 88%) it measures in the page's own units, so the copy stays under the pointer. Keyboard: Tab to the grip, Space or Enter lifts, arrows move, Space or Enter drops, Esc puts it back; a screen reader hears "Picked up Work email, position 2 of 5" and each step. With `prefers-reduced-motion` nothing slides or glides.

**Replaces**: DragHandle and the drag wrapper's sortable lists (RowOrder).
