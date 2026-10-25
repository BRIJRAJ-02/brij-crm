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

- `actions` sit at the end of the header, standing on the title's line: their box is one title line tall and centres what it holds, so a button taller than the line ("View all") sits level with the title, not below it (the owner, 21 October 2026), and the header keeps the title's height. `footer` holds a form's Save, or a card's few actions (Home's link page card: Copy link, Open, Show QR code); they wrap onto a second line, still at the end, when the card is narrower than they are (a phone), rather than running off its edge.
- `footerNote` is a quiet line at the start of the footer, before its buttons, for something about the content above that the buttons would otherwise have to carry: the link page's editor says "Booking pages from another workspace keep their own section. Nobody visiting the page sees which workspace a page came from.", and only when the person's pages come from more than one workspace. It takes the room the buttons leave and wraps rather than pushing them, so a narrow card reads the line first and then the buttons. It needs `footer`, it is one short sentence, and it is never a warning or an error, which belong in the body as a Callout. Why a slot and not a line in the body: it belongs to the actions, and at the end of the body it read as one more thing in the list.
- `tone="sunken"` for a quieter group inside a page.
- `tone="bare"` draws no frame (no hairline, corners, shadow or surface): a page card inside a layout that frames it, AuthLayout's split screen. A bare page card takes its slot's width with no margin, and its heading and body start at its edges so they line up with what sits above it. Why a tone and not a new component: the page card's heading (`h1`, focus on route change), eyebrow, body rhythm and busy state are exactly what the split screen needs; only the frame goes. It replaced the `preview` variant (22 October 2026), which split a page card in two for first run: that split is now AuthLayout's full screen, so nothing used the variant and it went.
- `placement="page"` is the one frame for a page outside the app shell: the status page and the not found page now, and `AuthLayout` (sign in, sign up, verify email, accept invite) builds on it later rather than drawing a second centred frame. The card is then the page's `main` landmark, its title (required) an `h1` that takes focus by script after a route change (`tabIndex={-1}`, never in the tab order, no ring), centred, capped at `size-page-card` (520px), and kept 16 px (`--space-16`) from each edge on a phone. Inline cards keep `section` and `h3`.
- `size` (page placement only): `md`, the default, is `size-page-card` (520px), for a page with a few lines to read (the status page, not found); `sm` is `size-panel` (400px), for a page before the app whose task is one short form (sign in, the code, spec 0036): being the page's one thing, it has `space-24` around its content and its title in heading type. Both keep 16px from each edge on a phone. Why a variant: one email field and two buttons read sparse across 520px and cramped at 16px in, and AuthLayout can't size or pad the card from outside it.
- `eyebrow` is a line above the title, a control's height (`size-control`) whatever it holds, so the title holds its place: where a flow stands, as first run's Back button and "Step 2 of 3" (Steps' `count` variant). Why a slot: the title is the card's own `h1`, and what leads it has to sit inside the same header.
- An inline card's title is an `h3`, under a page's `h2`. Inside a `SettingsLayout` whose title is the page's `h1` (`titleLevel={1}`, spec 0026) it is an `h2`, set by the layout through `CardTitleLevel`, so headings never skip a level. Inside a `SettingsSection` it is one level under the section's heading (an `h3` under an `h2` section, an `h4` under an `h3` one). Why: the settings pages lost the TopBar's h1 when the settings sidebar arrived, and their Cards would otherwise jump from h1 to h3.
- Use it to group, not to decorate: a single list or form on a page needs no card, except with `placement="page"`, where the card is the page.
- What the card holds stacks 16px apart. A Select or a Table can come first with no wrapper: the hidden template and markers React Aria puts before them don't count as the first child. So the first child must be a library component or carry a class: an empty element with no class there (an `hr`, an `img`) would be taken for one of those markers.

## States

Inline or page; on a page, `md` or `sm` wide. With or without an eyebrow. Its content brings the rest (Skeleton, EmptyState). `isBusy` marks the card `aria-busy` while a Skeleton stands in.

## Keyboard

Only its content takes focus.

## Differences from the artifact

Not in the artifact.
