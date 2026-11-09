DragHandle is the 6-dot grip a row or card is moved by; SortableList is the list that orders rows with it.

**Use it for**: every list the owner orders by hand: booking and form questions, pipeline stages, select options, view fields, sidebar items, board cards. **Don't** draw a grip on a row that can't move, or make the whole row the only way to drag.

**The consumer provides**: DragHandle `label` ("Move Work email"), `isLifted`, `reveal` (`hover` default, `always` on touch-first lists), and `slot` (`drag` inside a React Aria GridList or Table row, `null` elsewhere). SortableList `items` (with `id`), `label`, `getText`, `onReorder` (the whole list in its new order) and a render function for the row's content.

**States**: hidden until its row is hovered or holds focus (always shown on touch screens), hover (grey wash, text-secondary), focus-visible (2px ring), lifted (accent, grabbing cursor).

**Interaction**: React Aria drag and drop. Pointer: grab the grip and drag. Keyboard: Tab to the grip, Enter lifts, arrows choose the slot, Enter drops, Esc cancels; each step is announced. The dragged row lifts (shadow-md, scale 1.02, no tilt), the source stays as a 40% ghost, the drop slot opens as a dashed border-strong placeholder over 250ms, and the dropped row settles from the lift over 250ms with the smooth-out ease.

**Replaces**: DragHandle and the drag wrapper's sortable lists (RowOrder).
