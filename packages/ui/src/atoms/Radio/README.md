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
- `info` puts an InfoTip beside the question, when the choices need a word of help (a view's Who can see it). Why a variant: the help belongs to the group's own question, as Field's and Select's `info` does. Focus reaches the tip before the choices, and an arrow key on the tip or in its help picks nothing.
- `orientation="horizontal"` puts a few short choices in a row.
- `error` marks the group invalid and says how to fix it. `errorId` names its line, so a control it turns off (a dialog's submit) can point `aria-describedby` at the reason.
- `labelAside` puts a quiet word after the label, such as "(optional)" on a public form: `text-tertiary`, on the same line, and part of the group's accessible name.

- `variant="cards"` draws each choice as a bordered card in a grid two wide (one on a phone), the chosen one on the accent's soft fill, with `icon` before its label: a handful of choices that each start a different job, where picking one is the first step of the form under it (the link page's Add item, 25 October 2026). Why a variant and not a new component: it is the same group, the same keyboard and the same `description`, only drawn as cards; TileGrid lays out Cards, which are not form controls, and ChoiceChips is multiple choice.
- `icon` on a Radio draws a glyph before its label. It is only read with `variant="cards"`, where the card has room for it.

## States

Unchosen, chosen (the dot grows in), hover (pointer only), focus, pressed, invalid, read only, disabled (a whole group or one choice).

## Keyboard

Tab enters the group at the chosen choice; arrow keys move and choose; Tab leaves.

## Differences from the artifact

- Choices are `Radio` children rather than an `options` array, so each can carry its own description and disabled state.
- `orientation` replaces `inline`; React Aria's props replace the input attributes.
