# AuthLayout

The frame for the pages before the app: the product's mark and name, then the page card holding the page's task, centred in the window.

## Why it exists

New (spec 0005, pulled forward from spec 0003's milestone 4). Sign in, verify and the welcome screen share one frame, and screens are built from library parts only. It is not a second centred frame: the card is `Card` with `placement="page"` (the page's `main`, its title the `h1`, capped at `size-page-card` and kept `space-16` from each edge on a phone), and the mark is `Avatar` with the `ink` hue, the workspace mark the sources describe. AuthLayout adds only the mark above the card and the column that centres both.

## Use

```tsx
<AuthLayout productName="CRM" title="Sign in">
  <SignInForm onContinue={sendCode} onGoogle={google} />
</AuthLayout>
```

- `title` is the page's heading; screens move focus to it on a route change.
- `description` is a line under it; `footer` a way back or terms, under a hairline.
- The column is at least the window's height, so the card sits in the middle on a desktop and scrolls on a short phone screen.

## States

Its content brings them (SignInForm, VerifyEmail, Form).

## Keyboard

Only its content takes focus.

## Differences from the artifact

Not in the artifact.
