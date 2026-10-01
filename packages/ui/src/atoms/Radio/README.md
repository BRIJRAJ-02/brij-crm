# Radio and RadioGroup

One of a few choices, all shown at once.

## Why it exists

Ported from the artifact's Radio card (version 8). Roles, plans, export formats and two factor methods (#23, #25, #37, #42) pick one of a few this way. It wraps React Aria's `RadioGroup` and `Radio`, so arrow keys move between choices. For more than about five choices, or a choice in a cell, use Select.

## Use

```tsx
<RadioGroup label="Export format" defaultValue="csv">
  <Radio value="csv" description="Opens in any spreadsheet.">
    CSV
  </Radio>
  <Radio value="xlsx">Excel</Radio>
</RadioGroup>
```

- `label` is the question; `isLabelHidden` keeps it for screen readers only.
- `orientation="horizontal"` puts a few short choices in a row.
- `error` marks the group invalid and says how to fix it.

## States

Unchosen, chosen (the dot grows in), hover (pointer only), focus, pressed, invalid, read only, disabled (a whole group or one choice).

## Keyboard

Tab enters the group at the chosen choice; arrow keys move and choose; Tab leaves.

## Differences from the artifact

- Choices are `Radio` children rather than an `options` array, so each can carry its own description and disabled state.
- `orientation` replaces `inline`; React Aria's props replace the input attributes.
