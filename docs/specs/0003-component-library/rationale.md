# 0003 · Rationale: the component library

## Context

> ⚠️ Premise note: the project builds Tracer Bullet, one thin thread through every layer first, but this feature builds about 100 components before any real flow exists.
>
> **The risk:** components get designed against imagined use. Most of the features that will use them still owe their own decisions (#13, #16, #20, #46, #53 and #54 among them), and when those land, some component APIs will need rework. The first real flow (#10) also moves back by the whole library.
>
> **What was chosen anyway:** the engineer saw this trade and chose the full library first, so the order stands.
>
> **How this spec limits the risk:** every component is presentational ("look now, logic later"), so feature behaviour arrives with its own spec. Milestone 1 threads one component through the whole pipeline before breadth. And the inventory names the feature each component serves, so the first feature to use a component reviews its API.

**The problem.** The scope's house rules say every screen is assembled only from a shared library, with one field design per attribute type, no new CSS for an element that exists, every state built in, keyboard use throughout, and tokens only. 56 features will be built by many sessions in parallel, and without a finished library each one invents its own markup, and the app drifts into fifty apps.

**Where things stand.** Spec 0001 already chose the behaviour layer (React Aria Components), styling (CSS Modules, tokens, layers), the table (TanStack Table and Virtual), dates (`@internationalized/date`) and shared notes (Tiptap, Yjs). Spec 0002 delivered the tokens, the root stylesheet, the theme and the Icon atom. The design system artifact holds 33 hand drawn component cards on React 18. The scope needs roughly 60 more, among them charts, the schema map, the notification inbox, comment threads, the import mapper, settings and the builders.

**The forces.**
- **Two copies drift.** Spec 0001's rule (draw in the artifact, port by hand) means every new component exists twice, and they diverge.
- **Values first.** Field editors need value shapes before the data model (#5) exists, and the API, imports and database must agree on them.
- **Scale.** The grid must stay smooth at 100,000 rows, and every row must come from a server window at a million records.
- **Accessibility.** It is a baseline, not an afterthought: keyboard, focus, contrast in both themes, forced colours and reduced motion.
- **Browsers and CSP.** The latest two versions of Chrome, Edge, Firefox and Safari must work. The CSP allows only `'self'` for scripts, styles and images.
- **Untrusted content.** Synced email (#43) brings HTML from outside senders.

## Options considered

### The main decision: how components come to exist

**Option 1: code first, the full inventory now (chosen).** Build each component once in `packages/ui`, with stories as tests and previews, and publish to the artifact from code.
- Pros: one implementation; the artifact always matches what ships; previews are real.
- Cons: reverses spec 0001's "artifact wins" for components; edits made on the artifact page must be merged before each publish; the publish pipeline is ours to build (React 19 global builds, bundle header, previews).

**Option 2: artifact first, ported by hand (spec 0001's rule).** Each new component is drawn in the artifact, reviewed there, then rewritten in code.
- Pros: designs are reviewed before code; the artifact stays the undisputed source.
- Cons: every component is written twice; the artifact's React 18 code can't use React 19 or React Aria as the app does, so the two behave differently; about 60 new components double the work.

**Option 3: code only for new components.** The existing 33 stay artifact first; new ones live only in code.
- Pros: the cheapest.
- Cons: the artifact stops being the full design reference, which the design system skill relies on.

**The order (also decided):** the full library first (chosen) against the Core loop's 25 pieces first and the rest after. The second shows a real flow much sooner; the engineer chose completeness first.

### The supporting choices

| Decision | Chosen | Runner up | Why |
|---|---|---|---|
| Grid engine | TanStack Virtual with our own column state | TanStack Table 9 with Virtual (spec 0001) | Table's row models expect every row in memory, which fights a million row window, and would duplicate selection state. What's left (column order, widths, pinning) is small. Found by the cross check; amends spec 0001. |
| Object icons | a curated set of about 150 | Lucide's dynamic loader, any of 1,857 | A closed registry stays type checked and small. The loader would emit about 1,500 chunks for a picker that needs a fraction. Amends spec 0002's note. |
| Screenshot storage | plain git with a 200 KB per image cap | Git LFS | Baselines are small PNGs, LFS adds quota and setup for every clone, and the cap keeps them small. |
| Workbench | Storybook 10 | our own gallery app | One file per component gives states, browser tests (Vitest addon), accessibility checks and the artifact previews. A gallery app means building all of that ourselves. Storybook 10.6 supports Vite 8, React 19 and Vitest 5. |
| Component tests | Vitest browser mode in Chromium, Firefox and WebKit | jsdom in Node | Focus, keyboard, layout and React Aria's press handling only behave truly in a browser, and the browser policy names three engines. |
| Visual checks | screenshots with Linux baselines in a pinned image | none | Catches the unrelated CSS change that restyles a component. Pinned Linux rendering avoids false failures between machines. |
| Drag and drop | React Aria's | dnd-kit (0.5, before 1.0) | Already in the stack, and keyboard and screen reader dragging come built in, which the house rules require. |
| Charts | visx building blocks | Recharts 3 | SVG with CSS variable colours (no redraw on theme change), small, and fully styleable to the dense look. Recharts is quicker to start but harder to bend. ECharts draws on canvas, which can't read CSS variables. |
| Schema map | React Flow 12 with ELK | React Flow with dagre | The standard node graph canvas, with connections built in. ELK lays out 50 objects with tidy edges, in a worker. |
| Rich text | one Tiptap editor for notes, comments and email | Tiptap for notes only | One editing model, one mention picker and one toolbar. Collaboration is on only for notes. |
| Value shapes | Zod schemas in `packages/contracts` now | types owned by the library | One schema, one name (house rule). The fields, the API, imports and #5 all build against one shape. |
| Numbers and money | exact decimal strings, 15 digits and 4 decimals | JS numbers | No floating point error in sums or conversions; matches Postgres numeric; Attio's decimal limit. |
| Phones | E.164 plus country, via libphonenumber-js | free text | Duplicates match, `tel:` links work, and shared country codes (+1) format right. |
| Several values | an "allow multiple" setting, including on select | fixed per type | One rule across email, phone, domain, URL, members, files and select, as Attio does with select. |
| Artifact previews | React 19 packed into the artifact | React 18 builds | Previews run exactly what the app runs. |
| Languages | English, with copy in `strings.ts` | inline copy | A translation catalog can come later without touching components. |
| Formats | browser now, profile later | US English and UTC | "Today" and dates are right for each person, in the same way as the theme. |
| Size | a CI budget plus separate heavy entries | entries only | Stops the first load from slowly growing. |
| Email HTML | sandboxed frame, images on request | images load at once | Scripts never run, and senders can't track opens. |

## Rationale

**Code first.** The decisive force is that two copies drift, and the artifact's React 18 code can't share React Aria's behaviour with the app. Code first makes drift impossible by construction, and the cost is a one time pipeline (the publish script) plus a merge step for page edits. Tokens stay artifact first, because spec 0002's contrast tests already prove that flow, and tokens are data rather than behaviour.

**React Aria, Storybook and browser tests.** These answer the accessibility force. Behaviour comes from a library that already handles keyboard, focus and screen readers across browsers, and every story proves it in the three named engines, with axe in both themes. The grid is the exception: spec 0001 chose TanStack for virtualisation, so its keyboard model is ours, and that's named as the top risk.

**Values in contracts.** Settling the shapes before #5 is unusual, but the field set can't be built without them. The alternative, library types plus a mapping, creates the second copy the house rules forbid. The Attio comparison shaped the details: personal name, actor reference, interaction, the four line location with coordinates, the phone's country, select with "allow multiple", and value history as an envelope. Each departure from Attio has a reason tied to our scope (per value currency for #52, null for no rating, length caps for the scale budget).

**The cross check.** A review by a different model found 54 issues, 8 of them blocking. Among them: the library needs the value schemas at runtime, not only their types. Yjs sessions belong in the data layer. Today's CSP blocks outside frames. TanStack Table fights the sparse row source. The toast queue was module level state. The performance thresholds would flake on shared runners. All were applied, including three calls the engineer approved: dropping TanStack Table, curating object icons, and keeping screenshots in plain git.

**The full inventory first.** This was the engineer's call against the Tracer Bullet default, and this spec carries it out with the mitigations in the premise note. The alternative stays easy to switch to: the milestones already build the Core loop's pieces early (milestones 1 to 3), so stopping after milestone 3 to start #5 needs no rework.

## The Attio comparison (evidence)

From Attio's attribute type pages (the overview and each type's page), read on 2026-10-01:

| Attio type | Attio's value | Ours | Outcome |
|---|---|---|---|
| text | string, 10 MB | 500 or 10,000 characters (text, long text) | ours, for the scale budget |
| number | float, 4 decimals | decimal string, 15 and 4 | adopted the limit, kept strings |
| currency | `currency_value`, code fixed per attribute (`default_currency_code`) | code per value, plus a default on the attribute | per value for #52 conversions |
| date | `YYYY-MM-DD`, zone stripped | same | adopted |
| timestamp | UTC ISO, nanoseconds | UTC ISO, milliseconds | adopted, at millisecond precision |
| checkbox | boolean | same | adopted |
| select | one type, `is_multiselect`, options with `is_archived` | one type, "allow multiple", options with `archived` | adopted |
| status | single, options with `is_archived`, `target_time_in_status`, `celebration_enabled` | single, `archived`; the time target is left to #52 | adopted the core |
| rating | integer 0 to 5 | 1 to 5, `null` for none | ours |
| email address | address plus derived domain parts | address; derived by helpers | ours |
| domain | domain plus `root_domain`, always a list | host name, "allow multiple"; `rootDomain` with #43 | partly adopted |
| phone number | original, normalised E.164, country code | E.164 plus country | adopted |
| location | `line_1` to `line_4`, locality, region, postcode, country code, latitude, longitude | the same parts | adopted |
| personal name | first, last, full | the same | adopted |
| record reference | target object and record id, multiple via flag | object and record id, multiple by the relation's cardinality | adopted |
| actor reference | member, API token or system | member, API key, automation or system | adopted, plus automation |
| interaction | email or calendar event, time, owner; system only | the same, read only | adopted |
| all values | `active_from`, `active_until`, `created_by_actor` | the `ValueVersion` envelope | adopted, for the whole value |

## Versions checked (evidence)

These were read from the npm registry with `npm view` on 2026-10-01:

| Package | Version | Peer support |
|---|---|---|
| Storybook (`@storybook/react-vite`) | 10.6.1 | Vite 5 to 8, React 16.8 to 19 |
| `@storybook/addon-vitest` | 10.6.1 | Vitest 3 to 5 |
| Vitest | 5.0.3 | |
| Playwright | 1.63.0 | |
| `react-aria-components` | 1.21.1 | `Autocomplete`, `Tree` and `Virtualizer` are stable exports; `Toast` is still `UNSTABLE_` (checked in its type exports) |
| `@tanstack/react-table` | 9.2.4 (stable; the 9 alpha and beta lines are older) | React 18 and up; checked, then dropped (see the grid engine choice) |
| `@tanstack/react-virtual` | 3.14.13 | |
| `@tiptap/react` | 3.31.4 | React 17 to 19 |
| `@visx/xychart` | 4.0.0 | needs `@react-spring/web`, which is why it's left out |
| `recharts` | 3.10.1 | |
| `@xyflow/react` | 12.12.0 | |
| `elkjs` | 0.12.0 | |
| `@dagrejs/dagre` | 3.1.1 | |
| `@dnd-kit/react` | 0.5.0 | |
| `axe-core` | 4.13.0 | |
| `size-limit` | 14.1.0 | |

React 19 publishes no global (UMD) build, so the artifact's React scripts are built by us.

## References

**Project sources**:
- `AGENTS.md`: the rules (functional first, one schema one name, strict types, accessibility baseline).
- Spec 0001: React Aria, CSS Modules, TanStack Table and Virtual, `@internationalized/date`, and Tiptap with Yjs; its component sync rule, amended here.
- Spec 0002: tokens, layers, theme, the Icon atom, and the CSP lessons.
- `.claude/skills/crm-design-system/`: the house rules (states, one field design, motion, accessibility).
- `.claude/skills/crm-frontend-state/`: optimistic writes, rollback and undo stay in the data layer.
- The design system artifact's Field card (the display, editor and operators per type) and its type's `format.md` (file shapes and caps for publishing).
- Installed skills: `tanstack-table`, `tanstack-virtual`, `tiptap`, `react-flow`, `vitest`, `building-components`, `semantic-html-first`, `modern-css-html`, `emil-design-eng`.

**Practices and standards**:
- WAI-ARIA Authoring Practices: grid pattern, roving tabindex, drag and drop alternatives.
- WCAG 2.2 AA: contrast, focus visible, keyboard.
- Content Security Policy: inheritance into `srcdoc` frames, and iframe sandboxing.
- ISO 4217 (currencies), ISO 3166 (countries), E.164 (phone numbers), ISO 8601 (dates and times).

**Links** (web verified during this design):
- Attio, attribute types: https://docs.attio.com/rest-api/attribute-types/attribute-types
- Vitest, visual regression testing: https://vitest.dev/guide/browser/visual-regression-testing
- Storybook, Vitest 5 support in the Vitest addon: https://github.com/storybookjs/storybook/pull/36270
- Storybook, MCP overview: https://storybook.js.org/docs/ai/mcp/overview
