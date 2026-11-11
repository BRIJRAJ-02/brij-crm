An object's attributes on its settings page: the ordered list, New attribute, and the dialog that creates and edits one attribute (the same surface as New object).

**Use it for**: Settings › Objects › Attributes, a grid's "+ Add attribute" and a column's "Edit attribute" (open `AttributeDialog` alone). **Don't use it for**: a record's values (AttributeField) or a relationship's two sides (RelationshipSettings).

**The consumer provides**: `objectName`, `objectPlural`, `attributes` (`SchemaAttribute`: the field system's Attribute plus `isRequired`, `isUnique`, `isSystem`, `numberFormat`, `defaultValue`, `options`), `onChange` with the whole new list, and `valueCounts` for the type change warning. `AttributeList`, `AttributeTypePicker` and `reorder` are exported for other screens.

**States**: rows with Required, Unique and System badges; dragging (lifted copy, ghost source, dashed slot); a saved row washes once; archived (a Callout with Undo). Dialog: create (type cards open, name focused), edit (current type, "Change type…"), type changed (warning Callout), system attribute (type locked), empty name (shake and hint), saving, saved.

**Interaction**: press a row or Enter to edit; drag by the grip, or Enter on the grip, arrows, Enter. The dialog opens with the modal motion (06); Archive sits at the start of its actions, Cancel and Save at the end; the type cards, currency and number format settings open with the accordion (21); select and status types show the OptionsEditor; the default is the type's own AttributeField. The default value is one field: while it edits, its editor is the box.

**Replaces**: AttributeSettings.
