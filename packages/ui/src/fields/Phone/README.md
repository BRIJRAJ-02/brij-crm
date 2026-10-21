# Phone

A phone number, or several, with its country.

## Why it exists

The field set gives every attribute type exactly one display and one editor (spec 0003, house rule 3). This folder is the phone type's: the grid cell, the record panel, a form, a board card, a filter value and the import preview all draw it through `AttributeDisplay` and edit it through `AttributeEditor`, never directly.

## Use

Screens never import it; they render values through `AttributeDisplay` and `AttributeEditor` with a `FieldAttribute` of this type.

- **Display**: a LinkChip to `tel:`, written the international way (+44 20 7123 4567); several are a row with "+N". On a card (a board card, a line of the timeline) the chip is flat, the link's text alone: a blue chip there read heavier than the words around it (the owner, 21 October 2026).
- **Editor**: the hosted form's PhoneField (F38, the owner's call, 20 October 2026): the country code with its flag and a search by name, ISO code or dial code, joined to the number. It starts in the attribute's `defaultCountry`, else the viewer's (their language's region), else the US; a stored number opens in its own country, written the national way ("020 7123 4567"). The placeholder is the country's example number; a quiet check shows while the number is valid there, and too short, too long or not a number there is said once focus leaves the field or Enter is pressed. A number typed or pasted with its "+" code switches the country. libphonenumber-js (the full metadata and the examples) loads on demand when a phone field shows, so it is never in the first load, and parses and stores the number in E.164 as before. Several numbers are removable chips with the same PhoneField to add one (ListEditor's `renderAdd`).
- **Text out / in**: E.164 / parsed with the attribute's or the viewer's country. Paste and imports load the library first and pass it as `TextContext.phone` (`createPhoneParser`).
- **Filter operators**: is, contains, country is, then is empty and is not empty.

## States

Empty, a value, loading (the number shows as stored until the library loads), and in the editor: the example placeholder, typing, valid (the check), too short, too long, not a number, required.

## Keyboard

Tab reaches the country code, then the number. Enter commits, leaving the whole field commits (moving between the code and the number never does, nor does opening the code's list), Esc cancels. With the code's list open, Esc closes the list first and focus goes back to the code; choosing a country puts focus back in the number with what was typed kept. In a grid cell's popover the list opens over the popover and both stay open. In a grid cell one value is typed in the cell itself, keyboard first: typing "+" and the code switches the country, and the code button is a click away; Enter and Tab commit and move on, and keys inside the code's list stay the list's. Several edit in a popover under the cell, the list over the same phone field to add one more.

## Differences from the artifact

The artifact's Field card table names this pairing; the code follows it exactly. The schema in contracts checks the shape only; full validity is this editor's (and #30's on import).
