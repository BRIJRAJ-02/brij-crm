# SiteHeader

Every page's bar: Timefix's logo, then Sign in and Get started.

## Why it exists

The home page and the legal pages share one bar. The app's own top bar (AppShell) belongs to a signed in workspace, with its sidebar and page title, so it doesn't fit a public site. The buttons are the library's ButtonLinks; the bar only lays them out.

## Use

```tsx
<SiteFrame>
  <SiteHeader />…
</SiteFrame>
```

It reads its height and gutters from the site's shared properties (`--site-bar`, `--site-inline` in `src/styles/site.css`), so the frame's crosses sit on its hairline.

## States

The buttons' states are ButtonLink's; the logo's is SiteLogo's.
