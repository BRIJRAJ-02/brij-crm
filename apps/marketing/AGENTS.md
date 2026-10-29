# apps/marketing

## Overview

The marketing site, www.timefix.com: the home page (one dark screen: the promise, a claim-your-page call to action, and the product's four areas as tabs over full screens of a demo workspace), plus `/privacy` and `/terms`. Static: every page is rendered at build time from the same React tree the browser then hydrates, so the pages draw before any script runs and the tabs come alive after. Built from the design system (`@crm/tokens`, `@crm/ui`), so it looks like the app. Tagged `client`.

## Key files

| File | Owns |
|---|---|
| `index.html` | The shell every page is written into: the head (title, description, canonical, Open Graph, structured data, icons) with the home page's values, the `<!--app-->` slot and the one script |
| `src/client.tsx` | The browser's entry: hydrates the page the address names (`routes.ts`); in dev it draws it instead |
| `src/tags.ts` | The outside measurement the old Timefix site ran (29 Oct 2026): Google Analytics 4 (`VITE_GA_MEASUREMENT_ID`, or the old site's `NEXT_PUBLIC_GA_MEASUREMENT_ID` the Vercel project still holds, through `envPrefix`; one `page_view` per page with the whole address, so UTMs and click ids count), Microsoft Clarity (`VITE_CLARITY_PROJECT_ID`, or `NEXT_PUBLIC_CLARITY_PROJECT_ID`), and Vercel's Web Analytics and Speed Insights (`VITE_VERCEL_ANALYTICS=1`, once the project has them switched on). Production builds only, each only with its id, never under automation, and never an inline script: vercel.json's CSP names each tag's origins. The privacy policy already names GA and Clarity. Not ported: the old site's server side funnel cookies (`tf_aid`, `tf_attr`) and CTA cookie, which need a server this static site doesn't have |
| `src/render.tsx` | The SSR build's entry: `render(page)` as HTML, plus `ROUTES` for the prerender |
| `src/App.tsx` | The page inside `UiProvider` (a fixed clock and platform, so the server and the browser render the same) |
| `src/routes.ts` | The pages: path, built file, title and description |
| `src/site.ts` | Every link out: the app (`app.timefix.com`, where `/sign-in` both signs in and signs up), the booking origin (`timefix.com`) |
| `src/showcase.ts`, `src/features.ts` | The four areas with their screens (three each, with address and caption), and every feature by area (the All features sheet) |
| `src/styles/site.css` | Also the site's type outside the app's scale: the display face, the headline, lead and reading sizes, declared once |
| `src/components/` | The site's own components, each with a README: `SiteFrame` (dark, Twenty's hairline frame), `SiteHeader`, `FirstFold`, `Showcase` (the feature tabs), `Slides` (an area's screens playing in the window), `AllFeatures` (the library's Modal, a rail beside the sections), `SiteFooter`, `SiteLogo`, `LegalPage` |
| `src/pages/` | The privacy policy and the terms, ported unchanged from the old Timefix site on 23 Oct 2026 |
| `src/styles/site.css` | The site's shared custom properties (gutters, frame lines, bar height), built from tokens; Stylelint reads it |
| `src/styles/fonts.css` | Host Grotesk, the headline face (SIL OFL, `src/fonts/`) |
| `scripts/prerender.ts`, `scripts/page.ts` | The build's last step: each route rendered into the shell with its own head, the SSR bundle deleted |
| `public/shots/` | The screens, `<area>-<n>.webp`: 3840 × 2400 WebPs, dark, of a seeded demo workspace (American names and companies) |
| `vercel.json` | Clean URLs, the CSP and caching, and 308s of the old `www.timefix.com/<handle>` booking links to `timefix.com` |

## Commands

```bash
pnpm --filter @crm/marketing dev:site   # :5180
pnpm --filter @crm/marketing build      # client build, SSR build, prerender → dist/ (index, privacy, terms)
pnpm --filter @crm/marketing preview    # :5181, the built site
pnpm --filter @crm/marketing test       # the prerender's page rewriting
```

## Conventions

- Tokens only, library components only, the house rules of `crm-design-system`. Components the library has no place for (a public site's frame, footer, legal column) live in `src/components`, each with a README saying why.
- Nothing in the tree may read the browser while rendering (`document`, `window`, `Date.now()`): the server has none, and hydration must match. Values that change per build go through `define` in `vite.config.ts`.
- The feature list (`features.ts`) names only what is live on app.timefix.com.
- `/privacy` is read by Google's OAuth verification: its Limited Use paragraph stays word for word.

## Deploy

Its own Vercel project, root directory `apps/marketing`, framework none, build `pnpm --filter @crm/marketing build`, output `apps/marketing/dist`, attached to www.timefix.com, which serves the site (24 Oct 2026); `www.www.timefix.com` moves there.

## Gotchas

- `dist-ssr/` exists only during a build. ESLint ignores it; delete it if a build dies halfway.
- The old Timefix repo's marketing app (`timefixmarketing`) owned www.timefix.com and the `/<handle>` booking pages. The booking pages now live on timefix.com (`BOOKING_PUBLIC_ORIGIN`), and `vercel.json` forwards the old addresses there.
