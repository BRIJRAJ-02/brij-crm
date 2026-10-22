# SiteLogo

Timefix's mark and wordmark, linking to the top of the home page.

## Why it exists

The marketing site's header and footer both show the brand. The app has no logo component of its own: AuthLayout and the booking frame draw the wordmark from a `ProductLogo` pair, inside their own layouts, so nothing in `@crm/ui` fits a bare logo link. It uses the brand's own files in `public/brand`, the same ones the app's sign in and booking pages draw.

## Use

```tsx
<SiteLogo tone="dark" />   // the first fold, dark in every theme
<SiteLogo tone="system" /> // the footer, which follows the reader's theme
```

## States

Focus from the keyboard draws the library's focus ring (`shadow-focus-inset` plus the halo). The images are decorative; the link is named "Timefix home".
