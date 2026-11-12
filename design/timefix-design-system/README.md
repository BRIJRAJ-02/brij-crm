# Timefix design system (reference source)

The source of the Timefix design system artifact: 97 live components built with React 19, react-aria-components and lucide-react, with transitions.dev motion, plus the Bookings flow prototype.

- **Design system artifact:** https://claude.ai/artifact/KzpzW1c8binDdobPZ2HB11 (tokens, brand book, every component live with its guidelines).
- **Bookings prototype:** https://claude.ai/artifact/Bh1hskaQKszToZebiCmLKv (the whole Bookings module, full screen, with a dummy Northwind workspace).

## What this folder is, and is not

This is **reference source for development**, not a workspace package. Nothing in `apps/` or `packages/` imports it, and it is kept out of the repo's lint, format and typecheck runs (see `.prettierignore`, the ESLint ignores and `.stylelintrc` ignores). It exists so each component can be ported into `packages/ui` deliberately, one at a time, through the house rules: `/develop`, the `crm-design-system` skill, `design-system-guardian` and `ux-interaction-reviewer`.

## Layout

| Path | What |
| --- | --- |
| `tokens.json` | The tokens, in the artifact's format. Most names match `packages/tokens`; the new ones are listed in the brand book. |
| `CONVENTIONS.md` | The rules every component follows: tokens only, React Aria state attributes, the transitions.dev motion mapping, folder-owned class prefixes, the 650px card width. |
| `bookings-flow.md` | The Bookings UX brief: problems on main, principles, the flow, the full feature map. |
| `references.md` | The Mobbin references and what each one lends. |
| `src/components/<Name>/` | One folder per component: `Name.tsx`, `Name.css`, `Name.demo.tsx`, `README.md`, `meta.json` (`replaces` lists the `@crm/ui` components it supersedes). |
| `src/lib/` | Shared helpers: `format.ts` (dates and bytes), `bezier.ts`, `cx.ts`. Times go through `WeekCalendar/clock.ts`. |
| `scripts/` | `registry.mjs` (generates `src/registry.ts` and `src/exports.ts`), `collisions.mjs` (fails if two folders style the same block), `previews.mjs`, `harness.mjs`, `standalone.mjs`. |
| `standalone/bookings.tsx` | The entry for the full-screen Bookings page. |

## Building it

Uses the repo's own installs (`packages/ui/node_modules` for React, React Aria, Lucide and Tiptap) and esbuild from the root store.

```bash
node scripts/registry.mjs
node scripts/collisions.mjs
node build.mjs dist
node scripts/standalone.mjs bookings "Timefix Bookings" dist/timefix-bookings.html
```

## Porting a component into packages/ui

1. Read its `README.md` (Replaces) and the `@crm/ui` components it supersedes.
2. Move the TSX into `packages/ui/src/<tier>/<Name>/`, the CSS into a CSS module, and swap `var(--…)` names to `packages/tokens` where they differ.
3. Keep its demo as the Storybook story; keep its motion and keyboard behaviour exactly.
4. Run the reviewers, then delete the old components it replaces.

The font changes from Inter to Geist, and the primary button changes from blue to ink. Both are owner decisions to confirm before the first port lands.
