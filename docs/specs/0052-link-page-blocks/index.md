# 0052. More blocks for the link page

**Date**: 2026-10-25
**Status**: Proposed

**Numbering**: 0052 taken by the spec lane `spec-blocks` on 25 October 2026. 0049 and 0050 are claimed by the planning chat, 0051 is the link page, 0053 is social links. This spec owns AC-5201 to AC-5299.

## Summary

Spec [0051](../0051-link-page/index.md) made the page at `/<handle>` an ordered list of blocks, each one a `kind` with its own fields in a checked `data` column, plugged in through one registry. It shipped four kinds: a link, a booking page, a contact card and a heading. This spec adds the next ones, so the page can say something in the person's own words and can take an answer back, not only send a visitor away.

Six kinds are specified: **text**, **FAQ**, **a Timefix form**, **a testimonial**, **a photo**, and **media** (a video or a track). They are not all built at once. The first slice is text, FAQ and the Timefix form, which are the three that change Anish's page most and need nothing new from the public page's security policy. A testimonial follows. A photo waits on file storage (issue #32). Media waits on a decision of its own, because every way of showing a video from another company either puts that company's frame on our page or does not show the video at all, and that is the owner's call to make, not ours.

The security rule that runs through the whole spec is one sentence: **no block changes the public pages' Content Security Policy.** Everything a visitor loads comes from our own origin, and anything that cannot come from our own origin is not built yet.

Reasoning, the options weighed and the references: see [rationale.md](rationale.md). How to check it: [verify.md](verify.md).

## Requirements

**User stories**:

- As a person handing out my page, I want a few lines in my own words at the top, so a visitor knows who I am before they pick a row.
- As a person people book time with, I want the questions I answer every day written on the page, so a visitor stops asking them in the first message.
- As a person who already has a Timefix form, I want it on my page as a row people press, so an enquiry lands where every other enquiry lands.
- As a person collecting email addresses, I want a one field signup on my page that puts the address somewhere I already look, not in a new place I have to remember.
- As a person who does client work, I want one line from a happy client on the page, so a visitor has a reason to trust the booking row above it.
- As a visitor, I want the page to stay fast and quiet, so I find the one row I came for.
- As the owner of a page, I want to add a block the same way I add every other block, so there is nothing new to learn each time a kind arrives.

**Acceptance criteria**

*How a kind is added at all*

- **AC-5201**: A new kind plugs into the five places spec 0051's registry already names, and nowhere else: a Zod schema in the `ProfileBlock` union and a reading in `PublicProfileItem` (`@crm/contracts`), a renderer in `LinkPage`'s `RENDERERS` (`@crm/ui`), an entry in `BLOCK_KINDS` (`apps/web/src/features/link-page/registry.tsx`) with its label, line, icon, editor and whether Edit is offered, a mapping in `blocksOf` (`apps/web/src/public/booking/link-page.ts`), and one migration that adds the word to `profile_items_kind` and replaces `crm_check_profile_item`. A kind that needs a sixth place is a sign the registry is wrong, and the registry is fixed rather than worked around.
- **AC-5202**: A read that meets a kind it does not know still skips that block and draws the rest, in both readings, as AC-5101 says. A guard test proves it with a row whose `kind` no build in the repo knows.
- **AC-5203**: `data` may hold at most 16 KB (raised from 4 KB, since a FAQ holds ten questions and their answers). Each kind's own field limits, not the 16 KB, are what a person meets in practice, and each is refused in words that name the limit.
- **AC-5204**: Every one of these kinds is added, edited and placed through the one Add item modal and the section cards spec 0051's AC-5117 and AC-5136 describe. No kind gets a screen or a flow of its own.

*Text*

- **AC-5205**: A `text` block holds `{ title?, body }`. The title is 0 to 60 characters on one line. The body is 1 to 1,000 characters of plain text, with at most 20 line breaks and no other control character. There is no markup at all: no bold, no italic, no inline link. A person who wants a link adds a link block.
- **AC-5206**: The page draws a text block as the person's words, not as a row: the title as a small heading when there is one, the body under it with its line breaks kept, in the page's reading measure, left aligned, with no border and no press target. It is drawn as text, never as markup, so nothing in it can become an element.
- **AC-5207**: A text block records no press and shows no press chip in the editor, because it has nowhere to go. Its editor row reads "Text" with the body's first line after it.
- **AC-5208**: At most 5 text blocks live on one page. The 6th is refused with `LIMIT_REACHED` and the sentence naming the limit, and the Add modal disables the kind with the same sentence.

*FAQ*

- **AC-5209**: A `faq` block holds `{ title?, items }`. The title is 0 to 60 characters and defaults to "Questions". `items` is 1 to 10 entries of `{ question, answer }`, the question 1 to 120 characters on one line, the answer 1 to 600 characters of plain text with at most 10 line breaks. Two questions with the same text, ignoring case and surrounding spaces, are refused with `CONFIG_INVALID` and "You already asked that one."
- **AC-5210**: The page draws a FAQ as the library's disclosure list: every question is a button with `aria-expanded`, the answer is the region it controls, every question starts closed so the page stays short, and the whole list works from the keyboard in the order it reads. Opening a question moves nothing above it.
- **AC-5211**: Opening a question counts nothing. The block records no press and shows no press chip, for the same reason a text block does not.
- **AC-5212**: At most 2 FAQ blocks live on one page, and at most 10 questions in each. The editor's FAQ editor adds a question with a plus, moves one with the arrows on its grip, and removes one with its row menu, and it refuses the 11th in words.

*A Timefix form*

- **AC-5213**: A `form` block names one of the person's own hosted forms (spec [0023](../0023-forms/index.md)) by its workspace and its id. Like a booking page block, those two are real columns, `workspace_id` and a new `form_id`, not fields in `data`, so the foreign key is real and a deleted form cannot leave a block pointing at nothing. `data` holds `{ label? }` only: the words the row shows, 1 to 60 characters, defaulting to the form's own name.
- **AC-5214**: The form's own rules decide whether a visitor sees the block, exactly as a booking page block works: a form that is not published, is deleted, or whose owner has left that workspace is skipped by the public read and its block stays, so publishing the form again puts it back where it was.
- **AC-5215**: The block draws as a row with the form's name, its one line description and a quiet arrow, and it opens `/f/:key` in the same tab. That is our own origin, so it is an ordinary navigation: no frame, no new policy, no script from anywhere else. A form shown inside the page is a follow up, not this spec.
- **AC-5216**: A press on the row is counted exactly as a press on any other block is (AC-5125), and the editor shows its press chip.
- **AC-5217**: Email signup is not a kind of its own. "Email signup" is an entry in the Add modal that makes a hosted form with one email field and the person's own words above it, in a workspace they pick, and then adds a `form` block pointing at it. The addresses land in that form's responses, where every other capture on Timefix already lands, and the person's existing routing, notifications and export work on them unchanged. The modal says where the addresses will go before it makes anything.
- **AC-5218**: At most 3 form blocks live on one page, and a form may be placed once; a second block for the same form is refused with the same sentence a repeated booking page gets.

*A testimonial*

- **AC-5219**: A `testimonial` block holds `{ quote, author, role? }`: the quote 1 to 400 characters of plain text with at most 6 line breaks, the author 1 to 80 characters on one line, the role 0 to 80. There is no photo and no logo in it, because the page loads no picture from another origin (AC-5222) and a person's face would need the file storage that is not built yet. At most 6 live on one page.
- **AC-5220**: The page draws a testimonial as a quiet quote: the quote in the reading measure, the author and their role under it in the muted colour, with no border, no quotation mark graphic and no press target. It records no press.

*A photo, and media*

- **AC-5221**: A `photo` block and a `media` block (a video or a track) are specified here but not built here. A photo waits on file storage (issue #32), since a picture on the page must be served from our own origin and there is nowhere to keep one today. Media waits on the embed decision below, which is the owner's. Their shapes, for when they are built: a photo is `{ assetId, alt, caption?, ratio }` with `alt` required, 1 to 200 characters, and the picture served by our api from our own origin; media is `{ service, url, title, thumbnailAssetId? }` where `service` is one of a small list the owner has approved marks for.

*The security model*

- **AC-5222**: No block adds an origin to any directive of the public pages' Content Security Policy. On `/<handle>` that policy is `default-src 'self'`, `script-src 'self'`, `img-src 'self' data: blob:`, `connect-src 'self'` plus the realtime host, `object-src 'none'`, and no `frame-src` at all, which means no frame from anywhere else can load. A change to any of those lines is a decision of its own, written down before it is made, never a line slipped into `apps/web/vercel.json` with a block.
- **AC-5223**: Every picture a visitor sees comes from our own origin. A picture from somewhere else reaches the page only after our api has fetched it, checked its type and size, and served it itself, which is the pattern `apps/api/src/public/picture.ts` already uses for a Google profile picture. Until file storage (issue #32) gives that cache a home, no block shows a picture from anywhere else at all.
- **AC-5224**: Every word a visitor reads from a block is drawn as text, never as markup, in every kind. No block stores HTML, and no block has a sanitiser, because there is nothing to sanitise. A block's text is refused on the way in by its Zod schema and again by `crm_check_profile_item`, and every control character, U+2028 and U+2029 included, is refused in every field of every kind.
- **AC-5225**: Every block's write goes through the same `crm_handle` definers spec 0051 built, with no new grant to `crm_app` and no new table. A guard test proves that `crm_app` still cannot select from `auth.profile_items` directly and that the new `form_id` column is reachable only through those definers.
- **AC-5226**: A form block's public reading answers the form's name, its description and its `/f/:key` address, and nothing else: no workspace id, no form id, no field list and no response count. The same rule a booking page block follows.

*Keeping the page fast and findable*

- **AC-5227**: The three kinds in slice 1 together add at most 3 kB gzipped to `/<handle>`'s first load, measured by `pnpm size`. The FAQ uses the library's existing disclosure rather than a new one, and a kind's editor loads with the editor, never with the public page.
- **AC-5228**: The search on the page (AC-5133) looks at titles only for these kinds: a text block matches on its title, a FAQ on its title and its questions, a testimonial on its author. It does not search bodies or answers, because a row that matched on words a visitor cannot see in it is a result that makes no sense.
- **AC-5229**: The editor's preview draws every one of these kinds from the unsaved draft, the same as the four before them, so a person sees their words on the page before they save.

## Decision

**Chosen option**: build on spec 0051's registry unchanged, add kinds in the order text, FAQ, form, testimonial, and keep the public pages' policy exactly as it is by only building kinds whose content comes from our own origin. The first slice is text, FAQ and the Timefix form.

**What this rests on**:

- **The registry** spec 0051 built: a Zod union on `kind`, a renderer per kind, one editor entry per kind, one public mapping, one line of migration. Nothing here needs a new table.
- **Hosted forms** (spec [0023](../0023-forms/index.md)): the form block points at a form that already exists, with its own public page at `/f/:key` on our origin, its own publishing rules, its own responses and its own routing. Email signup rides on that rather than inventing a store.
- **The public pages' policy**, which spec 0051's AC-5110 and spec 0025 both already lean on.

**Implementation skills**: the house skills `crm-data-model-access` (the one new column and the definers), `crm-api-backend` (the public reading and the limits), `crm-frontend-state` (the editor through the one data layer) and `crm-design-system` (every block's drawing); plus `zod`, `drizzle`, `vitest`, `security-and-hardening` and `playwright-cli`.

## Feature design

**Data model**: one new column and one replaced check function. No new table.

| Object | Change | Notes |
|---|---|---|
| `auth.profile_items.form_id` | new, nullable `uuid` | Set only for `kind = 'form'`, always together with `workspace_id`, mirroring `page_id`. Unique (`user_id`, `workspace_id`, `form_id`) where `kind = 'form'` and `archived_at is null`, so one form is placed once. Checked by the same per kind check that keeps a `page` from having a `form_id`. |
| `auth.profile_items.data` | cap raised | 4 KB to 16 KB (AC-5203). |
| `profile_items_kind` | words added | `text`, `faq`, `form`, `testimonial` in slice 1 and 2; `photo` and `media` when they are built. |
| `crm_check_profile_item` | replaced | Gains each new kind's keys and value rules, matching the Zod schema key for key. A test per kind proves the two agree, as spec 0051's Consequences asks. |

**The fields each kind keeps in `data`** (the Zod schema is the one definition; this is what it says in words):

| Kind | `data` | Real columns |
|---|---|---|
| `text` | `{ title?: string(0..60, one line), body: string(1..1000, at most 20 line breaks) }` | none |
| `faq` | `{ title?: string(0..60), items: Array<{ question: string(1..120, one line), answer: string(1..600, at most 10 line breaks) }>(1..10) }` | none |
| `form` | `{ label?: string(1..60) }` | `workspace_id`, `form_id` |
| `testimonial` | `{ quote: string(1..400, at most 6 line breaks), author: string(1..80, one line), role?: string(0..80, one line) }` | none |
| `photo` (later) | `{ assetId: Uuid, alt: string(1..200), caption?: string(0..160), ratio: 'square' \| 'wide' \| 'tall' }` | none |
| `media` (later) | `{ service: enum, url: string, title: string(1..80), thumbnailAssetId?: Uuid }` | none |

Every string is trimmed, refuses every control character including U+2028 and U+2029, and is drawn as text (AC-5224).

**The limits, beside spec 0051's** (AC-5102 still caps a page at 60 blocks):

| Kind | At most |
|---|---|
| `text` | 5 |
| `faq` | 2, with 10 questions in each |
| `form` | 3, each form placed once |
| `testimonial` | 6 |

**API surface**: nothing new. The writes go through the procedures spec 0051 built (`linkPage.add`, `linkPage.edit`, `linkPage.move`, `linkPage.setShown`, `linkPage.remove`) with a wider `ProfileBlock`, and the public reading is the same `GET /api/public/handles/:handle` with more shapes in `PublicProfileItem`. One read is new in the editor only: the person's published forms, across their workspaces, for the Add modal to choose from, which is the form sibling of `linkPage.pageChoices` and answers the same facts (name, description, workspace name, published or not).

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| Public read, a form block | the form's name and description | the form row in its workspace, read the way a booking page block's facts are read |
| Public read, a form block | its `/f/:key` address | the form's `publicKey`, joined on the public origin by the server |
| Public read, every kind | every word | `data`, parsed by the union, drawn as text |
| Editor, the Add modal | the forms a person may place | the new form choices read, their own published forms only |
| Email signup | where the addresses go | the form it makes, in the workspace the person picked, shown in the modal before it is made |

**Key invariants**:

- A block never carries a workspace id, a form id, a member id or an email into a public answer.
- A form is placed at most once per person, and a form block with no readable form is skipped by the public read, never shown broken.
- No kind's content comes from an origin other than ours.
- The Zod schema and `crm_check_profile_item` agree, key for key, for every kind.

**Security model**: the whole of it is AC-5222 to AC-5226. In short: the policy on `/<handle>`, `/b/:key` and `/f/:key` is not touched by this spec; pictures come only from our origin; words are drawn as text, never markup; the writes use the definers spec 0051 built with no new grant; and the public answers carry facts, never ids.

**The embed question, written down and left open**: a video or a track from YouTube, Vimeo, Loom, Spotify or Apple Music can reach a visitor three ways, and every one of them is a trade the owner should make, not us.

1. **The company's own frame**, with or without a click to load cover. Either way the page ends up with `frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com` on `/<handle>`. A click to load cover means the frame loads only after the visitor asks for it, so nothing reaches those companies until then, but the directive is still in the policy from the first byte. This is the only way the video plays in the page.
2. **A thumbnail that links out.** Our api fetches the oEmbed thumbnail once, keeps it (which needs issue #32) and serves it from our origin. The block is a row with a picture on it, and pressing it opens the video on the company's own site in a new tab. The policy does not change at all, and no visitor is known to anyone until they press.
3. **A row with no picture**, which is what a link block already is, so it is not worth a kind.

**Configuration required**: none. No new environment variable, no new credential, no new dependency. A photo block, when it is built, needs the R2 bucket from issue #32.

**Critical test scenarios**:

- Happy path: add a text block, a FAQ with three questions and a form block; open `/<handle>` and read all three in the editor's order; press the form row and land on `/f/:key`, verifies AC-5205 to AC-5216.
- Failure case: a FAQ with the same question twice is refused in words; a 1,001 character body is refused naming the limit; a form that was unpublished is skipped by the public read and its block stays in the editor, verifies AC-5209, AC-5205, AC-5214.
- Security: a body with `<script>` in it reads as those characters on the page and stores as those characters; a row whose `kind` is a word no build knows is skipped by both readings; `curl -i /<handle>` shows a policy byte for byte the same as before this spec; `crm_app` selecting from `auth.profile_items` is still refused, verifies AC-5202, AC-5222, AC-5224, AC-5225.
- Budget: `pnpm size` shows `/<handle>` up by at most 3 kB gzipped, verifies AC-5227.

## Build plan

Tracer Bullet, as the repo builds: each slice is one thin thread through contracts, the database check, core, the public read, the library renderer and the editor entry, and each one ships.

**Slice 1: text, FAQ and the Timefix form** (AC-5201 to AC-5218, AC-5222 to AC-5229, apart from AC-5217)

This is the slice chosen for "ship less but ship quality". The three kinds in it are the three that change `timefix.com/anish` most, and not one of them needs a byte of new policy, a new store or a picture from anywhere.

1. Contracts: `ProfileTextBlock`, `ProfileFaqBlock`, `ProfileFormBlock` in the union, their readings in `PublicProfileItem`, their limits beside the others. Tests for every refusal sentence.
2. Migration: the three words in `profile_items_kind`, the `form_id` column with its unique index and its per kind check, the raised `data` cap, and the replaced `crm_check_profile_item`. A test per kind that the check and the schema agree.
3. Core and api: the per kind writes through the existing definers, the form facts read, the public mapping, the editor's form choices read.
4. The library: a `TextBlock`, an `FaqBlock` on the existing disclosure, and a `FormBlock` row, in `RENDERERS`, with their stories and their screenshots.
5. The editor: three entries in `BLOCK_KINDS` with their editors, the FAQ editor's add, move and remove, the form chooser, and the preview drawing all three from the draft.
6. Walks: the three happy path flows and the three refusals in a real browser, then the design gate, two critique rounds and screenshots, as the 25 October bar asks.

**Slice 2: a testimonial, and email signup** (AC-5219, AC-5220, AC-5217)

A testimonial is slice 1's pattern with one more schema. Email signup is the only new behaviour in this spec: the Add modal makes a one field hosted form in a workspace the person picks, says where the addresses will go, and then adds a form block for it.

**Slice 3: a photo** (AC-5221, the photo half)

Waits on file storage (issue #32). When that lands: upload, our own origin, `alt` required, and the same drawing rules.

**Slice 4: media**

Waits on the embed decision above, which gets a spec of its own once the owner has made the call. Nothing in slices 1 to 3 depends on it.

## Consequences

- The page can now hold words, not only destinations. That is the biggest change to how it reads, and it is also the first time a person can write something long enough to be badly written; the editor's preview is what keeps that honest.
- Email signup riding on hosted forms means no new store, no new export, no new notification and no new place to look. It also means a person who wants only an email box has to have a workspace, which every Timefix account does.
- `form_id` is the second real column that points at a tenant thing from a personal table. The pattern is now deliberate rather than accidental, and a third one should make us ask whether a `target` pair would be better than a column per kind.
- The 16 KB cap on `data` is twelve times what a block needs. It is a ceiling, not a target, and the per kind limits are what people meet.
- Four more kinds means four more pairs of rules to keep in step between Zod and `crm_check_profile_item`. The test per kind is the only thing that keeps that true.
- Every kind here is drawn as text or points at our own origin, so the public pages' policy survives this spec untouched. The first kind that cannot say that is the one that has to stop and ask.

## Follow-up

Named, not built here:

- **The embed decision**, with the three options written above, and a spec of its own once the owner has chosen.
- **A form shown inside the page** rather than opened at `/f/:key`, which needs the form runtime on the public bundle and is a size question before it is anything else.
- **Favicons and thumbnails** through our own origin, once issue #32 lands, which also unblocks the photo block and option 2 of the embed decision.
- **A gallery** of several photos in one block, which Linktree and Bento both have and which is only worth it after one photo works.
- **A link in a text block**, if people ask for it. It is left out on purpose: the moment text carries a link, the page needs a mark up language and something to sanitise.
- **Folders and tabs** (liinks.co), which group blocks into pages rather than adding a kind, and belong with the appearance work in phase 5.

## Rationale

The context, the options weighed and the references are in [rationale.md](rationale.md).
