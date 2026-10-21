# Card

A framed group with a header: a settings section, a dashboard tile, a template.

## Why it exists

New. Settings pages (#39, #42), dashboard tiles (#52) and the template and onboarding lists (#40) group content in frames. One Card keeps the frame, header and footer the same everywhere.

## Use

```tsx
<Card
  title="API keys"
  description="Keys act as the workspace. Keep them secret."
  actions={<Button icon="plus">New key</Button>}
>
  …
</Card>
```

- `actions` sit at the end of the header, standing on the title's line: their box is one title line tall and centres what it holds, so a button taller than the line ("View all") sits level with the title, not below it (the owner, 21 October 2026), and the header keeps the title's height. `footer` holds a form's Save.
- `tone="sunken"` for a quieter group inside a page.
- `placement="page"` is the one frame for a page outside the app shell: the status page and the not found page now, and `AuthLayout` (sign in, sign up, verify email, accept invite) builds on it later rather than drawing a second centred frame. The card is then the page's `main` landmark, its title (required) an `h1` that takes focus by script after a route change (`tabIndex={-1}`, never in the tab order, no ring), centred, capped at `size-page-card` (520px), and kept 16 px (`--space-16`) from each edge on a phone. Inline cards keep `section` and `h3`.
- `size` (page placement only): `md`, the default, is `size-page-card` (520px), for a page with a few lines to read (the status page, not found); `sm` is `size-panel` (400px), for a page before the app whose task is one short form (sign in, the code, spec 0036): being the page's one thing, it has `space-24` around its content and its title in heading type. Both keep 16px from each edge on a phone. Why a variant: one email field and two buttons read sparse across 520px and cramped at 16px in, and AuthLayout can't size or pad the card from outside it.
- `preview` (page placement only) puts a live preview beside the card's content from `bp-page-compact` (1024px) up: the card widens to `size-page-card` plus `size-panel`, the content keeps a `size-panel` column, and the preview fills the rest on `surface-subtle` behind a hairline. Below that width the preview is left out and the card is its content alone (give it `size="sm"` too, so it is the narrow card there). The preview is decoration, hidden from assistive technology and `inert`, so it never takes focus or a press. Beside it, the body takes the column's spare height, so a footer sits at the card's foot. Why a variant: first run's split card (spec 0036, the workspace sketch beside each step) is this page card with one more region; a second split frame would be a second card, and AuthLayout can't put a column inside the card from outside it.
- `eyebrow` is a line above the title, a control's height (`size-control`) whatever it holds, so the title holds its place: where a flow stands, as first run's Back button and "Step 2 of 3" (Steps' `count` variant). Why a slot: the title is the card's own `h1`, and what leads it has to sit inside the same header.
- An inline card's title is an `h3`, under a page's `h2`. Inside a `SettingsLayout` whose title is the page's `h1` (`titleLevel={1}`, spec 0026) it is an `h2`, set by the layout through `CardTitleLevel`, so headings never skip a level. Inside a `SettingsSection` it is one level under the section's heading (an `h3` under an `h2` section, an `h4` under an `h3` one). Why: the settings pages lost the TopBar's h1 when the settings sidebar arrived, and their Cards would otherwise jump from h1 to h3.
- Use it to group, not to decorate: a single list or form on a page needs no card, except with `placement="page"`, where the card is the page.
- What the card holds stacks 16px apart. A Select or a Table can come first with no wrapper: the hidden template and markers React Aria puts before them don't count as the first child. So the first child must be a library component or carry a class: an empty element with no class there (an `hr`, an `img`) would be taken for one of those markers.

## States

Inline or page; on a page, `md` or `sm` wide, with or without a preview beside it (shown from 1024px up). With or without an eyebrow. Its content brings the rest (Skeleton, EmptyState). `isBusy` marks the card `aria-busy` while a Skeleton stands in.

## Keyboard

Only its content takes focus.

## Differences from the artifact

Not in the artifact.
