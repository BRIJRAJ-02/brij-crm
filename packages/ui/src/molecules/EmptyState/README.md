# EmptyState

What a list, a panel or a view shows when it has nothing to show.

## Why it exists

Ported from the artifact's EmptyState card. Every component's empty, error and locked states are built from it, with Skeleton for loading (house rule: reach for these two before inventing a state). A view the viewer may not see (`status: 'no-access'`) shows the locked tone for the whole view only; a hidden field or record is simply absent (#24).

## Use

```tsx
<EmptyState title="No deals yet" actions={<Button variant="primary" icon="plus">Add deal</Button>}>
  Deals you add or import show here.
</EmptyState>
<EmptyState tone="error" title="Couldn't load deals" onRetry={retry}>Check your connection, then try again.</EmptyState>
<EmptyState tone="locked" title="You can't see this list">Ask a workspace admin for access.</EmptyState>
```

- `title` is one line; `children` say what to do next, or why.
- `error` shows "Try again" when given `onRetry`, and is announced as an alert. `empty` and `locked` are announced politely.
- `icon` overrides the tone's icon (inbox, triangle alert, lock).
- `isLoading` holds the place while what goes here is still on its way: the tile, then two skeleton lines where the title and text go, marked busy, with `title` ("Loading") read by screen readers. Why a variant: a page body that loads, then shows an EmptyState (nothing yet, failed, not found), jumped from a flush skeleton to a padded, centred state; drawn in the EmptyState's own place, it lands where the skeleton was. Show it after the loading delay (`useDelayedLoading`, or a router's pending delay), as with Skeleton.

## States

It is the empty, error and locked state, and loading (`isLoading`) in the same place.

## Keyboard

Only its buttons take focus.

## Differences from the artifact

- `onRetry` adds the retry button for errors; the tone sets the announcement.
- `isLoading` is new.
