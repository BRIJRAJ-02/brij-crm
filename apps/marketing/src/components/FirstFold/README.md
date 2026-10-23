# FirstFold

The home page's first screen: the site's bar, the promise and its one call to action, and the showcase.

## Why it exists

The owner asked for one dark landing section, in the dashboard's design, with minimal copy and the product's areas as tabs over full width screens (23 October 2026). The fold is at least one screen tall (`100svh`) and grows when the full width screen needs more; on a phone it is as tall as its content. Its look is the app's: tokens only, library ButtonLinks, Tabs and Icons. The headline is set in the site's display face and size, declared once in `styles/site.css` (`--site-font-display`, `--site-text-display`, `--site-text-lead`), since the token scale stops at 28px and a page's headline needs more; the theme is set on the document and SiteFrame.

## Use

```tsx
<FirstFold />
```

The links come from `src/site.ts`; the showcase's areas and screens from `src/showcase.ts`.

## States

The bar's buttons are library ButtonLinks (hover, focus as theirs). The claim row is the booking address as text beside a `lg` primary ButtonLink named "Claim your page at timefix.com". The showcase's states are Showcase's and Slides'.

## Layout

One column, centred: the headline, the lead, the claim row, then the tabs and the window at the content's full width (`--site-inline` gutters from SiteFrame).
