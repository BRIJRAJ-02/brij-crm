The peek drawer: a record opened beside its list so people can read and edit it without leaving the table.

**Use it for**: previewing a row from a table, board or search. **Don't** use it for settings or forms (a Dialog) or as the full record page.

**The consumer provides**: `isOpen`, `onClose`, `objectName`, `label`, `recordKey` (changing it slides the body), `position` (previous and next), `onExpand`, and the body: a header, `AttributeRow`s and `RecordSection`s. `AttributeRow` takes an attribute and value and edits in place; `RecordSection` takes a title, count, `onAdd` and children. `PageSlide` is exported for any two-view surface.

**States**: closed (inert), open, switching records, sections collapsed or open, first and last record.

**Interaction**: the panel rises in from 60px right through (panel reveal, 400ms in, 350ms out) and takes focus; Esc closes and hands focus back. J and K move between records; the body leaves 8px one way while the next arrives from the other through (page side-by-side, 250ms). Sections fold on React Aria's measured height (accordion, 250ms).

**Replaces**: RecordPanel, the side column of RecordLayout, RelatedRecords.
