An empty state replaces a list, table or panel that has nothing in it yet, and says how to fill it.

**Use it for**: a first-run list ("No bookings yet"), an empty panel, and, through `NoResults`, a search or filter that matched nothing. **Don't** use illustrations, jokes or two primary actions; don't show an empty state while data is loading (use skeletons that keep the final layout).

**The consumer provides**: `icon` (Lucide, 20px), `title` that names what will appear here, one-sentence `description` on how it fills, and one `action` (a primary Button, or a secondary one when the page already has a primary). `size` is `md` for a page or table (48px padding) and `sm` for a panel or card. `NoResults` takes `query`, `noun` and `onClearFilters`.

**States**: first run, no results (search-x icon, "No companies match “Umbrella”", Clear filters), small.

**Interaction**: the icon sits in a 44px raised white well. When the state appears, its lines reveal with transitions.dev texts reveal: well, title, sentence and action each rise 12px out of over 500ms, 40ms apart, so the eye lands on the title first. Reduced motion shows them at once. The action is the only focusable element.

**Replaces**: EmptyState, SpotIllustration, AvatarEmpty.
