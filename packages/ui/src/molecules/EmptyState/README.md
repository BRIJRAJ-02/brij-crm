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
- `layout="fill"` is the block grown to its slot's height, centred in it. Why a variant: Bookings › List with nothing in it floated a small block at the top of a tall empty area (the owner, 22 October 2026); a view that is empty and owns the whole area says so in its middle.
- `layout="row"` is one quiet line at a list row's height, at the start: the bare icon, the title in `text-secondary`, and the text after it. Why a variant: a record's Tasks tab with nothing open drew a centred block that pushed Completed to the foot of the page (the owner's call, 20 October 2026); a list that sits above more content says it has nothing in a row of its own size. With text, the text drops under the title in `text-tertiary` label type, both beside the icon, so a longer line never wraps into a block next to the title (Home's cards, 22 October 2026). The text runs the slot's width with no measure, and Try again starts under the words rather than centred (QA, 22 October 2026).
- `illustration` swaps the icon tile for a picture, centred over the title, at most `size-column` wide, hidden from screen readers (the title says what is missing). Why a variant: Links, Forms and Link page open on their own first empty moment (spec 0058), where a 32px tile reads as a gap; a drawing or a mini preview shows what will be here. Still one title, one line and one primary action in `actions`, all on one centre line. Not for `row`.
- `isLoading` holds the place while what goes here is still on its way: the tile, then two skeleton lines where the title and text go, marked busy, with `title` ("Loading") read by screen readers. Why a variant: a page body that loads, then shows an EmptyState (nothing yet, failed, not found), jumped from a flush skeleton to a padded, centred state; drawn in the EmptyState's own place, it lands where the skeleton was. It waits out the loading delay itself (`useDelayedLoading`, as TopBar does): the region is busy and holds its place from the start, and the tile and lines come only after the delay, so a fast load never flashes them. Pass `isLoading` for as long as it loads. The lines are centred (Skeleton's `align="center"`), like the title and text they stand in for. With `layout="row"` it holds the row's place instead and draws one line at its start, so a card that loads to a quiet row (Availability's Days off) keeps its height.

## States

It is the empty, error and locked state, and loading (`isLoading`) in the same place.

## Keyboard

Only its buttons take focus.

## Differences from the artifact

- `onRetry` adds the retry button for errors; the tone sets the announcement.
- `isLoading` is new.
