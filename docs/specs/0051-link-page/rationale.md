# 0051. Rationale: where a link page's items live, and why the booking pages join them

## The ask

The owner, 24 October 2026: "let's plan this out and build it", forwarding Anish's thread.

> our main page should become just like link tree: linktr.ee/lento.ae … like this one timefix.com/anish … not only meetings but other links as well.

The use case Anish wrote out: a person turns on a QR code in their dashboard, the QR opens `www.timefix.com/<handle>`, and that page has their contact details a visitor can save as a vCard, a way to set up a meeting, and a link to their website. He added that people at events swap these pages, that LinkedIn and a direct WhatsApp are strong, and that after an event people want some context to remember who they met. He said plainly that he would rather the link page stayed separate from the booking page's widgets. Kunal confirmed a customer use case. The references the owner sent are linktr.ee/lento.ae, cal.com/iamsridhar, 02ui.com/hi, linktw.in, The Link Repo template, DropFolio and modul.so, plus the Linktree editor with its Active links, Collections, Archived links, Appearance and per link analytics.

## Context

`/<handle>` exists today and is close. It already resolves a handle to a person across every workspace (`crm_handle_owner`), already serves their picture from our own origin because the public pages' policy loads nothing from Google, already pages their Public booking pages through `crm_booking_profile_pages`, and already groups them under small headings the owner typed in each page's editor. Settings › Profile already orders them with drag, keyboard and a menu. What it cannot do is hold anything that is not a booking page.

Three forces pull on the design.

The first is tenancy. Every tenant table in this repo forces row level security and the app's role cannot bypass it. But a profile is not a workspace's. A person may be in a personal workspace and a work one, and the page they hand to someone at an event is theirs. If a workspace owned a link, leaving that workspace would take the person's LinkedIn with it, and a reader with no workspace in the request would have no scope to read it in.

The second is the policy on the public pages: `img-src 'self' data: blob:`. A link in bio page is mostly icons, and every other product in this space fetches favicons from the sites it links to. We cannot, unless we proxy them, and proxying them is a feature of its own.

The third is that `/b/:key` is frozen and the booking pages are shipped and working. Anish asked for the link page to stay separate from them, and that is also the cheaper call: nothing about a booking page has to change for a link page to exist.

## Options considered

### Option 1: one ordered item list per account, in schema `auth`, behind definers (chosen)

Items live in `auth.profile_items`, keyed by the owner's user id, written and read only through `crm_handle` functions, exactly as handles and bios are today. A booking page joins that list as an item holding a workspace id and a page id; whether a visitor sees it is still decided by the existing lookup and the door.

**Pros**: the profile's data sits where the profile already sits. Nothing crosses the tenant fence. One ordered list means one reorder, one drag, one keyboard move, and headings that can group whatever the owner wants, including two workspaces. The pattern (a narrow role, column grants, definers that answer as little as the caller needs) is already in the repo twice.

**Cons**: row level security is not the control for these tables, so the guard tests have to grow a different kind of check. Ten more definers for the security reviewer to look at. The public read joins two sources per page.

### Option 2: a per workspace table, one link list per workspace

Links live beside booking pages, in a tenant table with the standard policy, and the profile reads every workspace the person is in and merges.

**Pros**: every rule in `crm-data-model-access` applies with nothing new. The guard tests already cover it.

**Cons**: it is the wrong owner. Leaving a workspace deletes links that had nothing to do with it. A personal link in a work workspace is a leak waiting to happen, since colleagues with `booking.manage` could read and edit it. The public read becomes one transaction per workspace, and the order across workspaces has nowhere to live.

### Option 3: a json blob on `auth.public_profiles`

One column holding the whole list.

**Pros**: the smallest migration. No new definer. Reordering is a single write.

**Cons**: no per item id, so a press counter has nothing stable to count against, and no foreign key to a booking page. Two tabs editing at once lose each other's work. Limits and uniqueness become application rules with no database behind them. It would need replacing as soon as analytics arrived, which is slice 5 of this very spec.

### Option 4: widgets on the booking page instead of a separate page

Everything on `/b/:key` or `/<handle>/<slug>`, as blocks around the calendar.

**Pros**: no new page, no new ordering.

**Cons**: Anish asked against it, in those words, and the booking page is frozen. It also answers the wrong job: a person at an event is handing over themselves, not a meeting.

## Rationale

Option 1 follows from the first force. The profile is already an account level thing living in schema `auth`, and the moment a link is a person's rather than a workspace's, there is only one place it can sit. Putting it there is not a weakening of tenancy: schema `auth` holds the handles, the profiles and the picture preference today, and nothing in it is tenant data. The control there is the definer, not the policy, and this spec keeps that control strict: `crm_app` gets no grant on the tables, each function takes an owner and filters by it, and the api never passes an id but the session's own.

Folding the booking pages into the same list is what makes the feature cheap rather than a second ordering system. The alternative was to keep `booking_pages.profile_position` and interleave two sequences at read time, which means two places to move an item, two places to get the order wrong and a heading that can only ever name a booking page's section. One list also gives the `wip/profile-split` lane somewhere to land: that lane's rule, that a personal and a work workspace never share a section, becomes the backfill's starting headings instead of code, and after this the person can rename or merge those headings, which the lane alone could not offer.

The second force settles the icons without any argument: we draw nothing we do not serve. We already ship brand marks for nine social networks through `ProviderMark`, under the owner's 20 October exception, and we already know how to match a url to its network (`packages/contracts/src/values/social.ts` does it for the url field). Between those marks, the Lucide registry and a letter in the item's hue, every link gets a credible icon with no outside request and no change to the policy. The favicon proxy is written down as a follow up because it is a storage feature, not a link page feature.

Analytics reuse the operator console wholesale. Spec 0047 already decided how a visitor is counted in this product (a daily HMAC of the day, the address and the user agent, so nothing personal is stored and nobody can be followed across days), where the counts live, and when they are swept. Doing anything else here would mean two answers to the same question.

## Decisions taken on the owner's behalf

The owner delegates product and user experience calls (21 October 2026, "do it yourself"). These are the calls this spec made, each one the owner can reverse.

1. **There is nothing to turn on for the QR.** Anish wrote "a person turns on a QR code in their dashboard". A toggle guards nothing: the page is already public at a public address, so the QR is only a second way to type it. Home shows it as soon as a handle exists.
2. **The link page replaces the profile rather than sitting beside it.** `/<handle>` becomes the link page. A second address would split a person's identity in two and double the thing they have to keep current.
3. **A contact card is typed, never read from the CRM.** A visitor's vCard holds what the owner typed into one card. Reading a person's own record would mean choosing a workspace, and it would put workspace data on a public page for the first time. One card per profile, with a second named as a follow up.
4. **The vCard is served by the api, not built in the browser.** A plain link works with no script, works on every phone, and can itself be a QR code. A blob built in the page could not be scanned.
5. **A press counter is a beacon that may be lost.** Counting a press before the navigation would slow every link on the page. A lost press is a missing number, not a broken link.
6. **Archive, not soft delete.** Linktree's Archived is a real feature people use, and it is an explicit `archived_at` with its own list, not a filter smeared across every query. Delete is a real delete, behind a confirm.
7. **The preview is components, not an iframe.** The editor's preview reads the unsaved draft through the same public page components. An iframe would show only what is saved and would load a second origin.
8. **Sixty items, forty links.** Nobody hands out a page of a hundred rows. The cap keeps one read at one page size and keeps a reorder to one statement.
9. **Headings replace sections, and the page editor's Section control writes a heading.** One concept where there were two.
10. **No theme, no colours, no fonts in this spec.** The references show appearance editors on every one of these products. It is the most visible and the least urgent part, it is where the design system would get stretched, and it is named as the first follow up.
11. **Five slices, in that order.** Links first, because a link is the whole feature in one row; then the list; then the contact card, which is the event use case; then the QR, which is cheap; then the numbers, which only matter once there is something to count.
12. **No server rendering for the page's meta tags.** The page is handed over in person and by QR, not crawled. Named as a follow up rather than built, because it changes how the public bundle is served.

## Open for the owner

Worth a word from the owner, though nothing waits on it:

- **The address in the references is `timefix.com/anish`, and production is `www.timefix.com`.** Whichever is the brand domain, the QR has to carry the one that is printed on a badge. This spec uses whatever `publicBookingOrigin()` already resolves.
- **Whether the link page should be plan limited** once billing exists (for example, a free plan capped at five links). Nothing in this spec assumes a plan.
- **Whether a workspace admin should ever see a colleague's link page figures.** This spec says no, and the operator console gains nothing from it.

## Amendments, 25 October 2026: why the build moved to blocks

The owner approved the build on 25 October ("start building this as a functionality") and in the same thread asked for "more blocks" later, pointing at liinks.co and linktw.in. That changed one force above: the item list was no longer four kinds for good, it was the first four of many.

### Options considered for the amendment

- **Per kind columns, as first written.** Every column has a database type and a check. But each new block would add nullable columns that only one kind uses, and the table's checks would grow with every kind. Rejected: it makes the next spec (0052) a series of table changes.
- **One `data jsonb` per row, checked by a Zod union and again in the definer (chosen).** The shared columns stay real (owner, kind, place, archive, the booking page's workspace and page, because those are joined and indexed). A kind's own fields are one object, refused before every write if they don't match the kind. A new kind costs a schema, a renderer, an editor entry and one small migration that adds the word and replaces the check function.
- **A table per kind.** Clean types, but one ordered list across tables needs a second ordering table, and the public read becomes a union of every table. Rejected for the same reason Option 2 above was: two places to get the order wrong.

The chosen shape keeps the database's guarantees where they matter (one live contact card, one heading per text, a booking page once, a place per block) through expression and partial indexes over `data`, and leaves the per kind detail to the contract, where the editor and the server already share it.

### Why social links are not a block

The owner asked for social links on the booking pages first ("for bookings, add more options like adding social media"). They had to work on `/b/:key` and on the profile alike, so they became one set per person in their own table (spec 0053), and the link page draws that set as the row of icons under the bio, as Linktree and liinks.co do. A socials block would have been a second store for the same links, and a person would have had to keep two lists in step.

### Calls made during the build (owner delegated, 21 October)

Listed with their reasons in index.md, "Amendments, 25 October 2026". The ones worth the owner's eye: the workspace named headings from the backfill are public (amendment 8), and the owner's own views on the apex host count until the polish lane's owner preview fix lands (amendment 13).

### The owner's design boards, 25 October 2026

The boards (`Main`, `PublicLight`, `Share`, `Editor`, `AddItem` in the owner's project canvas) became readable again after phases 1c to 3 had shipped, so they are read here as the design, not as a suggestion. Three of their calls were worth weighing rather than copying.

- **One Add modal or a menu of modals.** The built editor has a menu of four, each opening its own Modal, which is the cheaper shape while there are four kinds. The board draws one Modal with the kinds as a radio group. With spec 0052 adding text, questions, a form and more, a menu would reach eight or ten entries, which is a menu people scan rather than read. One modal with the kinds in it also lets the Section select and the "How it will look" row be written once instead of four times. The board wins, and the registry's per kind `Editor` entry is what the modal hosts, so nothing about the registry changes.
- **Hidden switch or an Archived list.** An Archived list is the pattern the rest of the app uses, so it was the first text's choice. On a page whose whole point is a short ordered list, a second list at the bottom is a place rows go to be lost. A switch in the row, with the row staying where it is, says the same thing in one press and in one place. It costs the check that made `position` null while archived, which is a small migration and nothing else.
- **Whether a heading's switch should carry its rows.** Hiding only the heading is what the store does today, and it is what AC-5106 said. On a board where a heading is a card around its rows, one switch on the card that leaves the rows showing would be a lie. Each row keeps its own state, so turning the card back on restores exactly what was on before, which makes the switch safe to press.

The boards also settled the question amendment 8 left for the owner: the editor's own note says nobody visiting the page sees which workspace a page came from, so no heading is named after a workspace.

## References

Sources, no links fetched for this spec:

- Spec 0025 and spec 0028 (booking pages and the visitor's calendar), spec 0047 (the operator console's counting, the visitor HMAC and the sweeps), spec 0003 (the component library), spec 0012 (names and hues), spec 0031 (workspaces and members).
- The repo: `packages/core/src/access/door.ts` (`crm_handle_owner`, `enterBookingProfile`), `packages/core/src/booking/public.ts` (`readBookingProfile`, `countPageView`), `packages/db/migrations/0086_booking_handles.sql` (the `crm_handle` role and its definers), `packages/db/migrations/0092_operator_console.sql` (the view counting), `apps/api/src/analytics/visitor.ts`, `apps/web/src/public/booking/ProfilePage.tsx`, `apps/web/src/features/settings/ProfilePagesSection.tsx` and `profile-order.ts`, `packages/ui/src/atoms/ProviderMark/`, `packages/ui/src/atoms/QrCode/`, `packages/contracts/src/values/social.ts`, `apps/web/vercel.json` (the policy headers).
- The owner's references, read as pictures: linktr.ee/lento.ae, cal.com/iamsridhar, 02ui.com/hi, linktw.in, The Link Repo template, DropFolio (About, Projects, Experience, Writing, Store, and a CONNECT group holding Email and Book a call), modul.so, and the Linktree editor.
- RFC 6350 for vCard escaping and line folding. Named, not fetched.
