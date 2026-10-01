# Verify: Component library · spec 0003 · updated 2026-10-01
_Steps derived from spec 0003's acceptance criteria and its Value sourcing table, milestone by milestone. `/check verify` runs these; `/test` locks the durable ones._

## Milestone 1: one component through the whole pipeline

### UI / manual
- [ ] `pnpm storybook` → Storybook opens on :6006 with Atoms (Button, Icon, Kbd, Spinner) and Provider (Toasts). Switch the toolbar's Theme to Dark and Language to Deutsch → the stories redraw in dark, with no errors in the console → AC-6, AC-11
- [ ] In Storybook, Tab into Atoms/Button/Keyboard → the focus ring shows only for the keyboard; a mouse press shows no ring and scales the button to 0.97 while held → AC-6, AC-10
- [ ] Turn on the OS's reduce motion setting, press and hold a button → it no longer scales; the Pending spinner pulses instead of turning → AC-10
- [ ] With Storybook running, run `/mcp` in Claude Code → `storybook` is connected, and its tools list stories and previews → AC-15
- [ ] Open the design system artifact after the publish → Button, Icon, Kbd and Spinner render live on React 19 in light and dark, with their READMEs; the other cards show their guidance without a live preview until their milestone → AC-17
- [ ] Open the web app (`pnpm dev`, or a preview deploy) → the status page renders as before, with no Content Security Policy violations in the console (UiProvider and the toast region are mounted) → AC-11, AC-13

### Commands
- [ ] `pnpm --filter @crm/ui test` → unit, stories (Chromium, Firefox, WebKit) and browser projects pass, with axe clean in light and dark and no CSP violations → AC-6, AC-15
- [ ] `pnpm test:visual` → 23 stories × 2 themes (46 baselines) match their Linux baselines. Change `padding-inline` in `Button.module.css` and run it again → the Button stories fail, and the diffs land in `packages/ui/.vitest/attachments/Button/` → AC-16
- [ ] `pnpm test:visual --update` → refuses any baseline over 200 KB → AC-16
- [ ] Run `vitest run --project visual` in `packages/ui` outside Docker → refused with "Screenshots run only in the pinned Playwright Linux image" → AC-16
- [ ] `pnpm ui:artifact --check` → the React scripts, bundle, stylesheet, types and four previews build within the type's caps, every preview renders in headless Chromium, and nothing calls `require()` → AC-17
- [ ] `pnpm size` → the first load is under 250 kB of JavaScript and 40 kB of CSS gzipped (197.7 kB and 3.9 kB at the baseline) → AC-18
- [ ] `pnpm --filter @crm/web test` → the first load test walks only static imports and finds no grid, editor, charts or schema map chunk; the CSS layer order holds → AC-18
- [ ] `pnpm --filter @crm/config test` → ESLint refuses React Aria, Tiptap and Yjs in a screen, a value atom import in a screen, literal copy in library markup, and network calls in the library; Stylelint refuses system colours outside forced colours → AC-12, AC-19
- [ ] `pnpm house-rules` → passes; a component folder without a README or stories, or two CSS modules or story titles with the same name, fail → AC-1
- [ ] `pnpm check` → green

### Value sourcing
- [ ] The language: in `apps/web`, `UiProvider` gets `navigator.languages[0]`; set the browser to `de-DE` and confirm `useFormatSettings().locale` is `de-DE` in a component (the provider browser test covers the plumbing) → Format a date, number or amount
- [ ] The time zone: `UiProvider` gets `Intl.DateTimeFormat().resolvedOptions().timeZone`; Storybook pins `Europe/London` → Format a timestamp, compute "today"
- [ ] Now: stories freeze the clock at 8 October 2026, 14:30 UTC; in the app the clock ticks every 30 seconds and pauses while the tab is hidden (`clock.test.ts`) → Relative time
- [ ] Toasts: one `createToasts()` in `main.tsx`; confirmations leave after 5 seconds, errors and actions stay, three at most (`toasts.test.ts`) → Toasts
- [ ] Toast timing and skeleton delay: 5 s; 200 ms delay, 300 ms minimum, constants in `packages/ui` (`useDelayedLoading.browser.test.tsx`) → Toast timing, skeleton delay
- [ ] Built in copy: every word in Button, Spinner and the provider comes from their `strings.ts` (lint refuses literals) → Built in copy
- [ ] Artifact version: after the publish, `packages/ui/artifact.json` holds the version id from the publish result → Artifact version

## Acceptance-criteria coverage (milestone 1)
- AC-1: house rules check, Button, Kbd, Spinner, Icon READMEs and stories · AC-2: Button states storied (hover, focus, pressed, disabled, pending, selected) · AC-6: keyboard plays, axe light and dark, forced colours test · AC-10: press scale, reduced motion · AC-11: provider settings · AC-12: copy lint · AC-13: toast policy and skeleton timing · AC-15: three engines · AC-16: Linux baselines · AC-17: `pnpm ui:artifact` and the publish · AC-18: size budget and manifest test · AC-19: lint guards
- Later milestones add their steps here.
