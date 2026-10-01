# Variable

A merge variable standing for an attribute in an email or a sequence step.

## Why it exists

Ported from the artifact's Variable card. The email composer, sequences and the formula editor show variables the same way, and flag the ones the record can't fill.

## Use

```tsx
<Variable path={['First name']} />
<Variable path={['Company', 'Name']} isMissing />
```

- `isMissing` turns it orange and tells screen readers the record has no value, so the email would send a gap.

## States

Missing.

## Keyboard

It takes no focus itself; the editor moves past it as one character (#45).

## Differences from the artifact

- `path` is a list (through relations) and `isMissing` replaces `missing`.
