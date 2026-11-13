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
- `error` marks the group invalid and says how to fix it. Drawn by the shared FieldError atom: the alert mark, then the words (5 November 2026). `errorId` names its line, so a control it turns off (a dialog's submit) can point `aria-describedby` at the reason.
- `labelAside` puts a quiet word after the label, such as "(optional)" on a public form: `text-tertiary`, on the same line, and part of the group's accessible name.

- `variant="cards"` draws each choice as a bordered card in a grid two wide (one on a phone), the chosen one on the accent's soft fill, with `icon` before its label: a handful of choices that each start a different job, where picking one is the first step of the form under it (the link page's Add item, 25 October 2026). Why a variant and not a new component: it is the same group, the same keyboard and the same `description`, only drawn as cards; TileGrid lays out Cards, which are not form controls, and ChoiceChips is multiple choice.
- `variant="letters"` is a public form's choice (T42, Typeform's way): the cards' box one to a row, full width, each choice's letter (A, B, C) in a small key where the circle was, in the link colour, filling with the accent once chosen. While focus is in the group a letter key picks its choice and focus follows it, so a visitor answers with one key. The letters are a CSS counter, so they are never part of a choice's name. A Radio's `letter` names its own key instead (a yes or no's Y and N, Typeform's way): it shows in the key and is the letter that picks it. The label itself fills the box (its padding, not the box's), so a press anywhere on the box lands on the label with nothing laid over it. Why a variant: it is the same group, keyboard and box as `cards`; only the mark before the label and the width change, and a second choice control would have repeated the radio's states.
- In `variant="cards"` the whole card picks the choice, not only the circle and the label: the control reaches the card's edges through a stretched pseudo-element, so the description and the padding around it are inside the hit area, and the hover fill covers the card. The control is still the RadioButton, so the accessible name, the keyboard and the focus ring are exactly as they are in `plain`. A press on the line under the title did nothing before (the owner, 26 October 2026); the Cards story asks the browser what is under that point rather than dispatching a click, which would not exercise it.
- `preview` on a Radio draws what the choice holds under its label, in a card (`variant="cards"`), in the body's type: a merge's two sides, each a record's name over its value drawn through the field display on the `preview` surface (spec 0049, 31 October 2026). It is read as the choice's description, so it takes `description`'s place. Why a variant: the choice is still one of two, with the same keyboard and the same whole card hit area; only what sits under the label is a value rather than a line of words, which `description`'s string can't hold.
- `icon` on a Radio draws a glyph before its label. It is only read with `variant="cards"`, where the card has room for it.
- `RadioRowsGroup` (its own file and stylesheet, so the hosted form never loads it) draws each choice as a full width row, after checklabs' option rows (the guest menu's dish sheet: a dish's sizes and its choose one options): 10px apart, a hairline round each at 16px corners, a 20px circle with a 1.75px edge, the label at 15px, and its `description` at the row's end in the quiet colour (a size's price, an option's +£0.50), still read as the choice's description. The chosen row takes the accent's line and soft fill, the whole row picks it (as a card does), the row's fill says hover, focus rings the row, and a row that is off drops its chosen fill and line while its circle and label fade (its price stays readable). A press eases the row down to `--scale-press-sm` on `--ease-press` (1 in the app, where nothing shrinks; the guest menu sets checklabs' 0.985 and its overshoot). Why a variant: the same group and keyboard, with what each choice costs beside it rather than under it; cards are a grid of jobs, not a list of priced choices (the owner wants checklabs' menu exactly, 5 November 2026).

## States

Unchosen, chosen (the dot grows in), hover (pointer only), focus, pressed, invalid, read only, disabled (a whole group or one choice).

## Keyboard

Tab enters the group at the chosen choice; arrow keys move and choose; Tab leaves.

## Differences from the artifact

- Choices are `Radio` children rather than an `options` array, so each can carry its own description and disabled state.
- `orientation` replaces `inline`; React Aria's props replace the input attributes.

## RadioMark

`RadioMark` is the same circle and dot with no control, for a row that is the control and says its own state: an option in a `Select` with `showsMarks`. It says nothing to a screen reader. It stays inside the library, as `CheckboxMark` does.

## Timefix prototype (spec 0072)

Folded into the prototype's Checkbox (spec 0072): 18px circles with a 1.5px `control-border` edge; the chosen one fills with the accent and an 8px dot scales in over `--duration-quick`. A horizontal group sits 24px apart.


**Differences from the prototype**: the card, letter and row variants (public forms, the guest menu) are the library's own and keep their look, with the outline focus ring.

**Repeats from its replacer** (spec 0072, AC-4): the 18px control, its 1.5px edge and the checked fill, as Checkbox's box draws them; they leave with this export.
