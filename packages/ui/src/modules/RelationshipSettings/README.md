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
- `create`: the related object first (it takes focus; the first name does when both ends are set), then how records link as four choices phrased with both objects ("Each person has one company, each company has many people", `CARDINALITIES` and `sidesHoldingOne` from `@crm/contracts/values`), then a name for each side. A name follows the other object's singular name when its side holds one record, its plural when it holds many, until the person types over it; it keeps what was typed when the objects or the choice change. A sentence under them restates the result ("People get “Company”, holding one company. Companies get “Team”, holding many people.").
- A relationship from an object to itself labels its second name "Reverse name on <Plural>" and refuses two names alike (ignoring case) on that name before anything is sent; the server refuses the same (`CONFIG_INVALID` on `to.title`).
- `edit`: both objects and the cardinality read only, each saying why (they can't change once the relationship exists; #14 adds widening), and Save. API names never show: they come from the names (`toApiSlug`) and never change.
- `readOnlyReason` shows every setting read only, the reason once in a Callout above them, and Close alone (a member who can't change the schema).
- Refusals land on the setting they name by `attributeId` (`from.title`, `to.title`, `from.objectId`, `to.objectId`, `cardinality`); anything else (`LIMIT_REACHED`, `NOT_FOUND`) shows above the settings.

## States

Create with one end chosen, with both ends preset, with neither (each object chosen; Create waits for both), each of the four cardinalities, a self relationship, edit, read only, busy (the primary spins with its ongoing verb, Cancel is off, and the dialog stays), refused on a name, and refused above the settings.

## Keyboard

Focus starts on the first thing still to choose. Tab moves through the settings in order; arrows move between the four choices. ⌘↵ (Ctrl+Enter elsewhere) submits from anywhere in it; Enter submits from a name field; Esc closes it unless the server is answering, and focus returns to what opened it.

## Differences from the artifact

Not in the artifact yet. It takes `isOpen` and `onOpenChange` (as AttributeSettings does) rather than spec 0014's `onCancel`, and `isBusy` rather than `isPending`, matching Form and AttributeSettings. In edit mode the cardinality shows as a read only Select with its reason, not a RadioGroup, since RadioGroup has no read only reason.
