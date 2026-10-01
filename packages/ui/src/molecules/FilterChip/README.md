# FilterChip

One applied filter as a chip in the view bar.

## Why it exists

Ported from the artifact's FilterChip (part of the FilterBuilder card). The view bar (#20) shows each applied filter as a chip whose parts can each be changed: the attribute, the operator, the value. FilterBuilder holds the editors; the chip only shows and opens them.

## Use

```tsx
<FilterChip
  icon="map-pin" attribute={['Company', 'Country']} operator="is"
  value={<AttributeDisplay … surface="filter" />}
  onPressValue={openValue} onRemove={remove}
/>
```

- `attribute` is a path through relations; `operator` is the operator's words; `value` is drawn through the field set (`surface="filter"`).
- Each segment is a button: the attribute, the operator, the value and remove. Until the value is set, `placeholder` ("Choose a value") shows.
- The group is named "Filter: Company Country is" for screen readers.

## States

Unset value (placeholder), hover per segment (pointer only), focus per segment.

## Keyboard

Tab moves through the segments; Enter or Space opens each one's editor or removes the filter.

## Differences from the artifact

- Each part takes its own `onPress…` callback, and remove is new.
