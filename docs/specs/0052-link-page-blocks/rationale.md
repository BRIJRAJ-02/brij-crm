# 0052. More blocks for the link page: the reasoning

## Context

The owner asked for this in one line on 25 October 2026: "will later also need blocks. more blocks", right after approving the link page itself, and pointed at liinks.co and linktw.in as what they had in mind. In the same thread: "It's all for this: https://timefix.com/anish", and "make our designs better ... ship less but ship quality ... functionality".

Spec 0051 was built with that coming. Its blocks model (`kind` plus a checked `data` column plus one registry) exists so that a new kind costs a schema, a renderer, an editor entry, a public mapping and one line of migration, and nothing else. So this spec is not an architecture question. It is three narrower questions:

1. Which kinds are worth building, and in what order?
2. What does each one keep, and where?
3. What happens when a kind wants something from another company's servers, given that the public pages load nothing from anywhere but us?

Three forces shape the answers.

**The page already works.** `timefix.com/anish` today is a person's card, a row of social icons, booking pages and links. Nothing on it is broken. So every block added has to earn its place against the cost of making the page longer, which is the one thing a link in bio page cannot afford.

**The policy is tight on purpose.** `/<handle>` is served with `default-src 'self'`, `img-src 'self' data: blob:`, `object-src 'none'` and no `frame-src` at all. The booking page `/b/:key` is the same. That was not an accident: it is what lets us say that a person's public page tells nobody else that you visited it. Loosening it is a product decision with a privacy cost, not a configuration change.

**There is no file storage yet.** Issue #32 (Cloudflare R2) is not built. Our api already proxies one outside picture, a Google profile picture, by fetching it and serving it itself, but there is nowhere to keep one. So any kind that shows a picture is blocked on #32, whatever else is true about it.

## Options considered

### Which kinds, and in what order

The candidates, from liinks.co, linktw.in, Linktree, Bento and our own product: text, photo, video and music embeds, FAQ, testimonials, folders and tabs, a Timefix form, email capture.

- **Build the lot in one spec and one lane.** It is one registry and one pattern, so the marginal cost per kind after the first is small. Rejected: the owner's words were "ship less but ship quality", and eight kinds means eight renderers at a design bar nobody would hold for the eighth. It also forces the embed decision immediately, which is the one thing here that should be slow.
- **Build the most asked for kinds first**, which in every reference means the video embed, because that is what Linktree's own marketing leads with. Rejected: the video embed is the one kind that cannot be built without changing the public pages' policy or building file storage first, so leading with it means the slice ships last.
- **Build the kinds that change Anish's page most and need nothing new (chosen).** Text, FAQ and a Timefix form. Text is what makes the page read as a person rather than a list of buttons, and it is the cheapest kind in the spec. FAQ answers the questions that stand between a visitor and a booking, which is the point of the whole page, and it is text with a disclosure around it. The form block is the one block only we can offer: the person's own hosted form, on our origin, with the responses landing where their other captures already land. The three together are one slice, one design pass and no new security surface.

A testimonial came close to the first slice and lost to the form block, because a testimonial without a face or a logo is a quieter thing than the references make it look, and the form block is the one that makes the page do work.

### Where a block's fields live

Settled by spec 0051: `data jsonb`, checked by a Zod union and again by `crm_check_profile_item`. The only open part was the form block's pointer at a form.

- **`formId` inside `data`.** No migration beyond the kind word. Rejected: there is no foreign key, so a deleted form leaves a block pointing at nothing, and the "one form placed once" rule needs an expression index over JSON rather than a plain one.
- **A real `form_id` column beside `workspace_id` (chosen).** It mirrors `page_id` exactly, which is the pattern a reader of this table already knows; the foreign key and the unique index are ordinary ones; and the per kind check keeps a `page` from carrying a `form_id` and the other way round. The cost is one more nullable column on a table that now has two of them, which the Consequences names as the thing to watch.

### What a text block may contain

- **Rich text with inline links, bold and italic.** What every reference offers. Rejected for now: the moment text carries marks, the page needs a mark up format, a store for it, a renderer that is careful and something to sanitise, and that is the whole class of bug this page has avoided so far by drawing everything as text. One thousand characters of plain text says what a person needs to say on a page whose rows are the point.
- **Plain text with line breaks (chosen).** No markup, nothing to sanitise, one Zod rule, and a person who wants a link adds a link block, which is the thing the page is best at. Written in Follow-up as the first thing to revisit if people ask.

### Email capture

- **A new store and a new screen**: a list of addresses on the person's account. Rejected: it is a second inbox, with its own export, its own notifications and its own place to forget to look.
- **A row on the CRM**, writing each address straight into a workspace's records. Rejected: the link page belongs to the person and crosses every workspace they are in, so a block that writes into one workspace's records quietly makes a personal page into a workspace tool, and the access question that follows is not small.
- **A hosted form with one field (chosen).** Forms already exist (spec 0023), already live on our origin at `/f/:key`, already have publishing rules, routing, notifications, responses and export, and already answer the access question. Email signup becomes an entry in the Add modal that makes such a form and places a block for it, and the modal says where the addresses will go before it makes anything. One less store, one less screen, and the person's existing habits work on the result.

### Showing media from another company

This is the question the spec deliberately does not answer. The three options are written out in index.md under "The embed question". The reason it stays open is that every option trades something only the owner can trade.

Option 1, the company's own frame, is the only one where the video plays on the page, and it is also the only one that puts `frame-src https://www.youtube-nocookie.com …` into the policy of a page we have been telling people loads nothing from anywhere else. A click to load cover stops the request until a visitor asks for it, which is most of the privacy benefit, but the directive is still there from the first byte and the promise is weaker than it was.

Option 2, a thumbnail that links out, keeps the policy exactly as it is and tells nobody anything until a press. It needs issue #32 to hold the thumbnail, it needs oEmbed fetched by our api rather than the browser, and the video does not play on the page.

Option 3, a plain row, is a link block, so it needs no kind at all.

Our recommendation, written here so the owner has something to react to rather than a blank question: option 2. A link in bio page is a page of rows that people press, not a page they watch, and keeping "this page loads nothing from anyone else" true is worth more than a video playing in place. It also arrives naturally with issue #32, which the photo block needs anyway. But it is the owner's call, and so are the brand marks each service's row would carry.

## Rationale

The spec is short on new mechanism on purpose. Spec 0051 paid the cost of the blocks model precisely so that this spec would be a list of schemas, renderers and limits, and the test of whether that model was right is whether this spec needs anything from it that is not already there. It needs one column, one raised cap and four words in a check constraint. That is the model working.

The first slice was chosen the way the owner asked for it to be chosen. "Ship less but ship quality" rules out eight kinds in one pass; "It's all for this: timefix.com/anish" says to measure each candidate against one real page; and "functionality" says to prefer the block that makes the page do something over the block that makes it look fuller. Text, FAQ and a form block is what falls out of those three, and the thing they have in common, that none of them needs a byte of new security surface, is what makes the slice shippable in one go rather than blocked behind a decision.

The security rule, "no block changes the policy", is written as an acceptance criterion rather than a principle because a principle in a spec is a thing a builder can reasonably decide does not apply to their case at two in the morning. As AC-5222 it is a line in a test, and the test is the one that fails if anyone adds an origin to `apps/web/vercel.json` while adding a block.

Drawing every word as text rather than markup is the same trick: there is no sanitiser in this spec because there is nothing in it that could carry markup. That is cheaper than a sanitiser and it cannot be got wrong later, which a sanitiser can.

## Open questions for the owner

Nothing waits on these. They are the ones that are genuinely the owner's.

- **The embed decision** above: whether a video should play on the page, at the cost of naming YouTube, Vimeo and Loom in the public page's policy, or whether a thumbnail that links out is enough. We recommend the thumbnail.
- **The brand marks** a media block would carry: YouTube, Vimeo, Loom, Spotify, Apple Music, YouTube Music. The house rule is that a brand mark beside the Lucide set needs the owner's word, and the 20 October exception list does not cover these.
- **The foot on the public page**, "Powered by timefix" with "Claim your free page": whether a paid plan removes it. That is a money question, and this spec takes no position beyond drawing what the owner's board draws.

## References

Sources, no links fetched for this spec:

- Spec [0051](../0051-link-page/index.md), the link page and its blocks model, its registry and its policy rules; spec [0023](../0023-forms/index.md), hosted forms at `/f/:key`; spec [0025](../0025-booking-pages/index.md), the public booking page's policy; spec [0047](../0047-operator-console/index.md), the daily visitor HMAC the counters use.
- The code the registry lives in, read while writing this: `packages/contracts/src/booking/link-page.ts` (the `ProfileBlock` union and `PublicProfileItem`), `apps/web/src/features/link-page/registry.tsx` (`BLOCK_KINDS`), `apps/web/src/public/booking/link-page.ts` (`blocksOf`), `apps/api/src/public/picture.ts` (the one outside picture we proxy), and `apps/web/vercel.json` (the policies quoted in AC-5222).
- The owner's design boards for the link page, in their project canvas: `Main`, `PublicLight`, `Share`, `Editor`, `AddItem`.
- Products named by the owner and studied for their block sets, not fetched: liinks.co (text, photo and video, music, FAQ, testimonials, folders and tabs), linktw.in (the visitor picks their own music service), Linktree (the block catalogue and the appearance tab), Bento (grid blocks), Cal.com (a profile of booking pages).
- Mobbin, searched for link in bio and block editors: Buffer's Start Page editor (a layout list of blocks with an Add Block rail beside it), Dribbble's "Insert block" sheet (blocks grouped Basic and Rich media), Klaviyo's split of editor and live preview, Meetup's social links form.
