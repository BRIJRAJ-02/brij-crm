# AuthLayout

The frame for the pages before the app: the product's mark and name, then the page card holding the page's task, centred across the window at a fixed offset from the top.

## Why it exists

New (spec 0005, pulled forward from spec 0003's milestone 4). Sign in, verify and the welcome screen share one frame, and screens are built from library parts only. It is not a second centred frame: the card is `Card` with `placement="page"` (the page's `main`, its title the `h1`, capped at `size-page-card` and kept `space-16` from each edge on a phone), and the mark is `Avatar` with the `ink` hue, the workspace mark the sources describe. AuthLayout adds only the mark above the card and the column that centres both.

## Use

```tsx
<AuthLayout productName="Timefix" logo={{ light: '/brand/timefix-wordmark-light.png', dark: '/brand/timefix-wordmark-dark.png' }} title="Sign in">
  <SignInForm onContinue={sendCode} onGoogle={google} />
</AuthLayout>
```

- `logo` puts the product's wordmark in place of the mark and name: `light` (dark ink) for the light theme and `dark` (white) for the dark one, both named by `productName`. Both images are in the page and the CSS module shows one: the dark one under a saved Dark choice (`data-theme="dark"` on the root), or under the OS's dark scheme when nothing is saved, the rule the tokens follow. Why a prop rather than a token: the wordmark is an image, which no colour token can recolour, and the library ships no product assets, so the app passes the URLs of its own files. The wordmark is `size-control` tall.
- `title` is the page's heading; screens move focus to it on a route change.
- `description` is a line under it; `footer` a way back or terms, under a hairline.
- `isBusy` marks the card busy while a `Skeleton` stands in for its task (the screen is still checking the session), so assistive tech waits for it. Show the Skeleton through `useDelayedLoading`, so a fast check never flashes it.
- It fills its container, like AppShell: give it the window's height (the web app mounts in `data-app-root`, which the base layer sizes to the window). The column is at least that tall, and grows past it so the page scrolls on a short phone screen. The mark sits twice `space-32` from the top, never centred down the window: centred, the card jumped between sign in, verify and welcome (each a different height) and moved when a refusal made it taller, so the field under the pointer moved too. The page's background and text colour come from the base layer; the card's own margin keeps `space-32` below it.

## States

With a logo, or the mark and name. Loading (`isBusy`, with a Skeleton for the task). The rest its content brings (SignInForm, VerifyEmail, Form).

## Keyboard

Only its content takes focus.

## Differences from the artifact

Not in the artifact.
