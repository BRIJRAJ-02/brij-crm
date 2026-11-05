# EmptyState

What a list, a panel or a view shows when it has nothing to show.

## Why it exists

Ported from the artifact's EmptyState card, then made quiet (5 November 2026). Every component's empty, error and locked states are built from it, with Skeleton for loading (house rule: reach for these two before inventing a state). A view the viewer may not see (`status: 'no-access'`) shows the locked tone for the whole view only; a hidden field or record is simply absent (#24).

## Use

```tsx
// In a list, a table, a card, a tab, a panel or a dialog: the default row.
<EmptyState title="No matches" actions={<Button variant="ghost" size="sm">Clear filters</Button>} />
// A whole surface's true first run.
<EmptyState layout="block" title="No deals yet" actions={<Button variant="primary" icon="plus">Add deal</Button>} />
<EmptyState tone="error" title="Couldn't load deals" onRetry={retry} />
<EmptyState tone="locked" title="You can't see this list">Ask a workspace admin for access.</EmptyState>
```

- **`row` is the default** (5 November 2026): one quiet line at a list row's height, at the start, in the list's place. The title in `text-secondary` and the action straight after it, with no mark and no tile (Linear's "No issues", Attio's "No records match"). Anything with content around it takes a row. Why: 117 centred blocks (a 32px icon tile, a bold line, a sentence and a button) on every list made every screen look the same, and generated (the owner). With `children`, the text drops under the title in `text-tertiary` label type and the actions under that, all at the start; the text runs the slot's width with no measure.
- **`layout="block"`** is centred in its slot, only for a whole surface's **true first run** (a new object with no records, no booking pages yet) or a whole route's state (not found, deleted, gated). No tile: an `illustration` if given (SpotIllustration, a whole page's first run), otherwise a bare `icon` in `text-tertiary` if given, otherwise only the words.
- `layout="fill"` is the block grown to its slot's height, centred in it. Why a variant: Bookings › List with nothing in it floated a small block at the top of a tall empty area (the owner, 22 October 2026); a view that is empty and owns the whole area says so in its middle.
- **`tone="error"` looks different from emptiness** in every layout: its `circle-alert` mark and its title in `danger` (4.5:1 in both themes), announced as an alert, and **always Try again**. `onRetry` is what it calls; with none it loads the page again, the last resort, so a failure never ends in a dead end. Every screen that can load again passes its own. In a row, Try again sits after the words (under them when there is text); in a block, under them.
- `tone="locked"` shows its bare lock in `text-tertiary`. A view the viewer may not see (`status: 'no-access'`) shows it for the whole view only; a hidden field or record is simply absent (#24).
- `title` is one line; `children` are left out when the title and the actions already say it ("No people yet" with New person needs no "People you add show here."). A body earns its place only by naming a step the button does not, or by saying why there is no button.
- `empty` and `locked` are announced politely (`role="status"`), `error` as an alert.
- `icon` is a block's bare glyph. A row never draws it, and an error or a lock always draws its own mark.
- `illustration` swaps the glyph for a picture, centred over the title, at most `size-column` wide, hidden from screen readers (the title says what is missing). Why a variant: Links, Forms and Link page open on their own first empty moment (spec 0058). Block and fill only.
- `isLoading` holds the place while what goes here is still on its way: skeleton lines where the title and text go, marked busy, with `title` ("Loading") read by screen readers. It waits out the loading delay itself (`useDelayedLoading`), so a fast load never flashes them. A row draws one line at its start, so a card that loads to a quiet row keeps its height; a block or fill draws two centred lines.

## States

It is the empty, error and locked state, and loading (`isLoading`) in the same place.

## Keyboard

Only its buttons take focus.

## Differences from the artifact

- `row` is the default and the artifact's centred tile is gone: a block draws a bare glyph or an illustration.
- An error always has Try again (`onRetry`, else a reload), with its mark and title in the danger colour; the tone sets the announcement.
- `isLoading` is new.
