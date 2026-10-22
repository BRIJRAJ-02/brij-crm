# RelationshipSettings

The one dialog that creates a relationship between two objects, or an object and itself, and renames its two sides (spec 0014).

## Why it exists

New (spec 0014 names it). The table's "Add attribute" (through AttributeSettings' `relationshipEntry`), an attribute's settings (`?attribute=<id>`) and the schema map (#56) all create or rename relationships, and the four cardinalities, the default names and the sentence must read the same everywhere. AttributeSettings shapes one attribute on one object; a relationship is two attributes on two objects with a shared cardinality, so a variant of it would carry a second set of fields and rules none of its other types need. It composes Modal, Form, Field, Select, RadioGroup and Callout, with no styles of its own.

## Use

```tsx
<RelationshipSettings
  isOpen={isOpen}
  onOpenChange={setOpen}
  mode="create"
  objects={liveObjects} // [{ id, singularName, pluralName, icon, hue }]
  from={{ objectId: people.id, title: typedName }} // this table's object; omit to choose it
  isBusy={pending}
  refusals={refusals} // [{ code: 'SLUG_TAKEN', message: '…', attributeId: 'to.title' }]
  onSubmit={(values) => create(values)}
/>
<RelationshipSettings
  isOpen
  onOpenChange={close}
  mode="edit"
  objects={liveObjects}
  from={{ objectId: companies.id, title: 'Investors' }}
  to={{ objectId: people.id, title: 'Investments' }}
  cardinality="many_to_many"
  onSubmit={(values) => rename(values.changed)}
/>
```

- Presentational: the objects, the preset ends, `isBusy` and the last answer's `refusals` come in; `onSubmit(values)` hands out `{ cardinality, from, to, changed }`, `changed` naming the side names the person typed (`from.title`, `to.title`), so an edit sends only those. The screen talks to the data layer, mints the relationship's id once when the dialog opens in `create` mode and sends that same id on every retry, and closes the dialog when the server agrees.
- `from` is the defining side and `to` the other; each is `{ objectId, title? }` when the screen sets it, or absent when the person chooses that side's object (a Select of `objects`, each with its tile). A preset end shows read only.
- `create`: the related object first (it takes focus; the first name does when both ends are set). Until both objects are chosen nothing else shows, since the choices and names would name no object; Create then refuses on the object still to choose and puts focus on it, so its refusal is read. Then how records link as two short questions, one per side, each a horizontal pair of choices ("Each person has": One company or Many companies; "Each company has": One person or Many people), whose answers make the cardinality (`CARDINALITIES` and `sidesHoldingOne` from `@crm/contracts/values`). Four sentences that differed by two words made people compare them word by word (owner ask A99, 22 October 2026). Then a name for each side. A name follows the other object's singular name when its side holds one record, its plural when it holds many, until the person types over it; it keeps what was typed when the objects or the choice change. A sentence under them restates the result ("People get “Company”, showing one company. Companies get “Team”, showing many people."). The first name's hint says once that each name shows as a column and that API names come from the names.
- A relationship from an object to itself labels its second name "Reverse name on <Plural>", asks its questions by side ("This side holds" and "The reverse side holds", each One person or Many people, since "each person has one person" can't say which side is which), starts both names empty (both defaults would be the object's own name) and refuses two names alike (ignoring case) on the second before anything is sent; the server refuses the same (`CONFIG_INVALID` on `to.title`).
- `edit`: both objects read only, and the relationship's own choice alone as a read only Field (four read only radios would look pickable), with one line under it saying why (they can’t change once the relationship exists; #14 adds widening), and Save. `focusSide` puts focus on the name of the side the person opened. API names never show: they come from the names (`toApiSlug`) and never change.
- `readOnlyReason` shows every setting read only, the reason once in a Callout above them, and Close alone (a member who can't change the schema).
- `relationshipStep({ ...props, formId })` answers the same dialog's title, footer and body (`DialogStep`) for a Modal that is already open: AttributeSettings shows it in its own Modal once Relationship is chosen (its `step`), so the scrim stays and focus still returns to what opened the dialog. RelationshipSettings is that step in a Modal of its own (edit mode, the schema map).
- Refusals land on the setting they name by `attributeId` (`from.title`, `to.title`, `from.objectId`, `to.objectId`, `cardinality`); anything else (`LIMIT_REACHED`, `NOT_FOUND`) shows above the settings.
- Related object and the first side's question carry an ⓘ (InfoTip, owner 22 October 2026: "make the … relations … much more easy to understand … with some info icons"): the other object, with a worked example, and what one and many mean. The names keep their hint instead, which already says what they are.

## States

Create with one end chosen, with both ends preset, with neither (only the object pickers until both are chosen; Create refuses on the one missing), each of the four cardinalities, a typed name kept, a self relationship, edit (and of a self relationship, opened from its reverse side), read only, busy (the primary spins with its ongoing verb, Cancel is off, and the dialog stays), refused on either name, and refused above the settings. The hand over from AttributeSettings is AttributeSettings' `RelationshipHandOver` story.

## Keyboard

Focus starts on the first thing still to choose. Tab moves through the settings in order; arrows move between the four choices. ⌘↵ (Ctrl+Enter elsewhere) submits from anywhere in it; Enter submits from a name field; Esc closes it unless the server is answering, and focus returns to what opened it.

## Differences from the artifact

Not in the artifact yet. It takes `isOpen` and `onOpenChange` (as AttributeSettings does) rather than spec 0014's `onCancel`, and `isBusy` rather than `isPending`, matching Form and AttributeSettings.
