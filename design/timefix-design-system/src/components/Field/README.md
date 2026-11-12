Text fields take a typed answer: a label above, a filled box, one help line, and an error that says how to fix it.

**Use it for**: `TextField` for one line (names, emails, links), `TextArea` for notes and messages (grows with its text, optional count). `Form` validates natively on submit; `FieldGroup` titles a block of fields and lays them two to a row (`columns={2}`) when there is room; `FormActions` holds the buttons. **Don't use it for** numbers, phones, codes or search: use NumberField, PhoneField, CodeInput, SearchField, which share this box.

**The consumer provides**: `label` (always), `aside` ("Optional"), `description`, `errorMessage` (a sentence that says what to do), `placeholder` (an example, never the instruction), `size` (`md` 36 in the app, `lg` 44 with 16px text on guest pages), `icon`, `suffix`, `isRequired`, `isInvalid`, `isDisabled`, `type`, `name`. `TextArea` adds `rows`, `maxLength`, `showCount`.

**States**: rest (grey fill, no border), hover (fill deepens), focus (white, 1px accent edge, 2px accent-border ring), invalid (red edge, message fades in), disabled (45%), count near the limit (amber at 90%, red at the limit).

**Interaction**: an invalid submit shakes each invalid box (transitions.dev error state shake: 6px, -6px, 4px overshoot over 280ms) and focuses the first; a server refusal (`isInvalid` turning on) shakes too. Typing a fix clears the message.

**Replaces**: Field, FieldLabel, FieldError, FieldGroup, Form.
