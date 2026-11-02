# Spec 0063 slice 5: the checks that were run, and what they said

All run in this worktree, scoped to what the slice changed (the owner's laptop is shared with another lane).

| Check | Command | Result |
|---|---|---|
| Typecheck, contracts | `pnpm --filter @crm/contracts typecheck` | clean |
| Typecheck, core | `pnpm --filter @crm/core typecheck` | clean |
| Typecheck, ui | `pnpm --filter @crm/ui typecheck` | clean |
| Typecheck, web | `pnpm --filter @crm/web typecheck` | clean |
| Lint, contracts | `pnpm --filter @crm/contracts lint` | clean |
| Lint, core and data | `pnpm --filter @crm/core lint`, `--filter @crm/data lint` | clean |
| Lint, ui | `pnpm --filter @crm/ui lint` | clean |
| Lint, web | `pnpm --filter @crm/web lint` | red first (two `no-unnecessary-condition`), fixed, then clean |
| Format | `prettier --check` over every changed file | clean |
| CSS | `pnpm lint:css` | clean |
| Boundaries | `pnpm boundaries` | 3,053 files in 13 packages, no issues |
| House rules | `pnpm house-rules` | no problems |
| Tests, contracts | `vitest run src/forms/` in `packages/contracts` | 112 passed (`s5-tests-contracts.txt`) |
| Tests, core | `vitest run src/forms/` in `packages/core` | 107 passed (`s5-tests-core.txt`) |
| Tests, web (node) | `vitest run --project node src/features/{questions,forms}/` | 88 passed (`s5-tests-web-node.txt`) |
| Tests, web (browser) | `vitest run --project browser src/features/{questions,forms}/` | 35 passed (`s5-tests-web-browser.txt`) |
| Tests, ui (browser) | `vitest run --project browser src/public-form/` | 19 passed (`s5-tests-ui-browser.txt`) |

Not run here, on purpose: `pnpm size` (AC-6331's budget, builds the whole web app), `test:visual`, the stories matrix
and the flow tests. They belong to the integration car's CI run.
