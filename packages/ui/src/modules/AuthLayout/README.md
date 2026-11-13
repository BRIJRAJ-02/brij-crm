# AuthLayout

The frame for the pages before the app: the product's mark and name, then the page card holding the page's task, centred across the window at a fixed offset from the top.

## Why it exists

New (spec 0005, pulled forward from spec 0003's milestone 4). Sign in, verify and the welcome screen share one frame, and screens are built from library parts only. It is not a second centred frame: the card is `Card` with `placement="page"` and `size="sm"` (the page's `main`, its title the `h1`, capped at `size-panel`, 400px, and kept `space-16` from each edge on a phone; spec 0036 narrowed it from `size-page-card`, since every page it frames is one short form), and the mark is `Avatar` with the `ink` hue, the workspace mark the sources describe. AuthLayout adds only the mark above the card and the column that centres both.

## Use

```tsx
<AuthLayout
  productName="Timefix"
  logo={{ light: '/brand/timefix-wordmark-light.png', dark: '/brand/timefix-wordmark-dark.png' }}
  title="Sign in"
>
  <SignInForm onContinue={sendCode} onGoogle={google} />
</AuthLayout>
```

- `logo` puts the product's wordmark in place of the mark and name: `light` (dark ink) for the light theme and `dark` (white) for the dark one, both named by `productName`. Both images are in the page and the CSS module shows one: the dark one under a saved Dark choice (`data-theme="dark"` on the root), or under the OS's dark scheme when nothing is saved, the rule the tokens follow. Why a prop rather than a token: the wordmark is an image, which no colour token can recolour, and the library ships no product assets, so the app passes the URLs of its own files. The wordmark is `size-control` tall.
- `title` is the page's heading; screens move focus to it on a route change.
- `account` says who is signed in at the start of the footer ("Signed in as ada@acme.com"), small and muted, whole (a long email breaks rather than being cut), with `footer`'s actions at the end of the same line, wrapping under it on a narrow card: first run passes it beside Sign out, so a person sees which account they are setting up. Why a prop: the words sit in the card's own footer row, and a screen has no styles of its own to set them in.
- `description` is a line under it; `footer` a way back or Sign out, under a hairline at the line's end, as Buttons with `variant="link"` so the footer stays one quiet line (owner feedback, 21 October 2026).
- `isBusy` marks the card busy while a `Skeleton` stands in for its task (the screen is still checking the session), so assistive tech waits for it. Show the Skeleton through `useDelayedLoading`, so a fast check never flashes it.
- It fills its container, like AppShell: give it the window's height (the web app mounts in `data-app-root`, which the base layer sizes to the window). The column is at least that tall, and grows past it so the page scrolls on a short phone screen. On a phone the mark sits twice `space-32` from the top, so the card stays put when the keyboard opens. From `bp-page-compact` up it sits a little above the middle (spec 0036): the offset is half of what the window's height leaves around a reference block (`size-panel` for the narrow card; `size-page-card` less `size-bar` for the split screen's task), and never less than twice `space-32`. Why a reference and not the card's own height: centred on its own height, the card jumped between sign in, verify and first run (each a different height) and moved when a refusal made it taller, so the field under the pointer moved too. The page's background and text colour come from the base layer; the card's own margin keeps `space-32` below it.
- `preview` makes the page the split screen (owner, 22 October 2026: "make left and right full screen", "much nicer instead of a concentrated system"; the Sprig, Mintlify and Linear sign up pattern): two panels fill the window edge to edge, with no card, border or outer margin. The left panel (about 42% from `bp-page-compact` up, on `surface`) holds the mark at its top start, the task in a readable column centred in it (`size-panel`, 400px, at most, the width Linear, Notion and Vercel give a sign in form) at the still offset above, and who is signed in with the footer's actions at its foot. The right panel (the rest, on `surface-sunken`, a hairline between) holds the sketch, which anchors twice `space-32` in from its top and start and bleeds off its end and foot at every width (`WorkspacePreview`: live on first run, the sample workspace on sign in, verify, two factor, join and invite). Each panel is the window's height; the left scrolls on its own when its task is taller. Below that width the sketch is left out and the left panel fills the screen, the footer at its foot. The task is a page card with `tone="bare"`, so its `h1`, eyebrow, body rhythm and busy state are the card's. Sign in, verify, two factor, join, invite, first run and their loading and error states all pass `preview` (`signInFrame`), so they share it. `eyebrow` is a line above the title (Card's `eyebrow`): first run's Back and its step count.

## States

With a logo, or the mark and name. Narrow, or the split screen with a preview (two panels from 1024px up). With or without an eyebrow. Loading (`isBusy`, with a Skeleton for the task). The rest its content brings (SignInForm, VerifyEmail, Form).

## Keyboard

Only its content takes focus.

## Differences from the artifact

Not in the artifact.

## Timefix prototype (spec 0072)

Takes its look from the prototype's AuthLayout, which also replaces PreviewLayout's sign in use. The centred card stands on `canvas`, so the page card's `surface` lifts off it. The split is `5fr` to `6fr` from `bp-page-compact` up (the task's half a little narrower than the preview's), its task panel `space-24` by `space-32` in, the task's column `size-dialog` wide at most, and the preview's half on `canvas` behind a `border-subtle` hairline. Who is signed in reads in `text-body-sm`, `text-secondary`.

**Use it for** sign in, verify, join, invite and first run. **Don't use it for** anything inside the app (AppShell) or a dialog's content.

**The consumer provides** `productName`, `logo`, `title`, `description`, `eyebrow`, `children` (SignInForm, VerifyEmail, a Form), `footer`, `account`, `preview` (WorkspacePreview), `isBusy`.

**States**: centred card (`Default`), split (`Split`), busy (`Loading`), narrow (`Narrow`), with a wordmark, with a footer.

**Differences from the prototype**
- The heading and its card are Card's (`placement="page"`, `size="sm"`): its `text-title` heading, its padding and radius, and the staggered heading reveal (transitions.dev 18) are owed to Card's page look; the prototype's `AuthHeading` is a Card title here.
- The mark and name sit centred above the card (the prototype puts the logo at the top start), the footer inside the card, and the card holds still at an offset from the window's height (the owner, 27 October 2026) rather than centring on its own height.
- The preview half keeps WorkspacePreview's own anchoring (cropped at its end and foot); the prototype centres its sketch, owed to WorkspacePreview (phase 2). `AuthPages`' side by side slide is not here: the app routes between steps.
