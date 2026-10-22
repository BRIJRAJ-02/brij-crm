# FirstFold

The home page's first fold: the site's bar, the promise and its call to action, and the product tour.

## Why it exists

The owner asked for one dark fold and a footer (23 October 2026). The fold sets `data-theme="dark"` on itself, so every token inside it (and every library component in it) takes its dark value whatever the reader's theme, as the app's own dark theme does. Its look is the app's: tokens only, library Buttons and Icons, sidebar style rows in the tour. Display type is built from tokens with `calc()`, the way the library's base layer builds its overlay scale, because the token scale stops at 28px and a page's headline needs 36 to 60.

## Use

```tsx
<FirstFold />
```

The links come from `src/site.ts`, the tour's areas from `src/tour.ts`.

## States

The Sign in and Get started buttons are library ButtonLinks (hover, focus, disabled as theirs). The claim link draws the library's focus ring and darkens its edge on hover. The backdrop is decorative and ignores the pointer.

## Layout

One column on a phone (16px gutters), 24px gutters from 480px, and from 1024px the promise splits in two (the headline left, the pitch right) above the tour.
