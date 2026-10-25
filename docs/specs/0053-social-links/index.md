# 0053. Social links for a person, on their booking pages and link page

**Date**: 2026-10-25
**Status**: Accepted (built on `wip/booking-socials` and merged into `land/r13` at 11bed491e, migration `0097_social_links`)

**Numbering**: 0053 taken by the spec lane `spec-blocks` on 25 October 2026 (0052 is the link page's more blocks, 0049 and 0050 are claimed by the planning chat). This spec owns AC-5301 to AC-5399. It documents what was built; the calls in it were crm-87's and the builder's, under the owner's 21 October delegation.

## Summary

A person keeps one set of social links (up to ten: nine networks plus a website), set once in Settings › Profile. Visitors see them as a quiet row of icons on that person's booking pages and under the bio on their link page at `/<handle>`. The set belongs to the person, not to a workspace, so leaving a workspace never takes their LinkedIn with it. Each booking page can hide the row, and team pages never show it.

This is its own spec, not an amendment to 0051, because it changes the booking page at `/b/:key` (spec 0025's surface, which 0051 promised not to touch) and the booking page editor, and it has its own store and history entry. The link page only draws it.

Reasoning and the options weighed: see [rationale.md](rationale.md). How to check it: [verify.md](verify.md).

## Requirements

**User stories**:

- As a host, I want to add my LinkedIn, X and website once, so every booking page and my link page show them.
- As a visitor about to book, I want to see who the host is and open their profile in one press.
- As a host, I want to hide my links on one booking page, such as an interview slot, without deleting them.

**Acceptance criteria**:

- **AC-5301**: A person keeps at most ten social links, at most one per network, from LinkedIn, X, Instagram, GitHub, Facebook, YouTube, TikTok, Threads, AngelList (Wellfound), and Website, in the order they choose. Any other network needs the owner's OK for its mark first.
- **AC-5302**: In Settings › Profile, a "Social links" section under "Public profile" lists each link as a row (the mark and network's name as its title, a field with the network's prefix and an example placeholder, and a menu inside the field with Move up, Move down and Remove). "Add social link" opens a Menu of the networks not used yet. The section saves with the page's SaveBar, as Handle and Bio do. An empty row left empty is dropped on save, never refused.
- **AC-5303**: A handle or a pasted link is stored as one canonical link by `checkSocialLink` (`@crm/contracts/social`), on the server and in the field. A network link must be a profile on that network with a handle the network allows ("That isn't a LinkedIn profile"); a link to another network is refused in its words ("That's a link to LinkedIn, not Instagram."). A website is `http` or `https`, at most 2,000 characters, with no credentials, and not on a known network.
- **AC-5304**: The booking page editor shows a "Social links" card to the page's owner: the marks, a "Show on this page" switch (on by default, `booking_pages.show_socials`), and "Edit social links", which opens the same editor in a Modal that saves to the person's set at once, shows the change at once, and puts it back on a refusal with Try again. It asks "Discard your changes?" before closing with changes. A colleague sees the switch read only with the reason; a team or collective page says why it shows none.
- **AC-5305**: A personal booking page with the switch on shows the row in the host rail (last in the host's identity block on wide screens, in the stacked header on a phone) and on the details step. The receipt, the guest page, the hosted form and team pages never show it. The link page shows it under the bio (spec 0051, AC-5109).
- **AC-5306**: Each link is a real `<a target="_blank" rel="me nofollow noopener noreferrer">` with a hit area of at least 32px, an accessible name like "LinkedIn, ada", and a tooltip on hover and focus ("LinkedIn · ada"). The tooltip loads off the first load. Marks come from our own origin through `ProviderMark`; the website uses the Lucide `link` icon drawn as a mark.
- **AC-5307**: The public reads answer ready to draw items, `socials: [{ network, href, label }]`, on `PublicBookingPage` (personal page, switch on) and `PublicProfile`. The label is the server's, so the public bundles import no parsing.
- **AC-5308**: A change to the set is written to the person's history as `member.profile_updated` with the field `socials` ("changed their social links"), the links before and after. The page switch writes no audit row, as other page settings do not (`updated_by` records it).
- **AC-5309**: `auth.social_links` is reachable only through `crm_save_social_links` and `crm_social_links_of`, both owned by `crm_handle` with a fixed `search_path`. `crm_app` holds only execute on them, and guard tests prove the owner, the hardening and the grants. Two saves for one person at once are serialised (an advisory lock in the definer), and the last one wins whole.
- **AC-5310**: No size budget rises. The store, the Settings section and the editor card load on demand; the public row reuses Button's own mark face.

## Decision

**Chosen option**: Option 1. One set per person in `auth.social_links`, written and read only through `crm_handle` definers, drawn by booking pages (per page switch) and the link page.

**Implementation skills**: the house skills `crm-data-model-access`, `crm-api-backend`, `crm-frontend-state` and `crm-design-system`; plus `zod` and `vitest`.

## Feature design

**Data model sketch** (migration `0097_social_links`):

| Object | Key | Notes |
|---|---|---|
| `auth.social_links` | (`user_id`, `network`) | `href` (text, http or https, at most 2,000), `position` (smallint 0 to 9, unique per person). `network` checked against the ten. Cascades with the account. Default privileges give it to `crm_identity`; `crm_handle` gets select, insert and delete. |
| `booking_pages.show_socials` | | boolean, default true. Only the page's owner changes it. |

**API surface**:

| Endpoint or procedure | Input | Output | Auth | Key errors |
|---|---|---|---|---|
| `profile.update` (exists, gains `socials`) | `socials?: SocialLink[]` | the profile with its links | session, own account | `CONFIG_INVALID` per field |
| `profile.get` (exists) | | gains `socials` | session, own account | |
| booking page update (exists, gains `showSocials`) | `showSocials?: boolean` | the page | session, page owner only | `FORBIDDEN` for a colleague |
| the public booking page read and `GET /api/public/handles/:handle` (exist) | | gain `socials` | public, limited as today | |

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| Public read | the links in order | `crm_social_links_of([owner])`, through `publicSocialsOf(tx, userId)` in core |
| Public read | each link's label | `describeLink` on the stored `href`, on the server |
| Public read | whether a booking page shows them | `booking_pages.show_socials`, and the page being personal |
| Settings and the editor card | the set | `profile.get`, read through the socials store guarded by the landed count |

**Key invariants**: at most one link per network and ten per person; every stored `href` is the canonical form `checkSocialLink` makes; team and collective pages never answer `socials`.

**Security model**: the person writes only their own set (the user id comes from the session). A workspace admin has no path to a colleague's links and sees the page switch read only. Visitors read the links only through the two public answers. Every link opens in a new tab with `noopener noreferrer`, and no outside image is fetched.

**Critical test scenarios**:
- Happy path: add LinkedIn by handle, X by a pasted link with `?s=20`, a website; reorder; reload keeps the order; the booking rail and `/<handle>` show the row, verifies AC-5301 to AC-5303, AC-5305.
- Failure case: an Instagram slot given a LinkedIn link is refused in words and the SaveBar blocks; a refused dialog save puts the old set back with Try again, verifies AC-5303, AC-5304.
- Auth: `crm_app` selecting from `auth.social_links` is refused; a colleague cannot flip another member's page switch, verifies AC-5309, AC-5304.

## Build plan

Built (all tasks done on `wip/booking-socials`): contracts and migration with guard tests (AC-5301, AC-5303, AC-5309); core and api, including the public answers (AC-5307, AC-5308); the data layer store, loaded on demand (AC-5304, AC-5310); the Settings section (AC-5302); the editor card and dialog (AC-5304); the public row on the rail, details step and link page (AC-5305, AC-5306).

## Consequences

- One set per person means a person can't show different links on different pages; the per page switch is the only control. That is the right default for a person's identity, and named as a follow up if teams ask for more.
- The page switch writes no audit row, so the History of a page doesn't say who hid the links; `updated_by` does.
- A new network is a contract change, a mark, and a migration to the check.
- The row has no loading reserve: most hosts have none, so on a phone the card under the header moves by one row for a host who has links.

## Follow-up

- More networks (WhatsApp, Telegram, Discord, Dribbble, Behance, Medium, Substack): each needs the owner's OK for its brand mark.
- Per page choice of which links show, if hosts ask for it.

## Rationale

The context, the options and the reasoning are in [rationale.md](rationale.md).
