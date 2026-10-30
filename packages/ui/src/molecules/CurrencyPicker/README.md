# CurrencyPicker

Choose a currency, with a search over every one.

## Why it exists

The workspace's default currency (Settings › Workspace › General) is one of about 160 ISO 4217 codes, and a screen outside the library can't list them: the code list lives with the field set, which only `packages/ui` may import. The Currency field's own picker is a Menu in front of an amount, and the attribute settings' default currency is a Select built inline in that module; neither is a control a settings row can use on its own.

It is not a new control. It is Select with `isSearchable`, the way CountryPicker is for countries: the same trigger, popover, search field and keys as every other choice in the CRM. Each option is the currency's name in the reader's language, with its code muted after it, and the search matches the name or the start of the code ("rupee" and "inr" both find the Indian rupee).

## Use

```tsx
<CurrencyPicker label="Currency" value={currency} onChange={setCurrency} />
<CurrencyPicker label="Currency" isClearable placeholder="Automatic" value={currency} onChange={setCurrency} />
```

- `value` and `onChange` carry the ISO code ("INR"), or `null`.
- `isClearable` adds "Clear" while a currency is chosen; General uses it so a workspace can go back to its language's region's currency ("Automatic").
- It does not replace the attribute settings' default currency Select; that stays in AttributeSettings until its owner moves it here.

## States

Empty (the placeholder), chosen, open and searching, no matches, error, read only (with its reason) and disabled, all Select's own.

## Keyboard

Enter, Space or the arrows open it, and the search takes focus. Typing narrows the list; Up and Down move; Enter chooses; Esc closes and puts focus back on the trigger.

## Differences from the artifact

The artifact has no currency picker yet. It needs an artifact publish.
