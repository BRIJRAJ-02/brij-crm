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
- `hasValue={false}` drops the value segment, for a condition that takes no value ("is empty", "is me") or a group; leaving `operator` out drops the operator segment too, for a group ("2 conditions"). Why a variant: a view's toolbar (spec 0020) shows every applied condition as a chip, and those had nothing to put in the value but the placeholder, which read as a filter still missing its value.
- The group is named "Filter: Company Country is" for screen readers.

## States

Unset value (placeholder), no value part (a bare condition or a group), hover per segment (pointer only), focus per segment.

## Keyboard

Tab moves through the segments; Enter or Space opens each one's editor or removes the filter.

## Differences from the artifact

- Each part takes its own `onPress…` callback, and remove is new.
