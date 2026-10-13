# AttributeSettings

The one dialog that creates and edits an attribute (spec 0012): its name, type, the type's settings and options, API name, description, rules and default.

## Why it exists

New (from the inventory, `0003-inventory.md`, pulled forward from spec 0003's milestone 4 by spec 0012). Settings' Attributes tab, the grid's "+" header, a column's "Edit attribute" and the table's "Add attribute" all create or edit attributes, and each type's settings must be right in one place. No existing component held a type picker, the rules and a default drawn by the type's own editor; a Form in a Modal is what it is made of, so it composes Modal, Form, Field, Select, Checkbox, RadioGroup and the field set's AttributeEditor rather than adding a variant to any one of them.

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
- `readOnlyReason` shows every setting read only, the reason once in a Callout above them, and Close alone (a system attribute, or a member who can't change the schema).
- `relationshipEntry` (`{ label, onChoose }`, #15) adds "Relationship" last to the picker; choosing it calls `onChoose({ title })` with the name typed so far, so the screen swaps in RelationshipSettings in its place and the name carries over to the near side. Without it there is no entry and no placeholder.
- The default is drawn by the type's own form editor (`AttributeEditor`, `surface="form"`), so it looks and edits as the value does everywhere. A date also offers "Today plus days" (0 to 3,650, refused locally otherwise) and a member "Current user", as a RadioGroup labelled "Default value" above the editor (None, then the kinds): a saved setting, which SegmentedControl, made for switching views, is not. `members` feeds the member picker. An empty editor, or an unticked checkbox, means no default.
- Refusals land on the setting they name by `attributeId` (`title`, `apiSlug`, `description`, `type`, `isUnique`, `defaultValue`, `offsetDays`); anything else shows above the settings. An empty name is refused before anything is sent.
- **Type settings** (milestone 3, AC-230), right under the type: a Number's Display (Plain or Percent, a RadioGroup, as the default's kind is: a saved setting, not a view switch), a Currency's default code (a searchable Select, USD until changed; one is always set). They go out as `values.config`, and on an edit `changed` names `config` once touched.
- **Options** (AC-230, AC-236): a Select, Multi select or Status draws the OptionsEditor under the type. On create the dialog keeps them as a draft: a new select opens with one blank row to type in (it waits for Tab, so focus stays on the type picker), a new status starts with the starter stages (`STARTER_STAGES`: Not started and In progress open, Done won), and Create sends them as `values.options`, each with an id from `newOptionId`. Switching between Select and Multi select keeps them. On an edit the options come in as `attribute.options` and each change goes out at once through `optionWrites` (`onAdd`, `onChange`, `onMove`, `onArchive`, `onRestore`, with `pending` and `errors` back), which the editor's hint says ("Changes to options save as you make them."); Save keeps the rest. Without `optionWrites` an existing attribute's options are read only. `optionsLimit` shows "N of 500".
- **Rules** (spec 0013, AC-252): the attribute's validation rules, last, through RulesEditor: each reads as the message a broken rule gives, opens in place to its settings, its message and "Only when…", and moves by drag, keyboard or its menu. `attribute.rules` brings them in, `values.rules` sends the list with Save (it replaces the attribute's rules), and `changed` names `rules` once touched. `ruleAttributes` (the object's own attributes) feed "Only when…"; without them a rule takes no condition. `newRuleId` mints each new rule's id. Each rule's settings are checked on Save with `checkRuleSettings` from `@crm/contracts/values`, the server's own check, so a refusal lands on its setting before anything is sent; the server's `rules.<index>.<setting>` refusals land the same way, and one about the list (the 20 rule limit) under it. Changing the type before create drops the rules it can't take. A type that takes no rule (a checkbox) shows no section.
- **The default of a select or status** offers the options being edited. When it names an archived option, a Callout under it says what new records get meanwhile (AC-236): "This option is archived. New records get <first live option>." for a required attribute, "… New records get no value." otherwise. A draft option removed before create takes a default naming it with it.

## States

Create, edit, read only, busy (the primary spins with its ongoing verb, Cancel is off, and the dialog stays), a type's settings, options (draft before create, written as they change after), a default naming an archived option, refused (on the setting, or above them), each default kind, and rules (closed, open, refused on their setting, read only).

## Keyboard

Focus starts in the name. Tab moves through the settings in order. ⌘↵ (Ctrl+Enter elsewhere) submits from anywhere in it; Enter submits from a single line field; Esc closes it unless the server is answering, and focus returns to what opened it.

## Differences from the artifact

Not in the artifact. A Number's Display is a RadioGroup, not the SegmentedControl spec 0012's screens name, for the reason the default's kind is one. Rules are Checkboxes, not Switches: they are saved with the form, and the Switch takes effect at once (its README). The name comes before the type, as the object and record dialogs ask for the name first, so the first focused field is the one to type in.
