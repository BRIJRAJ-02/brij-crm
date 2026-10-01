# FieldSurfaces

One value drawn on each surface the field set serves (cell, panel, card, filter, preview), labelled.

## Why it exists

Workbench only: each field type's stories and artifact preview show its one display on every surface side by side, so a reviewer sees it is the same everywhere (AC-4). It is not exported from `@crm/ui`; screens draw values with `AttributeDisplay` inside real modules.

## Use

```tsx
<FieldSurfaces attribute={attribute} value={value} display={display} maxVisible={3} />
```

## States

Whatever the value's display shows.

## Keyboard

Only what the displays hold takes focus.

## Differences from the artifact

Not in the artifact.
