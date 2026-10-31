# RecordFacts

A record's few key facts on one quiet line under its name: a person's job title, company, email and phone.

## Why it exists

New (owner, 31 October 2026: the record panel and page showed only a name, with no summary). Neither neighbour fit: `RecordStats` is a boxed strip of counts and times, each a label over its value, and `DescriptionList` pairs a label with plain text down a column. A summary line needs values drawn through their one field design (an email's LinkChip, a company's RecordChip), side by side and wrapping, with the attribute's name heard but not drawn. It sits in `molecules`, shared by `RecordHeader` and `RecordPanel` (each through its `facts`).

## Use

```tsx
<RecordFacts
  label="About Ada Lovelace"
  facts={[
    { id: 'job', label: 'Job title', icon: 'briefcase', content: <AttributeDisplay … /> },
    { id: 'company', label: 'Company', content: <AttributeDisplay … /> },
  ]}
/>
```

- `content` comes from the screen, through `AttributeDisplay`, so a fact looks the same as in a cell.
- `icon` puts the type's icon before the value, muted; leave it out where the value carries its own look (a chip).
- `label` is heard before the value and never drawn.
- No facts draw nothing.

## States

Default, loading (two skeletons, said as "Loading facts"), empty (nothing), narrow (wraps). Disabled, read only and error don't apply: it only shows values, and each value brings its own display.

## Keyboard

Nothing of its own: Tab reaches the links inside the values.

## Differences from the artifact

Not in the artifact.
