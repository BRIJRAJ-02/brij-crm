# packages/contracts

## Overview

The oRPC contract and the Zod schemas the web app, the API and the worker all share. Changing a shape here breaks the build everywhere it's used, rather than in production. Tagged `shared`, so both client and server code may import it.

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | The one `contract` object, with one namespace per feature, and every schema and type |
| `src/system.ts` | The pattern to copy: schemas, their types, and `systemContract` |
| `src/codes.ts` | `@crm/contracts/codes`: every stable error code as plain lists with no Zod, so the browser's data layer recognises a code without loading the schema library. `errors.ts` builds `ErrorCode` from it |
| `src/plain-errors.ts` | `@crm/contracts/plain-errors`: the safety net under every schema with no message of its own. `plainIssueMessage` words each Zod issue code in plain English ("Add this.", "Use 60 characters or fewer.", "Pick one of the choices."), never the input, a type name, a pattern or a choice's value; `installPlainErrors()` makes it Zod's message map, called once by `createApp`, the worker and the web app's `main.tsx`. Imports only Zod's core config, so the first load stays small. A schema's own message always wins; `plain-errors.test.ts` walks every contract input to prove no failure falls through to Zod's text |
| `src/monitoring/` | `@crm/contracts/monitoring` (spec 0010): `scrub`, the one rule for what may leave for Sentry, run by every send hook of both SDKs. Plain TypeScript, no Zod, no vendor, so the browser's lazy Sentry chunk shares it |
| `src/monitoring/events.ts` | `@crm/contracts/events` (spec 0010, AC-173): the product event catalog, one strict schema per PostHog event, ids and closed lists only, and `milestoneEventId`. Server only (it hashes with `node:crypto`, and the browser never contacts PostHog) |
| `src/values/jump.ts` | `@crm/contracts/jump` (also in `values`): `canJump(filter, sorts, attributeOf)`, the one rule for whether a view jumps by position or pages by cursor (spec 0006, AC-52), with no Zod, so the browser's records layer picks a window's mode by it and the engine refuses a position by it |
| `src/validation/` | `@crm/contracts/validation` (spec 0013): `checkRules`, `matchesCondition`, `summarizeCondition`, `formatDay` and the generated messages, plain TypeScript with no Zod, so the engine (under the record lock) and the browser's records layer (before a write) run the same checker. The pattern engine is injected (`re2js` on both sides). The rule schemas and `checkRuleSettings` live in `src/values/validation-rules.ts` |
| `src/views.ts`, `src/view-model.ts` | Saved views (spec 0020): `ViewConfig`, `ViewLayout`, `View`, `ViewSummary`, the `views` contract and `decodeDraft` (Zod); and `@crm/contracts/views` (`view-model.ts`, no Zod): `isSortable` (the one rule `compileSorts`, SortBuilder's list and the config check share), `effectiveQuery` (archived and unknown attributes left out, newest first when there are no sorts, `pending` while a through path's far attributes load, `unchecked` when the reader doesn't know the far object), `effectiveColumns`, `queryKey`, `encodeDraft` and `decodeDraftText` |
| `src/emails.ts` | `@crm/contracts/emails` (the emails lane): each email's params (`EMAIL_PARAMS`, strict, links as `AppPath`s, never whole addresses), `QUEUED_EMAIL_KINDS` (what the workspace email queue takes; an invitation is sent from its request, a sign in alert has a template only), `EMAIL_TOPICS` and `EMAIL_KIND_TOPICS` (the one list of emails a member can turn off: new form submissions and mentions), and the preferences page's shapes |
| `src/brand.ts` | `@crm/contracts/brand`: the Timefix links ("Powered by Timefix", "Claim your free page"), plain TypeScript with no Zod, so the public pages' bundles stay small. `timefixUrl` tags timefix.ai `utm_source=timefix`, `utm_medium` from the closed `POWERED_BY_PAGES` and `POWERED_BY_EMAILS` lists, `utm_campaign=powered_by`, `utm_content` from `POWERED_BY_PLACEMENTS` (`footer_logo`, `claim_link`), and `ref` only for a workspace address that isn't an id. The booking pages and the guest page (`@crm/ui/public-booking`'s `poweredByHref` and `claimPageHref`), the hosted form (`poweredByHref`) and every email (`@crm/emails`' `poweredByUrl`) build their links here |
| `src/values/social.ts` | Social profile links (in `values`): `networkOfAttribute`, `profileKindOf`, `checkSocialProfile` (a handle or profile link to the one canonical link, or a typed `reason`), `checkWebLink`, `describeLink`, `exampleHandle` and `urlContainsNeedles` ("@ada" also looks for `/ada`). No Zod use beyond `UrlValue` and no copy: the url field and the engine's `parseAttributeInput` word refusals themselves |
| `src/values/` | `@crm/contracts/values`: the attribute value shapes, filters, sorts, options, hues, countries and currencies, as plain Zod with no oRPC and no I/O, so `packages/ui` can parse what its editors emit |

## Conventions

- One file per feature holds its schemas and a `<feature>Contract`, joined into `contract` in `src/index.ts`.
- Every procedure declares its output (`oc.output(...)`), and its input when it takes one.
- A schema and its type share a name. Timestamps are ISO 8601 UTC strings (`z.iso.datetime()`).
- No runtime dependencies beyond `@orpc/contract` and `zod`, and no imports from any other workspace.
- `src/values/` imports only Zod and its own files, never `@orpc/contract`: the component library loads it on the client.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
