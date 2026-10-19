# Board

A view of kind `board` (spec 0021): one column per option of a status or single select field, plus a "No <field>" column first, each column's cards in the view's sort order with its count. The view screen (`../views/ViewScreen.tsx`) shows it in place of the table, under the same bars and Toolbar, so filters, drafts and Save work on a board unchanged.

## Brief

- **Purpose**: see one object's records as a pipeline, a column per stage.
- **Main task**: see where every record stands and drag a card to its next column, live for everyone.
- **Leaves out**: the board's View settings (Group by, Show empty columns, Card fields) and the stuck badge (milestone 3), and creating records from the board.

## Files

| File              | Owns                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BoardScreen.tsx` | The bars and the board: the store from `data.records.board` (kept on screen until the next question's store exists), `useBoard` for every column's window, each window as a column's `ListSource` of cards (names, card fields through the field set, members and linked records named), a card opening its record page; a drop calls the store's `move` (one optimistic value write, with undo; a refusal comes back with a toast and Retry) and says "Moved <name> to <column>." through the Toolbar's status; a drag holds every column still; a required field's no value column refuses drops; a field the member can't write (or an object at read) shows no handles and each card's lock says why |
| `plan.ts`         | `planBoard`: the view's stored board settings while they still group by a live status or single select, else the defaults (`boardDefaults`); the columns in order and the archived options among them; or why there is no board (nothing to group by, an archived grouping field, more than 50 options)                 |
| `strings.ts`      | The copy                                                                                                                                                                                                                                                                                                                |

## States

Loading (the Board's skeleton columns after the loading delay, and three skeleton cards in a column whose call is still out), failed with Try again (from the call that failed, the columns already in kept), nothing to group by (with Add attribute for `schema.manage`), an archived grouping field, more than 50 options, no columns (a field with no options yet), an empty column ("No cards"), hidden empty columns, a filtered count past 10,000 ("10,000+"), read only with each card's lock, a refused drop, and live paused in the view bar.

## Not yet

- The Table and Board switch changes this visit only: saving the kind (and the board's defaults the first time) for everyone needs `views.setLayout` from spec 0020 milestone 2.
- Show empty columns is kept for this visit only, for the same reason.
