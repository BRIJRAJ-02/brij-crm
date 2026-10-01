# Spinner

Shows that something is under way, one turn per `duration-spin`: inside a pending button, and in rows and menus while they work.

## Why it exists

New in code (the artifact draws the loader icon with a `ws-spin` class inside Button). Button's pending state needs it, and so will menus, rows and file uploads, so it is one atom rather than a class each of them repeats. It is built on React Aria's `ProgressBar`, so screen readers hear an indeterminate progress bar, and inside a pending Button it joins the button's name.

## Use

```tsx
<Spinner />                                   // inside a button, at the small icon size
<Spinner size="md" label="Importing people" /> // in a row or a menu
```

- `label`: what is in progress, for screen readers. Defaults to "In progress".
- `size`: the icon size it matches: `sm` (the default), `md` or `xs`.

## States

- Reduced motion keeps a slow opacity pulse and drops the turning.

## Keyboard

It takes no focus.

## Differences from the artifact

The artifact has no Spinner card. Its Button swaps its icon for `loader-circle` with a `ws-spin` class; here that is this atom.
