# SiteFrame

Every page's frame: dark in every theme, with Twenty's hairline frame.

## Why it exists

The owner asked for a dark first fold, then for the site to look and feel like Cal.com, Attio and Twenty (23 October 2026). One frame keeps the home page and the legal pages the same: the app's own dark ink (`data-theme="dark"`, so every token and library component inside takes its dark value), a faint light at the top, and a line down each side of the content with a cross where it meets the bar's hairline. Nothing in `@crm/ui` frames a public page: AppShell is a signed in workspace, AuthLayout a sign in card.

## Use

```tsx
<SiteFrame>
  <SiteHeader />
  <main>…</main>
  <SiteFooter />
</SiteFrame>
```

The lines follow the site's shared properties in `src/styles/site.css`: `--site-edge` (where the lines run), `--site-inline` (where content starts) and `--site-bar` (the bar's height, where the crosses sit).

## States

Decorative only. The lines and crosses show from the compact breakpoint (1024px) up.
