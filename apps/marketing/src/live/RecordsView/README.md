# RecordsView

The live demo's People and Companies: the library's Table, with RecordChips, TagLists and Badges in its cells, as the app draws them.

## Why it exists

The home page's live demo, built from the real components (the owner, 23 October 2026). A person a booking on the demo's booking page creates shows at the top with a "New" badge, which is the product's promise ("every booking lands in your CRM") happening in front of the visitor.

## Use

```tsx
<RecordsView object="people" people={people} highlightId={newPersonId} />
<RecordsView object="companies" people={people} />
```

## States

The Table's own: rows and cells by keyboard, a sticky header, scrolling inside the view.
