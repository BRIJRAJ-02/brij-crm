# packages/emails

## Overview

Every email the product sends, drawn from the design tokens (spec 0001 names this package). Templates turn params into words (an `EmailDocument`), and one layout draws those words twice, as HTML (React Email) and as plain text, so the two parts always match and every email shares one design and one footer. Nothing here sends or reads a database: the api's mailer sends a sign in code from its request, and everything else comes through the worker's email task. Tagged `server`.

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | The public API: `renderSignInCode`, `renderMemberInvite`, `renderBookingEmail`, `renderDocument`, and the parts below |
| `src/tokens.ts` | The token reader: colours (opaque hex only, aliases followed), spaces, radii, sizes, breakpoints and type styles from `@crm/tokens/tokens.json`, by name; an unknown name throws |
| `src/theme.ts` | Each part of an email (page, card, text, button, code, quote, rule) and the colour tokens it takes; light inline, dark as one stylesheet under `prefers-color-scheme: dark` and Outlook.com's `[data-ogsc]`/`[data-ogsb]`; the 600px width; Outlook's font stacks |
| `src/render.ts` | The one layout and its plain text twin, the shared footer (Powered by Timefix, why the reader got it, the preferences link for an optional email), and `headerText` (subjects on one line) |
| `src/document.ts` | `EmailDocument` and its blocks: paragraph, rows (compact or stacked), code, button (app origin), call button (a meeting's https video call, the one link to another site), quote, note |
| `src/templates/invite.ts` | An invitation to a workspace (spec 0031), sent from the inviting request: `renderMemberInvite(params, { appOrigin, workspaceName })`, its params `MemberInviteEmail` from `@crm/contracts/emails` (the accept link an app path carrying the raw token, drawn and never stored), tagged `email_invite` |
| `src/templates/booking.ts` | A booking's emails (spec 0025): core's `prepareBookingMail` words, kept word for word, drawn by `renderBookingEmail` and tagged `email_booking` or `email_reminder` |
| `src/links.ts` | The only links an email may carry: `appUrl` (an app path joined to the app's origin, no `.` segments, never `//`), `onAppOrigin` (the check the layout runs on every button, row link and preferences link: same origin, written as parsed), `appOrigin` (https, or http on localhost only) and `poweredByUrl` (timefix.ai with fixed UTM words; `utm_medium` from the closed `EMAIL_MEDIUMS` list) |
| `src/react-email.ts` | The one React Email import (lint's vendor rule) |
| `src/templates/` | One file per family of emails, each a pure `Template` |
| `scripts/preview.ts` | `pnpm --filter @crm/emails preview -- --port <port>`: every email with sample params, light, dark or text, on 127.0.0.1 |
| `scripts/brand.ts` | `pnpm --filter @crm/emails brand`: the footer's wordmarks in each theme's muted ink, written to `apps/web/public/brand/email/` (a test fails when they're stale) |

## Conventions

- No raw values: every colour, space, radius and type style comes from `src/tokens.ts` by token name. The literals that stay are email client needs, each commented where it sits: the 600px width, Outlook's `mso-*` properties and the dark stylesheet's `!important`.
- Node runs these files with no build step and type stripping has no JSX, so elements are made with `createElement`. Text people typed goes in as children, never as HTML, so React escapes it.
- Every link is an app path joined to the app's origin, or the Powered by link. A template never takes a whole address from its params, and the layout refuses any button, row link or preferences link off the app's origin. A link to another site (a meeting's video call) would need its own block type, reviewed on its own.
- A subject passes `headerText` (control characters and line separators become spaces, at most 200 characters, cut by code point), so a name can never add a header.
- Every email has a preheader, a plain text part and the footer's reason line. An optional email (a topic a member can turn off) must carry the preferences link.
- Layout is tables with `role="presentation"`, since Outlook on Windows draws with Word.

## Gotchas

- The footer's logo is served by the web app (`apps/web/public/brand/email/`), so locally it loads only while the app's origin answers. The preview serves it itself.
- Gmail ignores `prefers-color-scheme` and darkens an email its own way. Every pair holds its contrast in the light theme, and the wordmark is a mid grey, so the light email stays legible there.
- React Email's `Body` copies the body's style to an inner cell it gives no class, so the layout draws its own body and a classed wrapper table instead.

## Related specs

- [0001 Stack and architecture](../../docs/specs/0001-stack-architecture/index.md)
- [0002 Design tokens](../../docs/specs/0002-design-tokens/index.md)
- [0008 Background jobs](../../docs/specs/0008-background-jobs/index.md): sign in codes stay in their request
