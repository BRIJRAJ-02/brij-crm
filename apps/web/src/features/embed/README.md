# Embedded screens

Our own link page screens inside a partner's product, in a frame on the partner's site (spec 0070, slice 4,
AC-7030 to AC-7033). The partner's guide is `docs/partners/guide.md`.

## How a frame opens

1. The partner's server launches a screen (`POST /api/partner/v1/connections/{id}/launch`) and puts the answer's
   address in its frame: `/embed/<clientId>/start#code=…`. The code rides in the fragment, so no server log or Referer
   holds it, and the start page takes it out of the address first.
2. `/embed/$clientId/start` redeems the code once (`data.embed.start`). The server sets the frame's own session
   cookie (`Secure`, `SameSite=None`, `HttpOnly`, `Partitioned`), separate from the app's, so a person signed in to
   Timefix in the same browser keeps both apart. The page then checks the browser kept the cookie
   (`data.embed.session`) and opens the screen the launch named.
3. `/embed/$clientId/link-page` draws the app's own screens (the person's page, Team pages, a member's page) in
   `EmbeddedLayout`: the same shell without the sidebar or the workspace menu.

Every API call from the frame carries `x-crm-embed` (`EMBED_HEADER` in `paths.ts`, given to the data layer as
`callHeaders` in `main.tsx`), so the API reads the frame's cookie and holds the session to the link page procedures in
its own workspace. A picture the frame draws carries no header; the link page's picture routes fall back to the
frame's cookie when no app session is there.

## Screens

### EmbedStatus (`/embed/$clientId/start`)

- Purpose: the frame's own page while a screen opens, or when it can't.
- Main task: one line on what happened and the one way on: Open again (a fresh launch in the same frame), or Open in
  a new tab when the browser refused the frame's cookie.
- Leaves out: any link into Timefix itself. The way on is always a fresh launch from the partner's own app.

### The link page screens (`/embed/$clientId/link-page`)

- Purpose: the person's own link page, Team pages for someone who may manage them, and a member's page.
- Main task: the same as in the app (`features/link-page`), with their addresses kept inside the frame (`place.tsx`).
- Leaves out: everything outside Link pages. No block of another module (booking pages, forms, places), no link to
  Settings or the booking page editor, no sidebar, no workspace menu, no live socket.

## What the frame tells the partner

`messages.ts`, by `postMessage` to each of the partner's registered frame origins by name, never `*`:

- `{ type: 'timefix:height', height }` each time the page's height changes (`EmbedFrame`; the page is as tall as its
  content in a frame, the base layer's `[data-embedded]` rule).
- `{ type: 'timefix:relaunch', target: 'frame' | 'tab', reason }` from Open again or Open in a new tab. The button is
  busy for a few seconds; if the page is still here, one line says to open it again from the partner's app. A partner
  opening a tab must open it before any await (Safari forgets the press), as the guide and the sample hub do.
- A fresh launch put in the same frame differs from the start page only by its fragment: the start page reads the new
  code on `hashchange`.

## The look

`?theme=light|dark` from the launch is applied to this page only: in a frame the theme controller has no storage, so
it never becomes the person's own choice.
