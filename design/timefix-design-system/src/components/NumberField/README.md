NumberField takes a number you type or step: counts, money and percentages, with the value popping in as it changes.

**Use it for**: a quantity (seats, guests, minutes), a price or deal value (`mode="currency"`), a rate (`mode="percent"`, 0 to 100). **Don't use it for** a choice along a range where the exact number matters less than the feel (use Slider), or for IDs and phone numbers, which are text.

**The consumer provides**: `label`, `value`/`onChange` or `defaultValue`, `minValue`, `maxValue`, `step`, `mode` (`number`, `currency`, `percent`), `currency` (ISO code; the narrow symbol sits in front in grey), `unit` ("min", "seats"), `formatOptions` to override, `showSteppers`, `size` (`md` 36, `lg` 44), `description`, `errorMessage`, `isInvalid`, `isDisabled`.

**States**: rest, hover, focus (accent edge and ring), invalid (red edge, message), disabled; a stepper turns off at its limit.

**Interaction**: up and down arrows step by `step`, Page Up/Down by more, Home/End go to the limits, and the minus/plus buttons step on press. Typing is free; the value formats when you leave the field or press Enter. Each committed value plays transitions.dev number pop-in: only the digits that changed rise 8px out of over 500ms on the bounce curve, the last two 80ms apart. Digits are tabular, so the width never jumps.

**Replaces**: the Number and Currency editors, the Currency atom's formatting and NumberPop.
