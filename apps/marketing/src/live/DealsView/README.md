# DealsView

The live demo's Deals: the library's Board by stage, each card showing its value, with real drag and drop.

## Why it exists

The home page's live demo, built from the real components (the owner, 23 October 2026). Dragging a deal to another stage moves it, by pointer or keyboard, exactly as in the app; the demo keeps the stages in its own state and says so in a toast.

## Use

```tsx
<DealsView deals={deals} onMove={(dealId, stageId) => move(dealId, stageId)} />
```

## States

The Board's own: lifting, moving and dropping a card, by pointer or keyboard, with its announcements.
