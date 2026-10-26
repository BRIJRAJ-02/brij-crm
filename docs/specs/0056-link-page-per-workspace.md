# 0056. One link page per workspace

**Date**: 2026-10-26
**Status**: Proposed

**Numbering**: 0056 taken on 26 October 2026 (0052 to 0055 are claimed on other branches). This spec owns AC-5601 to AC-5699. It amends [0051](0051-link-page/index.md) (the link page) and the handles of migration 0086; where they disagree, this spec wins.

## Summary

Today a person has one handle and one link page at `/<handle>`, and the page may hold booking pages and forms from every workspace they belong to. The owner decided on 26 October 2026 that cross workspace must never work: a link page belongs to ONE workspace and holds only that workspace's booking pages, forms and meeting links. To keep one address per page, a handle stops belonging to the person and belongs to the person's membership in one workspace. A person in three workspaces can have up to three handles and three link pages, each its own.

The same rule applies to any address that points at one of our own public pages: a link block on a link page, and the redirect link of a form or a routing rule, may not point at a booking page, form or handle of another workspace.

Reasoning and the calls taken on the owner's behalf: [0056 rationale](#rationale) at the end of this file. The data is new (the link page shipped days ago), so old cross workspace blocks are deleted, not carried.

## Requirements

**User stories**

- As a person in two workspaces, I want a separate link page for each, so a visitor to my work page never sees my other company's meetings.
- As an admin, I want to know that nothing on a link page of ours can send a visitor to another workspace's booking pages or forms.
- As a visitor, I want a link on a page to open what it says, never a page of some other company.

**Acceptance criteria**

*Handles and the page's owner*

- **AC-5601**: A handle names one membership: a person in one workspace. `auth.public_handles` gains `workspace_id` (not null) and `auth.public_profiles` is keyed by (`user_id`, `workspace_id`) with its own `handle` and `bio`. A handle is still unique across every workspace and an old one still finds its page (it follows to the current handle of the same membership). A person holds at most one current handle per workspace, and at most 20 handles in all (the existing limit).
- **AC-5602**: Claiming a handle is done in Settings › Profile of the workspace you are in, and is that workspace's handle. A person with no handle in this workspace sees the claim note there, and the Add menu stays off until they claim one, exactly as AC-5120 says today.
- **AC-5603**: A handle stops working when its person leaves the workspace or is removed from it: `/<handle>` is the existing not found page, word for word, and nothing about the workspace is revealed. The handle stays reserved to the person (never freed to someone else), and works again if they rejoin.

*One workspace per link page*

- **AC-5604**: Every item on a link page belongs to the page's workspace. `auth.profile_items` gains `workspace_id` (not null) for every kind (`link`, `page`, `form`, `heading`, `contact`, and every other kind in the table). The profile is read and written by (`user_id`, `workspace_id`) and the order is per (`user_id`, `workspace_id`).
- **AC-5605**: A `page` item names a booking page, and a `form` item names a form, that exists in the item's own workspace. Writing one that does not (another workspace's, a deleted one, a guessed id) is refused with `NOT_FOUND`, "That page isn't in this workspace.", and writes nothing. The check runs inside the definer by reading the page or form row through the workspace, not by trusting the item's `workspace_id`, and a table check makes a `page` or `form` item without a page or form id impossible.
- **AC-5606**: The Add booking page and Add form Modals list only the pages and forms of the workspace you are in, with no workspace named beside them (the workspace label of AC-5117 goes). The pages a person has in other workspaces never appear.
- **AC-5607**: The public read of `/<handle>` resolves the handle to (person, workspace) and answers only that workspace's items. A `page` or `form` item whose own workspace differs from the page's is skipped, so a stray row can never leak. The answer still carries no workspace id, member id or email.
- **AC-5608**: `/<handle>/<slug>` resolves the slug among the booking pages the person owns in the handle's workspace only. `booking_pages_owner_slug` (unique per owner across workspaces) goes, and the existing unique (`workspace_id`, `owner_member_id`, `slug`) is the one rule. A slug may now repeat across a person's workspaces, and each address still names exactly one page.
- **AC-5609**: Views and presses are counted per (`user_id`, `workspace_id`), so a workspace's link page shows only its own numbers. The editor and Home card show the page of the workspace you are in.

*Links that point at our own pages*

- **AC-5610**: An address on one of our public origins that names a booking page (`/b/:key` or `/<handle>/<slug>`), a form (`/f/:key`) or a handle page (`/<handle>`) is a workspace address. A `link` item, a form's redirect, and a routing rule's redirect may only hold a workspace address that resolves inside their own workspace. Any other (another workspace's, or one that resolves to nothing) is refused with `CONFIG_INVALID`, "That page isn't in this workspace.", and nothing is written. An address on any other site is unaffected.
- **AC-5611**: The check is one shared function (`workspaceAddressProblem`), parsed in `@crm/contracts` and resolved in `@crm/core` through the booking and form lookups, used by the link page, the form's `after` redirect and the routing `redirect` route. Its answer never says whether the other workspace's page exists: a foreign page and a missing one read the same.
- **AC-5612**: The check runs again on publish and on every public read of a link page and a form's thank you: an address that has since come to point at another workspace's page (a slug reused, a page moved) is skipped on the link page and answered as the form's own thank you message, never followed.
- **AC-5613**: Booking pages and forms are already safe against another workspace through row level security. A guard test proves a form's booking target, a routing `book` rule, a link page `page` item and `form` item, and all three redirect kinds each refuse another workspace's page, and that `/b/:key` and `/f/:key` are unchanged.

*Migration (the link page is new, so cross workspace data is deleted)*

- **AC-5614**: Migration `0112_link_page_per_workspace` gives each existing person their current handle and link page in ONE workspace: the workspace where they own the most live Public booking pages (ties: the earliest membership; none: the earliest membership). Their old handles all move with it, so every address already shared keeps working.
- **AC-5615**: Their `link`, `heading` and `contact` items move to that workspace. Their `page` and `form` items that belong to a different workspace are deleted, along with those items' presses. A heading left with nothing under it is kept. The migration writes one line to the deploy log with the counts removed, and nothing else leaves a trace.
- **AC-5616**: Every other workspace the person belongs to starts with no handle and an empty link page. They claim one in that workspace's Settings › Profile if they want it.

*The editor and Home*

- **AC-5617**: Settings › Profile › Your link page, the Home "Your link page" card and the QR code all show the page of the workspace you are in, and say which workspace in one quiet line ("Your link page in Acme"). Switching workspace switches the page.
- **AC-5618**: A person who belongs to more than one workspace, and has a handle in another one, sees one quiet line under the claim note: "You already have a link page in <workspace>. Each workspace has its own." It names workspaces they belong to, nobody else's.

## Decision

**Chosen option**: one handle per workspace membership (the owner's pick on 26 October 2026, over choosing one workspace per person and over putting the workspace in the address).

- **Where it lives**: `workspace_id` is added to `auth.public_handles`, `auth.public_profiles` and `auth.profile_items`, in the `auth` schema as today. The tables stay outside row level security and reachable only through the `crm_handle` definers, so the definers are what enforce the workspace: each takes (`owner uuid`, `workspace uuid`), checks the owner is an active member of that workspace, and reads booking pages and forms through the booking lookup, which already filters by workspace.
- **What does not change**: `/b/:key`, `/f/:key`, the booking page widgets, and the access door. A page's own rules still decide whether a visitor sees it.
- **Name and picture**: the account's name and picture stay account level and show on each page. Bio is per workspace. A different public name per workspace is out of scope.

**Implementation skills**: `crm-data-model-access` (tables, definers, the door), `crm-api-backend` (public routes, errors), `crm-frontend-state`, `crm-design-system`; plus `drizzle`, `zod`, `vitest`, `security-and-hardening`.

## Feature design

**Data changes** (migration `0112_link_page_per_workspace`, hand written, reviewed by `security-access-reviewer`):

| Change | Detail |
|---|---|
| `auth.public_handles` | add `workspace_id uuid not null` (backfilled per AC-5614), index (`user_id`, `workspace_id`) |
| `auth.public_profiles` | primary key becomes (`user_id`, `workspace_id`); one current handle each |
| `auth.profile_items` | add `workspace_id uuid not null` for every kind; unique per (`user_id`, `workspace_id`, `position`); the `page` and `form` uniques gain `workspace_id`; the heading and contact uniques become per (`user_id`, `workspace_id`) |
| `auth.profile_views` | key becomes (`user_id`, `workspace_id`, `day`, `visitor`) |
| `booking_pages` | drop `booking_pages_owner_slug` and the trigger's cross workspace role in it; keep `booking_pages_slug` |
| Definers | every `crm_profile_*`, `crm_save_public_profile`, `crm_handle_owner` and `crm_booking_profile_pages` gains a workspace argument and the membership check; none answers across workspaces |

**Value sourcing**

| Value | Source |
|---|---|
| The workspace of an item or a claim | the session's current workspace, never an input |
| The workspace of a public page | the handle's row in `auth.public_handles` |
| Whether an address is a workspace address | parsed from the address against the public origin in `@crm/contracts`, resolved in `@crm/core` |
| The workspace to move a person's old page to | AC-5614's rule, computed in the migration |

**Edge cases**

- A person claims the same handle in two workspaces: refused, handles stay globally unique (`23505`).
- A person is removed and rejoins: their handle and page return as they were (AC-5603).
- A page's slug reused or a page deleted after a link points at it: the link is skipped on read (AC-5612), and the editor marks it "Not in this workspace".
- The migration runs twice: every step is idempotent (guarded on `workspace_id is null`).
- Rate limits, the views HMAC and the cleanup are unchanged.

## Build plan

Order: a thin end to end thread first (Tracer Bullet, the project default), then the rest.

1. **Thread** (AC-5601, 5604, 5605, 5607): the migration for the three tables with the backfill, the workspace aware definers, one `page` item written and read through the public page in one workspace, with the cross workspace refusal test (AC-5613 first case).
2. **Handles** (AC-5601 to 5603, 5608): claim per workspace, resolution by (person, workspace), the slug index change, the removed member case.
3. **Addresses** (AC-5610 to 5612): `workspaceAddressProblem`, wired to link items, form redirects and routing redirects, then the read time skip.
4. **Editor and Home** (AC-5606, 5609, 5617, 5618): the Add Modals, the per workspace numbers, the QR card and the one line notes.
5. **Guards** (AC-5613, AC-5615): the full guard suite, and the migration's count line.

Each task needs `security-access-reviewer`, and the UI tasks `design-system-guardian` then `ux-interaction-reviewer`.

## Consequences

- A person who wants the same links in two workspaces adds them in each. That is the point of the owner's rule.
- Existing cross workspace booking page and form items are lost. The owner accepted this on 26 October 2026 because the link page is new.
- `/<handle>/<slug>` addresses already shared keep working for the workspace the handle moved to, and stop working for pages in the person's other workspaces (they never had a handle there).
- Spec 0051's AC-5101 (the list lives with the account), AC-5104, AC-5117 and AC-5129 are changed by this spec.

## Follow-up

- Update 0051's status line to point here, and the `packages/core/AGENTS.md` and `apps/web/src/features/settings/README.md` notes that say the page crosses workspaces (`/sync`).
- Specs 0052 to 0055 (blocks, social links, appearance, sharing) were written when the page crossed workspaces. Each needs a check against AC-5604 once they land; sharing (0055) in particular must say which workspace's page it shares.
- Decide later whether a person may carry a different public name per workspace.

## Rationale

**Options**: (1) one handle per workspace, the owner's pick, chosen. (2) The person picks one workspace for their single handle: smallest change, but leaves their other workspaces with no page. (3) The workspace in the address, `/<workspace>/<handle>`: clashes with the `/<handle>/<slug>` booking route and moves every shared address.

**Why option 1**: it is the only one where each workspace can have its own page and the address alone says which. The cost is a handle that belongs to a membership, which touches the handle tables once, in one migration.

**Calls taken on the owner's behalf**: the migration picks the workspace by most Public booking pages (their real public presence); bio is per workspace and name and picture stay on the account; our own addresses are checked by one shared function so link blocks and redirects cannot disagree.
