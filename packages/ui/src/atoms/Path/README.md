# Path

An attribute path through relations: Company › Country.

## Why it exists

Ported from the artifact's Path card. Filter chips, the filter and sort builders, formulas and variables name attributes across relations the same way. (Breadcrumbs are for navigation; Path is for attributes.)

## Use

```tsx
<Path parts={['Company', 'Country']} />
```

- Screen readers hear "Company, then Country".

## States

None.

## Keyboard

It takes no focus.

## Differences from the artifact

- `parts` is always a list; one attribute is a list of one.
