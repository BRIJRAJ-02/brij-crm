# TruncatedText

One line of text, cut with an ellipsis, with the full text in a tooltip only when it is cut.

## Why it exists

New. Names, titles and text values in cells, chips and headers must stay on one line; one atom measures whether the text was cut, so the tooltip appears only when it hides something.

## Use

```tsx
<TruncatedText>{record.name}</TruncatedText>
```

- `isNumeric` uses tabular figures, so numbers line up in a column.
- It measures with a `ResizeObserver`, so it notices when the column or panel is resized.
- Screen readers always get the full text: it is all in the page, only cut on screen.

## States

Fits, cut (with the tooltip).

## Keyboard

It adds no tab stop. A grid cell that focuses it shows the tooltip.

## Differences from the artifact

Not in the artifact.
