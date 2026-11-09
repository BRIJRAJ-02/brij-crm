PhoneField takes a phone number with its country: a code chip ("+91") joined to the number, which groups itself as it is typed.

**Use it for**: a person's phone on a record, a guest's number on a booking page or form, SMS reminders. **Don't use it for** picking a country for an address (that is a Select of countries without codes) or for numbers that are not phones.

**The consumer provides**: `label`, `value`/`onChange` (`{ country: 'IN', national: '9876543210' }`, digits only) or `defaultValue`, `countries` (defaults to the common list; each has a dial code and a grouping pattern), `description`, `errorMessage`, `isInvalid`, `isRequired`, `isDisabled`, `size` (`md` 36, `lg` 44 on guest pages), `name`. `phoneToString` gives "+91 98765 43210".

**States**: rest, hover, focus (accent edge on the whole box), list open (chip stays pressed), invalid, disabled.

**Interaction**: the chip opens a list with its search focused; type a name, ISO code or "+44" to narrow it, arrows move, Enter picks, Esc closes. Picking draws the tick and moves focus to the number. The number formats per country as you type; pasting a number that starts with "+" switches the country (keeping the US or Canada when the code is shared). The list opens with transitions.dev menu dropdown (250ms from 0.97 at the chip's corner, 150ms out). No flags: the code is the country's face.

**Replaces**: PhoneField, CountryPicker's dialling list, the Phone editor.
