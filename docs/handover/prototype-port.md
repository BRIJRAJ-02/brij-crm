# Porting the Timefix prototype into the real app

The prototype (Timefix v40, Bookings v68, Business v42, design system v55) carries every real-app feature plus the owner's 11–12 Nov changes. This is how to move it into `apps/web` and `packages/ui` so nothing is missed or misaligned.

## Where everything is

| What | Where |
| --- | --- |
| Prototype source (the thing to port) | branch `feat/design-system-v2` (PR #4), folder `design/timefix-design-system/src` (`components/<Name>/` = library parts with README; `components/TimefixApp/` and `components/BookingsFlow/` = screens) |
| What each part must do | each `components/<Name>/README.md` (consumer props, states, interaction, motion) and `CONVENTIONS.md` |
| What the prototype covers, line by line | `design/timefix-design-system/parity-gaps.md` (every line ticked) |
| How every flow behaves, as runnable steps | `design/timefix-design-system/walks/*.mjs` (smoke, w11–w14, wB, wC, wD1, wD2, wE, wF, wG, wH, dnd, every, popalign, signup) |
| The look to match | the live artifacts: [Timefix](https://claude.ai/artifact/QaFtnfjqqD1HBgvp9xiWUL), [Bookings](https://claude.ai/artifact/Bh1hskaQKszToZebiCmLKv), [Business](https://claude.ai/artifact/PCChBuyL18P6hfnastgq3z), [Design system](https://claude.ai/artifact/KzpzW1c8binDdobPZ2HB11) |
| House rules | `AGENTS.md`, the four `.claude/skills/crm-*` skills, the reviewer agents |

## Before you start (once)

1. **Merge PR #4** into `main` (it only adds `design/timefix-design-system/`; its commits are `[skip ci]`). Then every port branch has the prototype beside the code it replaces.
2. In VS Code, open `/Users/brijraj/Desktop/brijraj/crm`, start Claude Code, and run each phase below in its **own worktree branch** off `main` (`feat/port-<phase>`), one phase at a time (laptop budget: one build lane).
3. **Decide the type scale first** (phase 0). The prototype draws the dashboard at 88% with CSS `zoom` (and a React Aria placement patch to survive it). The real app must not use zoom: phase 0 turns "88% of the prototype's sizes" into real token values (type, spacing, control heights) so the real app matches the artifacts pixel for pixel without zoom. This is the biggest misalignment risk; settle it before porting anything.

## Phases (in this order)

Each phase: `/architect` writes the spec (decision, rationale, verify), `/develop` builds it, `/check verify` drives the real app against the spec and the artifact, `/check review` before the PR. Library phases run `design-system-guardian`; screens add `ux-interaction-reviewer`; anything touching data adds `state-performance-reviewer` and `security-access-reviewer`.

| # | Phase | Prototype source | Lands in |
| --- | --- | --- | --- |
| 0 | Type scale and tokens (the 88% decision), motion tokens, the font pack | `standalone.mjs` zoom note, `tokens.json`, `styles/packs.css` | `packages/tokens` |
| 1 | Library parity: the 72 parts both sides have, aligned to the prototype's README, CSS and states | `components/<Name>/` | `packages/ui` atoms, molecules, modules |
| 2 | Library additions: the 27 parts only the prototype has (AIAssist, AttributeField, BookingFlow, CalendarConnections, Checklist, ColorPicker, ComboBox, Dialog, Drawer, FilterBar, HostedForm, LinkEditor, Logo, MeetingList, MenuPage, Motion, NumberField, Onboarding, Presence, Progress, RichTextEditor, SearchField, ShareSheet, Text, TimeField, Toast, VenuePage); several exist in the real app under another name or in `public-*`, so map each before building | as above | `packages/ui` |
| 3 | Shared behaviour: one drag wrapper (`lib/drag.ts` → the real `lib/drag/drag.tsx`), guest looks on popups (`lib/look.ts`), PublishBar + ShareSheet everywhere, record panel floating full height | `src/lib/*` | `packages/ui` |
| 4 | Shell, navigation, settings layout, sign in, welcome, invite, join | `TimefixApp.tsx`, `auth.tsx`, Onboarding, SettingsLayout | `apps/web` |
| 5 | CRM core (wave B) | `records.tsx`, `record.tsx`, `model.tsx`, `automations.tsx`, `datasettings.tsx`, `import2.tsx` | `apps/web`, `packages/data`, `packages/contracts`, api |
| 6 | Scheduling (wave C) | `BookingsFlow/*`, `scheduling.tsx` | same |
| 7 | Forms, link page, insights (wave D1) | `forms.tsx`, `formparts.tsx`, `grow.tsx`, `growparts.tsx`, `copyws.tsx` | same |
| 8 | Hospitality and business (wave D2) | `menu.tsx`, `menu-qr.tsx`, `tables.tsx`, `business.tsx`, `services.tsx` | same |
| 9 | Settings, admin, public pages (wave E + finishing) | `settings.tsx`, `people.tsx`, `account.tsx`, `devtools.tsx`, `admin.tsx`, `public.tsx` | same |

Phases 5–9 need server work wherever the prototype keeps things in local state (automations, webhooks, kind changes, jobs, round robin, copies across workspaces…): each spec lists the contract, migration, service and API changes.

## How nothing gets missed

- **One port ledger.** Copy `parity-gaps.md` to `docs/scope/port-ledger.md`; each line gets the phase and the PR that ported it. A phase is done only when all its lines are ticked.
- **Every README is a checklist.** For each library part, its README's "consumer provides", "States" and "Interaction" become the Storybook stories and the browser tests. A state with no story is a missed state.
- **Walks become e2e tests.** Each `walks/*.mjs` encodes a flow step by step; port it into Playwright against the real app in the same phase. When the real app passes the same steps, the flow is ported.

## How nothing gets misaligned

- **Side-by-side screenshots.** Shoot the artifact and the real app at the same seed state, 1440 and 390 wide, light and dark, and diff them (the prototype's `walks/head.mjs` and `pdiff.mjs` show how). Review every diff before the PR.
- **Tokens only.** Nothing in the port gets a raw size or colour; if a value doesn't exist as a token, phase 0 is unfinished.
- **The artifacts win.** If the real app and the prototype disagree on a look or a word, the prototype is the source; if it disagrees on data rules or permissions, the real app's contracts are, and the spec records the decision.

## First prompt for Claude Code in VS Code

> Read docs/handover/prototype-port.md and AGENTS.md. We are porting the Timefix prototype into the real app, phase 0 first: run /architect for "Port phase 0: type scale and tokens", deciding how the prototype's 88% dashboard scale becomes real token values (no CSS zoom), plus motion tokens and the font pack. Use the design system artifact and design/timefix-design-system as the source. Don't build yet; write the spec and show me the decision.
