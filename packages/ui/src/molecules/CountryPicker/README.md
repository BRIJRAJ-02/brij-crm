# CountryPicker

Choose a country, with a search over every one.

## Why it exists

A country question on a hosted form, and the code in front of a phone number (PhoneField), both pick one of about 240 countries. A plain list of 240 is a scroll from Afghanistan to Zimbabwe; this opens with a search that has focus at once and narrows by name, ISO code or dial code, so "ind", "IN" and "+91" all find India.

It is not a new control. It is Select with `isSearchable`, so the trigger, the popover, the search Field, the list and the keys are the ones every other choice in the CRM uses. Two small Select variants made that possible, and they are Select's, not this module's:

- `filter(item, query)`: a search can match more than the label (here the ISO code and the dial code).
- `variant="prefix"` with `SelectItem.short`: the compact trigger joined to the start of a Field's box, showing the flag and "+91".

A ComboBox was the other candidate. It types into the trigger itself, which suits a value the person may make up; a country is always one of a fixed list, so a button that opens a search reads more plainly and keeps the chosen country on show while searching.

## Use

```tsx
<CountryPicker label="Country" guess="IN" value={country} onChange={setCountry} />
<CountryPicker label="Country code" variant="prefix" value={code} onChange={setCode} />
```

- `value` and `onChange` carry the ISO code ("IN"), or `null`.
- `guess` is the visitor's own country (the hosted form guesses it from the browser's language); it is pinned first while the search is empty.
- Each option is the flag (an emoji from the two letters), the name in the provider's language, and the dial code, muted.
- `variant="prefix"` is for PhoneField; use PhoneField rather than building a phone field with it.

## States

Empty (the placeholder), chosen, open and searching, no matches ("No matches"), error, read only (with its reason) and disabled, all Select's own.

## Keyboard

Enter, Space or the arrows open it, and the search takes focus. Typing narrows the list; Up and Down move; Enter chooses; Esc closes and puts focus back on the trigger. Screen readers hear a button that opens a listbox, with a combobox search over it.

## Differences from the artifact

The artifact has no country picker yet. It needs an artifact publish.
