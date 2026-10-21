# Separator

A hairline between groups of content or controls.

## Why it exists

New. Menus, toolbars and panels divide groups the same way; one atom keeps the line weight and colour in one place. It wraps React Aria's `Separator`, so it is announced as one.

## Use

```tsx
<Separator />
<Separator orientation="vertical" />
<Separator label="or" />
```

- `label` puts a quiet word between two hairlines, across only: "or" between two ways to go on (Continue with Google, then the email, on sign in, spec 0036). The word is plain text read where it stands, so a screen reader hears "or" between the two; the lines are drawn by CSS and not announced (a `separator` role would hide the word, since a separator's content isn't read). Why a variant: the same hairline in the same colour, with one word; a second divider drawn on the screen would be a second line style.

## States

Across, down, and labelled.

## Keyboard

It takes no focus.

## Differences from the artifact

Not in the artifact as a card; it replaces the menu's `ws-menu-sep` and the toolbar's dividers.
