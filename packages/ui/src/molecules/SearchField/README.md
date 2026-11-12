# SearchField

A rounded search field that narrows a list as you type, or opens search from a shortcut: the prototype's SearchField (spec 0073, AC-7304).

## Why it exists

A thin wrapper, not a new design. Field's `search` variant already draws the rounded box and its icon, and it stays the one look; SearchField adds the behaviour every caller rebuilt by hand or went without: a clear button, Esc to clear, an optional shortcut with its keycap, and a debounced `onSearch`. It is a wrapper rather than new Field props so the field set's own file stays as phase 1 restyles it, and it carries no CSS of its own (Button and Kbd fill Field's suffix).

## Use

```tsx
<SearchField label="Search people" onSearch={setQuery} />
<SearchField label="Search" size="sm" shortcut="/" value={text} onChange={setText} onSearch={filter} />
```

- `onSearch` gets the query 150 ms (`SEARCH_DEBOUNCE_MS`, spec 0014's pause) after typing stops, at once on Enter and on clear, and never the same query twice in a row. Filter or search on it, never on `onChange`, so a long list does its work once per pause (spec 0073, AC-7322). A record search through `@crm/data` debounces again on its own; that is harmless.
- `onChange` is every key, for showing what is typed (a controlled field).
- `shortcut`: `⌘K` (Ctrl+K answers it too, and the keycap reads Ctrl+K off a Mac) or a single key such as `/`, which never fires while another field has focus. Leave `⌘K` to the command palette where one is mounted.
- `onSubmit` is Enter, after `onSearch` has had the query.
- The folding search in a view's toolbar stays `ToolbarSearch`.

## States

Empty (placeholder, and the keycap when there is a shortcut), focused (the keycap hides), with text (the clear button), disabled (no clear button, no keycap). Hover and focus are Field's.

## Keyboard

Typing searches. Esc clears and keeps focus; with nothing typed, Esc is left to whatever holds the field (a popover closes). Enter searches at once. The shortcut focuses and selects the field. Tab reaches the clear button after the field.

## Differences from the artifact

The prototype's clear plays a dissolve (the text falls away with a glow under each word). It needs markup inside Field's box, which phase 1 is restyling, so it is left for phase 3 (spec 0073). The prototype's `md` and `sm` heights are Field's.
