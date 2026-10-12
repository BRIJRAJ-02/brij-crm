# AttributeSettings

The one dialog that creates and edits an attribute (spec 0012): its name, type, API name, description, rules and default.

## Why it exists

New (from the inventory, `0003-inventory.md`, pulled forward from spec 0003's milestone 4 by spec 0012). Settings' Attributes tab, the grid's "+" header, a column's "Edit attribute" and the table's "Add attribute" all create or edit attributes, and each type's settings must be right in one place. No existing component held a type picker, the rules and a default drawn by the type's own editor; a Form in a Modal is what it is made of, so it composes Modal, Form, Field, Select, Checkbox, SegmentedControl and the field set's AttributeEditor rather than adding a variant to any one of them.

## Use

```tsx
<AttributeSettings
  isOpen={isOpen}
  onOpenChange={setOpen}
  typeKeys={['text', 'long_text', 'date', 'checkbox', 'rating', 'email', 'phone', 'link', 'location', 'member']}
  members={members}
  isBusy={pending}
  refusals={refusals} // [{ code: 'SLUG_TAKEN', message: '…', attributeId: 'apiSlug' }]
  onSubmit={(values) => save(values)}
/>
<AttributeSettings isOpen onOpenChange={close} attribute={jobTitle} onSubmit={(values) => edit(values.changed)} />
<AttributeSettings isOpen onOpenChange={close} attribute={createdAt} readOnlyReason="Created at is set by the system." onSubmit={() => undefined} />
```

- Presentational: the attribute, `isBusy` and the last answer's `refusals` come in; `onSubmit(values)` hands out what was chosen, with `changed` listing the settings the person touched, so an edit sends only those. The screen talks to the data layer and closes the dialog when the server agrees.
- Without `attribute` it creates: the name first and focused, the type picker (`PICKER_TYPES` from `@crm/contracts/values`, in AC-228's order, narrowed by `typeKeys`; Multi select, Link and Phone are the picker's own labels, the rest the field set's), the API name following `toApiSlug(name)` until typed over (emptied, it follows again), the description, Required, Unique (only for the types the engine can keep unique), Allow multiple (Email, Phone, Member) and the default. Changing the type starts its default, Unique and Allow multiple again.
- With `attribute` it edits: the type and Allow multiple read only ("Changing the type comes later."), the API name read only with a copy button, the rest as they are, and Save.
- `readOnlyReason` shows every setting read only with that reason and Close alone (a system attribute, or a member who can't change the schema).
- `relationshipEntry` (`{ label, onChoose }`, #15) adds "Relationship" last to the picker; choosing it calls `onChoose`, so the screen swaps in its own settings in the same place. Without it there is no entry and no placeholder.
- The default is drawn by the type's own form editor (`AttributeEditor`, `surface="form"`), so it looks and edits as the value does everywhere. A date also offers "Today plus days" (0 to 3,650, refused locally otherwise) and a member "Current user", as a choice above the editor (None, then the kinds). `members` feeds the member picker. An empty editor, or an unticked checkbox, means no default.
- Refusals land on the setting they name by `attributeId` (`title`, `apiSlug`, `description`, `type`, `isUnique`, `defaultValue`, `offsetDays`); anything else shows above the settings. An empty name is refused before anything is sent.
- Not yet (spec 0012, milestone 3): the type settings (Number's display, Currency's code, Status's starter stages), the options editor, and the "Default archived" note.

## States

Create, edit, read only, busy (the primary spins with its ongoing verb, Cancel is off, and the dialog stays), refused (on the setting, or above them), and each default kind.

## Keyboard

Focus starts in the name. Tab moves through the settings in order. ⌘↵ (Ctrl+Enter elsewhere) submits from anywhere in it; Enter submits from a single line field; Esc closes it unless the server is answering, and focus returns to what opened it.

## Differences from the artifact

Not in the artifact. Rules are Checkboxes, not Switches: they are saved with the form, and the Switch takes effect at once (its README). The name comes before the type, as the object and record dialogs ask for the name first, so the first focused field is the one to type in.
