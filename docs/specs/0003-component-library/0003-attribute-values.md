# 0003 · Attribute values and the field set

## Summary

This page fixes the exact shape of every attribute value, as Zod schemas in `packages/contracts` (the pure entry `@crm/contracts/values`) that the fields, the API and the database all share. It also fixes the one display and one editor each type gets, the filter operators per type, and how values turn into text and back for copy, paste and imports. The shapes follow Attio's attribute types where that serves us, and differ where our scope needs it.

## Rules for every value

- **Empty is `null`** on the wire, including an empty list and an empty string. A checkbox is never empty: unchecked is `false`.
- **Several values**: email, phone, domain, URL, actor reference, file and select can hold a list when the attribute sets `allowMultiple`. A record reference holds a list when its relation's cardinality says so. A list has 1 to 100 unique items (compared in canonical form), kept in the order set.
- **Canonical form**: each schema parses input into one canonical form, so equal values compare equal (filters, duplicates, imports):
  - decimals lose a `+` sign, extra leading zeros and trailing fraction zeros (`"0012.50"` becomes `"12.5"`, and `"-0"` becomes `"0"`);
  - emails and domains are lowercased and trimmed;
  - text is trimmed.
- **Ids** (option, record, object, member, file) are opaque non empty strings here; #5 picks their format.
- **Read only types** (timestamp, interaction) and computed attributes (formula, rollup, lookup) are written by the system only.

## The value shapes

`Decimal` is a string matching `^-?\d{1,15}(\.\d{1,4})?$`: up to 15 digits before the point and 4 after, the same decimal limit as Attio. `Timestamp` is an ISO 8601 UTC instant with milliseconds and a `Z` (`2026-10-01T09:30:00.000Z`). `Hue` and the runtime list `HUES` (the nine hues) move from `packages/ui/src/hue.ts` into contracts, and `hue.ts` exports them from there, so the server and the pickers share one list.

| Type (`AttributeType`) | Schema | One value | Rules |
|---|---|---|---|
| `text` | `TextValue` | string | 1 to 500 characters after trimming; line breaks become spaces |
| `long_text` | `LongTextValue` | string | 1 to 10,000 characters; line breaks kept; plain text |
| `number` | `NumberValue` | `Decimal` | |
| `currency` | `CurrencyValue` | `{ amount: Decimal, currency: string }` | `currency` is one of `CURRENCY_CODES`, a fixed ISO 4217 list in contracts (so Node and every browser agree; `Intl.DisplayNames` gives labels only); the attribute holds a default code |
| `date` | `DateValue` | `"YYYY-MM-DD"` | a real calendar day; no time zone |
| `timestamp` | `TimestampValue` | `Timestamp` | system only |
| `checkbox` | `CheckboxValue` | boolean | never `null` |
| `select` | `SelectValue` | option id | must be one of the attribute's options; an archived option stays valid on existing values but can't be chosen |
| `status` | `StatusValue` | status id | always single |
| `rating` | `RatingValue` | integer 1 to 5 | |
| `email` | `EmailValue` | string | Zod's `z.email()` after trimming, then lowercased; at most 254 characters |
| `phone` | `PhoneValue` | `{ number: string, country: string }` | the schema checks the shape only: `number` is E.164 (`^\+[1-9]\d{6,14}$`) and `country` is ISO 3166 alpha 2. Full validity (the number exists for that country) is checked by libphonenumber-js (`/max`, loaded lazily) in the editor, and by imports if #30 adds it on the server |
| `domain` | `DomainValue` | string | the input must equal `new URL('http://' + input).hostname` (lowercased, IDNs as `xn--`), with at least one dot and no trailing dot; the editor strips a scheme, `www.` is kept, and a path or query is dropped with a hint |
| `url` | `UrlValue` | string | absolute `http` or `https` URL that `new URL()` parses, at most 2,048 characters; canonical form lowercases only the scheme and host |
| `location` | `LocationValue` | `{ line1?, line2?, line3?, line4?, locality?, region?, postcode?, countryCode?, latitude?, longitude? }` | strings, each at most 200 characters; at least one part; `countryCode` is trimmed and upper cased, then must be one of `COUNTRY_CODES` (ISO 3166 alpha 2, below); `latitude` and `longitude` are decimal strings in range, both or neither |
| `personal_name` | `PersonalNameValue` | `{ firstName?, lastName?, fullName }` | each at most 200 characters; `fullName` required, and defaults to first and last joined |
| `actor_reference` | `ActorReferenceValue` | `{ type: 'member' \| 'api_key' \| 'automation' \| 'system', id: string \| null }` | people can only set `member`; `id` is `null` only for `system` |
| `record_reference` | `RecordReferenceValue` | `{ objectId, recordId }` | the target must be an object the relation allows |
| `file` | `FileValue` | `{ fileId, name, size, contentType }` | `name` at most 255 characters, `size` in bytes, `contentType` a MIME type |
| `interaction` | `InteractionValue` | `{ kind: 'email' \| 'meeting', at: Timestamp, by: ActorReferenceValue }` | system only (#43, #44) |

`attributeValueSchema(type, { allowMultiple })` returns the full schema for one attribute: the value, a list of them, or `null`. Parse failures carry the stable code `ATTRIBUTE_VALUE_INVALID` and a message saying how to fix the input.

**Not types of their own**: formula, rollup and lookup attributes (#16) and AI attributes (#55) produce one of the types above. Their attribute is flagged `computed` or `ai`, and their values use that type's schema.

**Helpers** in contracts, pure and shared by client and server: `toCanonicalDecimal`, `emailDomain(email)`, and `fullNameOf(first, last)`. `rootDomain` (for #43's company matching) needs the public suffix list, so it arrives with #43.

## Options, history and display shapes

- `SelectOption` and `StatusOption`: `{ id, label, hue: Hue, archived: boolean }`. `label` is 1 to 100 characters, and order is the order on the attribute.
- `ValueVersion`: `{ value, activeFrom: Timestamp, activeUntil: Timestamp | null, setBy: ActorReferenceValue }`. It versions the whole value of one attribute on one record. The current version has `activeUntil: null`, and an attribute's history is its versions ordered by `activeFrom`. The timeline (#17), version displays and "time in stage" (#52) read it. #5 decides how it's stored.
- `RecordRefDisplay`: `{ objectId, recordId, name, kind: 'person' | 'company' | 'other', imageSrc?, hue? }`.
- `ActorDisplay`: `{ type, id, name, email?, imageSrc?, hue? }`. System shows as "System", and an automation or key under its own name. Only members carry `email` (workspace members already see each other's emails in member settings). It shows only as secondary text in the member picker, to tell two people with the same name apart, never in a chip or a cell.
- Pasting a member: the trimmed, lower cased text matches a member's email first, then a member's exact name (ignoring case). A name two members share is refused: "Two members are called Ada Lovelace. Paste an email instead."
- `COUNTRY_CODES`, in `packages/contracts/src/values/countries.ts`: the 249 officially assigned ISO 3166-1 alpha 2 codes plus `XK` (Kosovo), committed as a list with the date it was taken in a comment, and updated by hand when ISO changes one. A test checks that every code gets a name from `Intl.DisplayNames`. Imports map the common alias `UK` to `GB`; any other code outside the list is refused with a sentence. Nothing is stored yet, so no stored value needs migrating (#5 stores only valid codes).
- `FileDisplay`: `FileValue` plus `thumbnailSrc?` and `href?`, both from #32.

The data layer (#6) builds display shapes; fields never resolve ids themselves. `DisplayFor<T>` maps each type to its display shape (`record_reference` to `RecordRefDisplay`, `actor_reference` and `interaction` to `ActorDisplay`, `file` to `FileDisplay`, others to `undefined`), and a list value gets a list of displays in the same order.

## Object icons and rich text

- `ObjectIcon`: the curated list of about 150 Lucide names an object's tile may use, picked from Lucide 1.49 (people, places, money, work, tools, media, nature). `IconPicker` offers only these, and `packages/ui`'s icon registry imports each one. A test checks the two lists match.
- `RichTextDoc`: the editor's stored document. Its allowed node and mark names are a constant list in contracts, and a test in `packages/ui` checks it equals the Tiptap schema's names. Links inside it must pass the same protocol rule as `safeHref()`. Details are in [0003-rich-text-and-email.md](0003-rich-text-and-email.md).

## The field set

`packages/ui/src/fields/` registers one entry per type:

```ts
interface AttributeTypeDef<V> {
  type: AttributeType;
  Display: ComponentType<DisplayProps<V>>;  // the one display
  Editor: ComponentType<EditorProps<V>>;    // the one editor
  operators: readonly FilterOperator[];
  toText(value: V, ctx: TextContext): string;                 // copy, CSV, the import preview
  fromText(text: string, ctx: TextContext): V | TextRefusal;  // paste, the import preview
  align: 'start' | 'end';
  editIn: 'cell' | 'popover';  // how the grid edits it
  width(attribute: FieldAttribute): 'narrow' | 'default' | 'wide';  // a new grid column's width tier
}
```

A new grid column's width tier, by type (an attribute that allows several values is always `wide`):

| Tier | Token | Types |
|---|---|---|
| `narrow` | `size-column-narrow` | checkbox, rating, number, date, timestamp |
| `default` | `size-column` | text, currency, select, status, email, phone, domain, URL, personal name, actor reference, record reference, interaction |
| `wide` | `size-column-wide` | long text, location, file |

The types the registry uses, exported from `packages/ui`:

```ts
interface FieldAttribute {
  id: string; name: string; type: AttributeType;
  allowMultiple: boolean;
  options?: readonly (SelectOption | StatusOption)[];
  defaultCurrency?: string;            // currency
  defaultCountry?: string;             // phone
  cardinality?: 'one' | 'many';        // record reference
  isRequired: boolean; isUnique: boolean;
  isReadOnly: boolean; readOnlyReason?: string;
  computed?: 'formula' | 'rollup' | 'lookup'; ai?: { canRefresh: boolean };
}
interface DisplayProps<V> { attribute: FieldAttribute; value: V | null; display?: DisplayFor<V>; surface: Surface; maxVisible?: number }
interface EditorProps<V>  { attribute: FieldAttribute; value: V | null; display?: DisplayFor<V>; surface: Surface;
                            onCommit(value: V | null): void; onCancel?(): void; error?: string;
                            onSearch?(query: string): ListSource<DisplayFor<V>>;   // references and members
                            onUpload?(files: File[]): void }                          // files (#32)
interface TextContext { locale: string; timeZone: string; attribute: FieldAttribute; members?: readonly ActorDisplay[]; defaultCountry?: string }
interface TextRefusal { code: 'TEXT_REFUSED'; reason: string }
interface CellChange  { rowId: string; columnId: string; value: AttributeValue | null }
```

- `<AttributeDisplay>` and `<AttributeEditor>` take `attribute`, `value`, `display` (the display shapes) and `surface`. The attribute is a `FieldAttribute`: type, name, `allowMultiple`, options, default currency, relation cardinality, required, read only with its reason, `computed` and `ai`. `surface` is one of `cell`, `panel`, `card`, `form`, `filter` or `preview`.
  - `surface` changes behaviour only. For example, a cell commits on Enter, and a form is always in edit mode.
  - Looks adapt to the slot through container queries.
- These two components are the only way anything renders or edits a value. The grid, record panel, forms, board cards, filter values and import preview all use them.
- Every type also gets the `is empty` and `is not empty` operators.
- **Clearing and required**:
  - An editor commits `null` to clear. Select and status show a "Clear" item when not required, and rating clears when the chosen star is activated again.
  - A required attribute refuses an empty commit with the Field error ("<Name> is required.").
  - Checkbox clears to `false`.
  - Uniqueness is checked only by the server; the field shows the refusal it passes back.
- **Date quick picks**: Today, Tomorrow, Next week (the next first day of the week) and End of month, each resolved in the provider's time zone. They aren't shown in the range picker.

| Type | Display | Editor | Edits in | Filter operators | Text out / in |
|---|---|---|---|---|---|
| Text | plain `body`, one line, full text in a tooltip when cut | Field input | cell | is, is not, contains, does not contain | as is / trimmed |
| Long text | `body`, clipped to one line in cells | Field `multiline` with counter | popover | contains, does not contain | as is / as is |
| Number | tabular figures, end aligned in cells, locale grouping | Field input, parses the locale's format | cell | =, ≠, >, ≥, <, ≤, between | canonical decimal / locale or canonical |
| Currency | `Currency` (code, then amount) | Field with a currency code picker as `prefix` | cell | as number, within one currency | `USD 1234.5` / with or without code (default currency) |
| Date | "Oct 8, 2026" in the locale | Field plus `DatePicker` (typed dates, quick picks) | popover | is, before, after, within | `2026-10-08` / ISO or the locale's format |
| Timestamp | relative ("3 hours ago"), exact in a tooltip | read only | none | before, after, within the last | ISO / refused |
| Checkbox | `Checkbox` (toggles in place) | the same `Checkbox` | cell | is checked, is not checked | `TRUE` or `FALSE` / true, false, yes, no, 1, 0, x |
| Select | `Tag`, or `TagList` when multiple; archived options muted | `Select` up to 15 options, else `Menu` with search; checks when multiple | popover | single: is, is not, is any of; multiple: contains any of, contains all of, contains none of | labels joined by ", " / labels matched case insensitively, unknown refused |
| Status | `StatusDot` | `Select` with dot options | popover | is, is not, is any of | label / label |
| Rating | `Rating`, read only | `Rating` | cell | at least, at most | `4` / 1 to 5 or stars |
| Email, domain, URL | `LinkChip` (`mailto:`, `https://<domain>`, the URL) | Field input, checked on blur | cell | is, contains | value / parsed and canonical |
| Phone | `LinkChip` (`tel:`), formatted international | Field with a country picker, parsed by libphonenumber-js | cell | is, contains, country is | E.164 / parsed with the attribute's or the viewer's country |
| Location | "London, United Kingdom" (country names from `Intl.DisplayNames`) | Field inputs per part, and a searchable country picker (names in the provider's language) | popover | country is, locality is, region is | parts joined by ", " / refused (edit the parts) |
| Personal name | full name, with the avatar when it's the record title | first and last name inputs | popover | contains, first name is, last name is | full name / "Last, First" or split at the first space |
| Actor reference | `RecordChip` with avatar; key, automation and system chips with their icon | `Menu` of members, "Me" first | popover | is, is any of, is me | name / a member's email or exact name |
| Record reference | `RecordChip`, or chips with "+N" when many | `CommandPalette` "Choose record" (async, virtualised) | popover | is, is any of, and through the relation (Company › Country) | names / refused (choose records) |
| File | `FileItem` chips with type icons, "+N" | `FileDrop` plus the `FileItem` list; uploads through `onUpload` (#32) | popover | is empty, is not empty, name contains | names / refused |
| Interaction | mail or calendar icon, relative time and who | read only | none | before, after, within the last, kind is | ISO and kind / refused |
| Computed | its result type's display, with a function icon in the header | read only | none | as its result type | as its result type / refused |
| AI | its result type's display, with the `ai` sparkle in the header and a "where it came from" popover | its result type's editor (a hand edit replaces the AI value), plus Refresh | as its type | as its result type | as its result type |

Copied ranges are tab separated, quoted like Excel when a cell holds a tab, line break or quote. Refusals carry a short reason ("No option called 'Hot'"), which the grid and import preview show.

## Filter conditions

`FilterCondition` (contracts) is what the filter surface emits and `FilterBuilder` holds. It's a union keyed on `operator`, so each operator carries its own operand:

| Operators | Operand |
|---|---|
| is, is not, contains, does not contain, =, ≠, >, ≥, <, ≤, before, after, at least, at most, first name is, last name is, country is, locality is, region is, name contains | one value of the attribute's type (or a string for the text matches) |
| between | `{ from, to }`, both values of the type, inclusive |
| is any of, contains any of, contains all of, contains none of | a list of values (option ids, record references, members), 1 to 100 |
| within, within the last | `{ amount: 1 to 999, unit: 'day' \| 'week' \| 'month' \| 'year' }`, or a named range (`today`, `this_week`, `this_month`, `last_month`) |
| is me | none |
| is empty, is not empty, is checked, is not checked, has files | none |
| and through the relation | `{ path: string[], condition: FilterCondition }` (Company › Country) |

Groups are `{ conjunction: 'and' \| 'or', conditions: (FilterCondition \| group)[] }`, nested at most 3 deep. Relative dates resolve against "today" in the provider's time zone. How a condition runs against a million records, and how it's saved with a view, is #20's.

## Differences from Attio, on purpose

- **Currency** sits on each value, not fixed per attribute, because #52 converts mixed currencies for totals. The attribute keeps a default currency, as Attio does.
- **Rating** is 1 to 5, with `null` for no rating, so zero and empty can't be confused.
- **Numbers** are exact decimal strings rather than floats, with Attio's 4 decimal limit.
- **Text** is capped at 500 and 10,000 characters to protect the scale budget. Attio allows 10 MB.
- **Derived email and domain parts** are computed by helpers when needed, not carried in the value.
- **History** versions the whole value of an attribute, where Attio versions each item of a list. That's enough for "changed from A to B" and time in stage, and simpler.

## Changes for the artifact's Field card

The first publish ([0003-artifact-publishing.md](0003-artifact-publishing.md)) updates the Field card's table:
- add Personal name, Actor reference (shown as "Member"), Interaction and File;
- fold Multi select into Select with "allow multiple";
- add the operators and the AI hand edit rule above.
