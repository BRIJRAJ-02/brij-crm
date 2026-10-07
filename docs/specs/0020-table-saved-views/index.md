# 0020. Table views and saved views

**Date**: 2026-10-08
**Status**: Proposed

## Summary

Every object gets saved views: a named filter, sort and column layout that you keep for yourself or share with the workspace, with one default view per object. Filters and sorts you change sit as a draft (kept in the address bar, so a reload or a shared link keeps them) until you press Save; column moves, widths and hiding save at once. Views live in one small `views` table, travel as live events like every other change, and never show a member a view built on something hidden from them. The heavy lifting (windows over a million records, settling order after live edits) already belongs to the client data layer (#6), so this feature adds the view model, the toolbar and the switcher on top of it.

## Structure

- [0020-view-config.md](0020-view-config.md): the `ViewConfig` shape, how the effective columns and the effective query are worked out (new attributes, archived and hidden ones), the draft in the URL, and the rules for merging a layout saved by someone who can't see every column.
- [0020-screen.md](0020-screen.md): the view route, the bars and their controls, every dialog and menu item with its rule, every state of the screen, and the data layer's `data.views` store.

Reasoning and options: see [rationale.md](rationale.md).

## Dependencies

| Feature | What this spec needs | Thin slice built here when it is missing |
|---|---|---|
| #6 client data (spec 0006) | windows keyed by (object, filter, sorts), both window modes, settle and the row note, the definitions store (which loads an object's attributes on first ask), visible attributes, coarse coalescing, the undo stack | none: a hard prerequisite. Milestone 1 starts after spec 0006's milestone 3 |
| #15 relations (spec 0014) | the unsaved Filter and Sort in the view bar (AC-301), filters through relations, sort by a one side | if spec 0014's milestone 4 hasn't landed, milestone 1 here builds the FilterChip, FilterBuilder and SortBuilder wiring itself (the same components, spec 0014 task 15's shape) and spec 0014 then reuses it. Through relation filters work either way (the engine has them, spec 0004 AC-14) |
| #7 realtime (spec 0007) | the `views` event kind with `item_ids` (milestone 1's outbox migration, AC-79); `runWrite` with the `writeHooks` composer, `context.record` and `outboxHook` writing one `views` row per object named in `Change.views` (milestone 2, AC-82); `planDelivery` through spec 0009's `filterEvent` (milestone 2) | none: a hard prerequisite. Milestone 1 starts after spec 0007 milestones 1 and 2. Every view write except `views.markOpened` stores its row from the first day, private views included: there is no member channel and no fallback without a row |
| #9 access (spec 0009) | `views.manage` (lock, unlock, set default), `FORBIDDEN`, `visibleAttributes`, field levels; `filterEvent`'s `views` rule with the facts this spec supplies (view id to creator and visibility); `removeMember`, which calls this spec's `deleteMemberViews` | none: spec 0009 milestone 1 lands before spec 0007 milestone 2 in the build order, so before milestone 1 here. Hidden attributes and records arrive with #24; the rules here are tested with rules injected through the door's `rules` dependency (spec 0009) |
| #13 objects and attributes (spec 0012) | archived attributes and objects, `defineObject` (a new object gets its default view in the same write), the grid's "+" header | if #13 hasn't landed, objects come only from the template and the migration backfill, and the "+" header rule waits for #13 |
| #12 load harness (spec 0011) | the `crm` seed, the `steady` scenario's filter and sort shapes | AC-484 is measured on the local capped stack (owner decision: no paid Neon). If `packages/load` doesn't exist yet, `pnpm db:seed:scale` and a Vitest bench through `records.query` stand in, and #12 runs it again |
| #21 board (spec 0021) | none: it adds `config.board` and the board kind on this table | a view whose `kind` is `board` (made through the API, or a later deploy rolled back) opened before spec 0021 milestone 1 renders as a table with a Callout (info) "Boards arrive soon. This view shows as a table for now." |
| #51 lists | none: `views.list_id` exists from the first migration, and procedures take `objectId` only until #51 | |

## Requirements

**User stories**:
- As a member, I want to filter any object by any attribute (including through a relation and "assigned to me") and sort it, so I see exactly the records I work on.
- As a member, I want to try a filter without changing the view for everyone, and save it only when I mean to.
- As a member, I want to save the way I slice an object as a view, private or shared, and come back to it from any device.
- As a member, I want the columns I move, resize, pin or hide to stay that way in the view.
- As an owner or admin, I want to lock a shared view and pick each object's default, so the team's key views don't drift.
- As a member with limited access, I want views built on things hidden from me to simply not exist for me.
- As a member, I want a filtered view of a million records to open as fast as an unfiltered one.

**Acceptance criteria** (this spec owns AC-462 to AC-491):

*Opening a view*
- **AC-462**: Every live object has a default view named "All <plural name>" (shared, table, newest first, every non system attribute in attribute order then Created at). Creating a workspace, creating an object (#13) and the migration's backfill each create it in the same transaction as the object, and `objects.default_view_id` points at it. Opening `/w/$slug/objects/$object` replaces the URL with `/w/$slug/objects/$object/views/$viewId` for the member's last opened view of that object when they can still see it, else the object's default view, else the first view in switcher order. When no view is left for the member (every shared view is built on something hidden from them, AC-479, and they have no private one), the object page shows the EmptyState "No views are available to you" with "Create view".
- **AC-463**: A view id the member can't see (unknown, deleted, another member's private view, hidden per AC-479) shows the screen's not found state: "This view doesn't exist or isn't shared with you." with a link to the object's default view. It never reveals which of those it was.

*Filter, sort and the draft*
- **AC-464**: The Toolbar's Filter button and each FilterChip open FilterBuilder in a Popover. Conditions combine with and and or groups nested up to 3 deep, on every attribute type the field set gives operators to, through up to 2 relations, and "is me" on a member attribute. Rows and the count change once a condition is complete, 300 ms after the last keystroke in its operand (the requests of the window that keystroke replaced are aborted); a condition missing its operand filters nothing. While a through condition waits for the far object's attributes to load, the grid shows its loading state. Results match the engine's reference evaluator for each type's operators, a through condition, and "is me" (which resolves to whoever opens the view).
- **AC-465**: The SortChip (or the dashed Sort button when a view has no sorts) opens SortBuilder: up to 5 sorts, each attribute once. The column menu's Sort ascending and Sort descending replace the draft's sorts with that one. Numbers sort by value (-1, 1.5, 9, 10, 100), dates and timestamps by time, currency by code A to Z then amount, select and status by option position, text by the pinned ICU collation, and empty values last in both directions; a test checks every sortable type against the reference evaluator. Only attributes `isSortable` accepts are offered and accepted (the same function in SortBuilder, the config check and the engine). A view with no sorts lists records newest first (spec 0006 AC-57): `effectiveQuery` runs it as Created at descending while the stored sorts stay empty.
- **AC-466**: While the filter or sorts differ from the saved ones, the Toolbar's end shows "Discard changes" and a split "Save" whose menu holds "Save as new view". The URL carries the draft as `?draft=` (base64url of the canonical JSON), so reload, back and forward, and a copied link reopen the same draft. "Discard changes" returns to the saved query. Opening another view or object drops the draft. A draft longer than 6,000 characters once encoded stays out of the URL, and the view menu's "Copy link" is then disabled with "This filter is too long for a link. Save it as a view to share it."
- **AC-467**: A `draft` that doesn't parse is ignored and a toast says "That link's filter couldn't be read, so the saved view is shown." Conditions and sorts in a draft that name an attribute that is archived, deleted or not visible to the member are removed, and a Callout says "Some filters in this link use fields that aren't available to you, so they were left out." (one message for all three causes).
- **AC-468**: Save writes the draft as the view's filter and sorts for everyone who sees the view. Every other open tab on that view with no draft of its own switches to the new query within 1 second at p95 and shows an info toast "<Name> changed the filters on this view."; a tab with a draft keeps it.
- **AC-469**: Saving over a change you didn't see is never silent: when the view's filter or sorts were saved by someone else after your draft began, Save answers 409 `VIEW_CHANGED` and a dialog says "<Name> changed this view's filters since you started. Replace them with yours, or save yours as a new view?" with "Replace" (saves yours over theirs), "Save as new view" (the create dialog, prefilled) and "Cancel" (keeps your draft).

*Layout*
- **AC-470**: Column changes save to the view at once, for everyone on it: reorder (header drag, or Move left and Move right), resize, Pin and Unpin, Hide (column menu or the View settings switch) and Show (View settings). The change shows in the member's own grid in the same frame and in every other tab on that view within 1 second at p95. A refused save rolls the layout back with a toast naming why. A resize sends at most one save per 500 ms.
- **AC-471**: The name column is always first, always shown and always pinned; 1 to 5 columns are pinned. Attributes a view doesn't list (created after the view last saved its columns) show at the end in attribute order on a view with "show new attributes" on (every seeded default view) and stay hidden on every other view; an attribute created from the grid's "+" header is added to the current view's columns. Reordering attributes in settings (spec 0012 AC-232) moves a view's columns only while its stored `columns` is empty (every seeded default view until its first layout save). Any layout save writes every column in its current order, and from then settings reorders no longer move that view's columns (new attributes still join at the end as above).

*Managing views*
- **AC-472**: The switcher's "Create view" opens a dialog: Name (1 to 100 characters), Type (Table or Board), "Who can see it" (Only me, Everyone in the workspace; Only me preselected) and "Start from this view's columns and filters" (on). Create waits for the server, then opens the new view. A shared name already used on that object (ignoring case) is refused on the name field with `NAME_TAKEN` "A shared view with this name exists on <plural>."; a private name already used by the same member on that object likewise with "You already have a view with this name.". The 101st shared view of an object, or a member's 51st private view of one object, is refused `LIMIT_REACHED` in the dialog naming the limit. A create retried with the same id by the same member on the same object returns the view already made; the same id in any other case answers 409 `ID_TAKEN`.
- **AC-473**: The switcher lists the default view first, then the other shared views by position, then a "Private" group with the member's own private views by position; each locked view shows a lock icon. The view menu offers, when allowed (rules in [0020-screen.md](0020-screen.md)): Rename, Duplicate, Copy link, Move up, Move down, Share with everyone or Make private, Lock or Unlock, Set as default, Delete. A disabled item shows its reason.
- **AC-474**: Delete asks to confirm ("Delete <Name> for everyone?" for a shared view, "Delete <Name>?" for a private one). The default view can't be deleted (409 `VIEW_IS_DEFAULT`, "This is the default view for <plural>. Make another view the default first."). Every tab on a deleted view moves to the object's default view within 1 second with the toast "<Name> was deleted, so you're on <Default name>."
- **AC-475**: Only owners and admins (`views.manage`) lock and unlock a shared view and choose an object's default view, which must be shared. Private views can't be locked. A locked view shows "Locked by <Name>" in the view bar.
- **AC-476**: On a locked view, a member without `views.manage` can still filter, sort and change columns for this visit, but nothing saves: Save offers only "Save as new view", layout changes stay in that tab until they leave the view, and the view bar says "Locked by <Name>. Your changes here aren't saved." A write that reaches the server anyway answers 403 `FORBIDDEN` "This view is locked. Ask an owner or admin to unlock it." and changes nothing.
- **AC-477**: Any member may rename, reorder, filter, sort and change the columns of a shared view that isn't locked. Only the view's creator may make a shared view private (never the default view, never a view with no creator). Only its creator sees, edits or deletes a private view. A write the caller may not make answers 403 `FORBIDDEN` with a plain message, writes nothing and stores no outbox row. Move up and Move down swap the view's position with its neighbour in its group (shared, or the caller's private views); a view that changes visibility takes the largest position in its new group plus 1.
- **AC-478**: The last view a member opened per object is stored on the server, so another browser or device opens the same one. A last opened view that was since deleted, made private by its creator or hidden from the member falls back as AC-462 says.
- **AC-490**: When a member is removed from the workspace (spec 0009's `removeMember`), the same transaction deletes their private views and their last opened rows, and stores the `views` outbox rows for them. Their shared views stay, with `creator_member_id` unchanged; wherever the creator's name shows, it reads "A removed member", and "Make private" is disabled for everyone with "This view's creator has left the workspace." Views they locked keep "Locked by A removed member" until someone with `views.manage` unlocks them.

*Access and definitions*
- **AC-479**: Hidden is absent: a view whose filter (at any depth and any hop), sorts or board grouping names an attribute the member can't see, or whose filter names a record they can't see, is left out of `views.list` and answers `NOT_FOUND` to every call naming it, for that member only. Columns and card fields naming hidden attributes are left out of the view that member gets, and a layout save from that member keeps those entries where they were. Tested with rules injected through the door (spec 0009).
- **AC-480**: A view that uses an archived attribute keeps working: its column is left out, conditions and sorts on it are left out when the view runs, and a Callout says "This view uses <Title>, which is archived. It's left out until the attribute is restored. Saving a new filter removes it for good." Restoring the attribute brings the view back exactly as it was. A view whose object is archived goes with its object (spec 0012 AC-226).

*Live*
- **AC-481**: On a saved view or a draft, others' value changes patch at once, while order and membership settle 1.5 seconds after the last change; the member's own edited row that no longer matches stays with "Doesn't match this view" (spec 0006 AC-56, now on every view).
- **AC-482**: Every view write stores its `views` outbox row in its transaction (except `views.markOpened`), private views included. Shared view changes (created, renamed, reordered, layout, query, locked, default, deleted) reach every member's open switcher and view within 1 second at p95. No frame carries a private view's id to anyone but its creator: spec 0009's `filterEvent` keeps a view id only on a channel whose every member may see the view, so on a shared channel the event is coarse (the object, no ids). Every tab holding views of that object then refetches its `views.list`, and the bodies it holds whose version moved, at most once a second per object (spec 0006's coalescing); the creator's own tabs pick up the change the same way, within 1 second at p95. Checked on the WebSocket frames.

*Scale and cost*
- **AC-483**: A filtered or sorted view's first page of 100 rows and its count, for each shape in the scale table ([0020-screen.md](0020-screen.md), *Scale shapes*), answer within 300 ms at p95 end to end on the local capped stack with the `crm` seed while 100 simulated members run `steady`; counts may answer "10,000+". The best effort shapes are measured and recorded, not judged. Results in `verify.md`.
- **AC-484**: `views.list` and `views.get` answer within 50 ms at p95 in the database call with 150 views on one object. Switching between two views already opened in this tab shows rows from the window still held (no skeleton) when the switch happens within 30 seconds.
- **AC-485**: Nothing polls: with the app open on a view and nobody acting for 10 minutes, the browser makes no data layer read or write (`records.*`, `views.*`); the live connection stays open, and renewing the realtime tokens is the one request allowed. So an idle tab never keeps the database awake.

*Quality*
- **AC-486**: The view screen has every state: loading (TopBar, ViewBar and grid skeletons after the loading delay), error with Retry, an object with no records ("No <plural> yet" with "New <singular>"), a filter matching nothing ("No <plural> match these filters" with "Discard changes" on a draft, or "Edit filters" on a saved filter), not found (AC-463), no view available (AC-462), a board view before spec 0021 (a table with its Callout), and an archived object (spec 0012's page).
- **AC-487**: Every control works by keyboard, with a visible focus ring: Tab moves TopBar, ViewBar, Toolbar, then the grid; every Popover and dialog returns focus to what opened it; a count change after a filter is announced ("124 people match"). Contrast holds in light and dark. `ux-interaction-reviewer`, `design-system-guardian` and `dxe quick` pass on the screen.
- **AC-488**: Every new procedure passes the member door and has an access table entry (spec 0009 AC-139); the contract walking test covers them, and the outbox test lists `views.markOpened` as its only exemption.
- **AC-489**: The flows run with two browsers in Playwright, locally and against production: save a filter and see it in the other browser, move a column, a private view absent from the other member, lock and the locked member's unsaved changes, delete with fallback, the VIEW_CHANGED dialog. Results in `verify.md`.

## Decision

**Chosen option**: Option 1: one `views` table with a versioned, Zod checked JSON config per view; the query (filter and sorts) saved only by an explicit Save with a version check, the layout saved at once with last save wins; drafts in the URL; and everything that runs a view going through spec 0006's windows.

Calls made here (the rationale has the runner up for each):
- **Any member edits shared views; owners and admins lock them** (brief). Lock uses spec 0009's `views.manage`.
- **The object's default view is chosen by owners and admins** (`views.manage`). The brief doesn't say; owner decision 1 below.
- **Private views travel as coarse events**: no member channel. A private view's event names its id only to a channel of its creator alone; everywhere else it is coarse and tabs refetch their views list for that object (owner decision 6).
- **A removed member's private views are deleted** with the removal; their shared views stay (owner decision 7).
- **A view with no sorts runs newest first**, like every list in the product (owner decision 5).
- **The query saves by Save, the layout saves at once** (brief). A query save checks a version (`VIEW_CHANGED`); a layout save never refuses for a clash.
- **New attributes show only in views that ask for them** (the seeded default views) and in the view they were created from; other views stay as curated. This narrows spec 0012 AC-229's "every open table" (Follow-up).
- **A view built on a hidden attribute or record is absent**, never shown with a hole (brief, spec 0009).
- **Archived attributes are skipped with a warning**, and the stored view is left untouched until someone saves a new filter (brief).
- **No table grouping** in v1 (brief); grouping is the board (#21).
- **Views have no trash**: a delete is hard, after a confirm. Views are settings, not records.

**Implementation skills**: `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `drizzle` (`.claude/skills/drizzle/`) · `db-core` and `react-db` (`tanstack/db`, `.claude/skills/db-core/`, `.claude/skills/react-db/`) · `tanstack-router-best-practices` (`.claude/skills/tanstack-router-best-practices/`) · `react-aria` (`.claude/skills/react-aria/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`) · `api-and-interface-design` (`addyosmani/agent-skills`, `.claude/skills/api-and-interface-design/`) · house skills `crm-frontend-state`, `crm-design-system`, `crm-api-backend`, `crm-data-model-access`

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Data model sketch (one migration, milestone 1; milestone 2 adds `member_view_state`)

| Table | Key | Columns and rules |
|---|---|---|
| `views` (new) | (`workspace_id`, `id`) | `id` uuid v7 (client chosen; the idempotent create key). `object_id` uuid null and `list_id` uuid null, exactly one set (check), composite foreign keys to `objects` and `lists`. `parent_id` uuid generated always as `coalesce(object_id, list_id)` stored. `kind` `view_kind` enum (`table`, `board`). `name` text not null, 1 to 100 characters after trim. `visibility` `view_visibility` enum (`private`, `workspace`). `creator_member_id` uuid null → `members` (null only for views the system seeded). `position` integer not null. `config` jsonb not null (parsed by `ViewConfig` on every read and write; at most 64 kB). `version` integer not null default 1 (bumped by every change). `query_version` integer not null default 1 (bumped when the filter or sorts change). `query_saved_at` timestamptz, `query_saved_by_member_id` uuid null. `is_locked` boolean not null default false, `locked_by_member_id` uuid null, `locked_at` timestamptz null. Audit columns (`created_*`, `updated_*`) as every definition row. Forced row level security, the standard policy. |
| `views` constraints | | check: `visibility = 'private'` implies `creator_member_id` is not null and `is_locked` is false. Unique (`workspace_id`, `parent_id`, `lower(name)`) where `visibility = 'workspace'`. Unique (`workspace_id`, `parent_id`, `creator_member_id`, `lower(name)`) where `visibility = 'private'`. Index (`workspace_id`, `parent_id`, `visibility`, `position`). A clash on either unique index maps to `NAME_TAKEN`. |
| `objects` | existing | new `default_view_id` uuid null, composite foreign key (`workspace_id`, `default_view_id`) → `views` deferrable initially deferred (the object and its view are written in one transaction). Every live object has one after the backfill; `setDefaultView` refuses a private view. |
| `member_view_state` (new, milestone 2) | (`workspace_id`, `member_id`, `parent_id`) | `view_id` uuid → `views` on delete cascade, `opened_at` timestamptz. Forced row level security. No outbox: it is the member's own bookmark. |
| `outbox` | existing | nothing added: spec 0007 milestone 1 adds the `views` kind. `outboxHook` writes one `views` row per object named in `Change.views`, with `object_id` set and `item_ids` = the view ids. |

Migration backfill (milestone 1): for every live object of every workspace, one default view (name "All <plural_name>", position 0, `creator_member_id` null, the default config below), then `objects.default_view_id`. `createWorkspace`'s template and `defineObject` (#13) do the same in their transactions through one `seedDefaultView(tx, object)` in `packages/core/src/views/`.

The default config: `{ columns: [], showNewAttributes: true, pinnedCount: 1, sorts: [{ attributeId: <created_at system attribute>, direction: 'descending' }] }` (no filter). An empty `columns` with `showNewAttributes` means "every non system attribute in attribute order, then Created at", which keeps spec 0012's settings order as the default column order. The full config rules are in [0020-view-config.md](0020-view-config.md).

### State transitions

```
view: (create) → private | workspace
private → workspace            (Share with everyone, its creator)
workspace → private            (Make private, its creator while a member; not the default view; not a seeded view)
workspace: unlocked ⇄ locked   (views.manage)
any → gone                     (Delete; never the default view)
private → gone                 (its creator removed from the workspace, in the same transaction)
```

### API surface

oRPC on `/api/rpc`, every procedure on `member` with `WorkspaceScoped` input, refusals as `{ code, message, data? }`. `View` and `ViewSummary` are in `packages/contracts/src/views.ts`.

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `views.list` | `workspace`, `objectId` | `{ views: ViewSummary[], defaultViewId, lastOpenedViewId? }` in switcher order | member, object `read` | 404 |
| `views.get` | `workspace`, `viewId` | `View` | may see it | 404 `NOT_FOUND` |
| `views.create` | `workspace`, `id` uuid v7, `objectId`, `name`, `kind`, `visibility`, `config` | `View` (the existing one for a replay: same id, object and creator) | member, object `read` | 409 `NAME_TAKEN`, `LIMIT_REACHED`, `ID_TAKEN` (the id exists with another object or creator); 422 `CONFIG_INVALID` |
| `views.update` | `workspace`, `viewId`, `name?`, `visibility?`, `mutationId` | `View` | per the rules table | 403 `FORBIDDEN`; 404; 409 `NAME_TAKEN`, `VIEW_IS_DEFAULT` (to private) |
| `views.setLayout` | `workspace`, `viewId`, `layout` (`ViewLayout`: `kind?`, `columns`, `pinnedCount`, `board?`), `mutationId` | `View` | may edit it | 403 (locked); 404; 422 `CONFIG_INVALID` |
| `views.saveQuery` | `workspace`, `viewId`, `filter?`, `sorts`, `baseQueryVersion`, `force?`, `mutationId` | `View` | may edit it | 403 (locked); 404; 409 `VIEW_CHANGED` (with `data: { savedBy, savedAt }`); 422 `FILTER_INVALID` |
| `views.move` | `workspace`, `viewId`, `direction` (`up`, `down`), `mutationId` | `ViewSummary[]` | may edit it | 403; 404 |
| `views.setLocked` | `workspace`, `viewId`, `locked`, `mutationId` | `View` | `views.manage` | 403; 404; 422 `CONFIG_INVALID` (private) |
| `views.setDefault` | `workspace`, `objectId`, `viewId`, `mutationId` | `ViewSummary[]` | `views.manage` | 403; 404; 422 `CONFIG_INVALID` (private) |
| `views.delete` | `workspace`, `viewId`, `mutationId` | `{ deleted: true }` | may edit it | 403; 404; 409 `VIEW_IS_DEFAULT` |
| `views.markOpened` | `workspace`, `viewId` | nothing | may see it | 404 |

- `ViewSummary`: `{ id, objectId, name, kind, visibility, position, isDefault, isLocked, lockedBy?: memberId, creatorMemberId?, version }`.
- `View`: `ViewSummary` plus `{ config: ViewConfig, queryVersion, querySavedBy?: memberId, querySavedAt? }`, with hidden columns and card fields already left out (AC-479).
- New codes in `ERROR_MAP` (`packages/contracts`): 409 `VIEW_CHANGED`, 409 `VIEW_IS_DEFAULT`. Reused: `NAME_TAKEN` (spec 0012), `FORBIDDEN` (spec 0009), `LIMIT_REACHED`, `CONFIG_INVALID`, `FILTER_INVALID`, `NOT_FOUND`, `ID_TAKEN`.
- Every write except `views.markOpened` runs inside `runWrite` with the `writeHooks` composer and records what it touched through `context.record({ views: [{ viewId, objectId }] })` (`Change.views`, the field spec 0007 lists for this kind). `outboxHook`, the one outbox writer, stores one `views` row per object and takes the counter row last (spec 0007 AC-82). There is no other outbox call in this feature.
- Waking the worker follows spec 0008's rule unchanged: after a write that stored an outbox row or started a job, and on any authenticated request at most once a minute per API process. `views.markOpened` stores no row, so it wakes the worker only through that once a minute rule.
- `deleteMemberViews(tx, context, memberId)` (in `packages/core/src/views/`) is called by spec 0009's `removeMember` inside its transaction: it deletes the member's private views and their `member_view_state` rows (a default view is always shared, so no object loses its default) and records the deleted ids in `Change.views`, so the removal stores their `views` rows.
- **Live events for views** (spec 0007 milestone 2, spec 0009's `views` rule): `eventFacts` for a `views` row reads each named view's `creator_member_id` and `visibility` from `views` (`viewFacts` in `packages/core/src/views/`, one batched read). `filterEvent` keeps a view id only when every member of the audience may see the view (a shared view; a private one only when the audience is its creator alone); a view the facts can't find (deleted since) counts as seen by nobody. When it removes any id the event is coarse: the object, no ids. Today every member shares the `open` audience, so every private view event is coarse, and so is the event of a deleted view.
- **What the fan out costs**: a coarse `views` event makes every tab that holds views of that object call `views.list` once, then `views.get` only for held bodies whose `version` in the list moved, at most once a second per object (the trailing call jittered 0 to 2 seconds, spec 0006 AC-61). Tabs holding nothing of that object send nothing. A member resizing a column of a private view sends at most 2 layout saves a second, so at 100 online on one object that is at most about 100 small `views.list` calls a second while they drag. #12 measures it (Follow-up).

**The rules table** (who may do what, checked in `packages/core/src/views/rules.ts`, pure):

| Action | Private view | Shared, unlocked | Shared, locked |
|---|---|---|---|
| see, open | its creator | everyone who sees the object (AC-479 aside) | everyone |
| rename, move, layout, save query, delete | its creator | any member | `views.manage` |
| share with everyone | its creator | | |
| make private | | its creator while a member (not the default, not seeded) | never (unlock first) |
| lock, unlock | never | `views.manage` | `views.manage` |
| set as default | never | `views.manage` | `views.manage` |

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| open object | which view | `views.list`: `lastOpenedViewId` if present in the list, else `defaultViewId` if present, else the first id in the list |
| `views.list` | `lastOpenedViewId` | `member_view_state.view_id` for (member, object), only when that view is in the member's list |
| `views.list` | order | default view first; then shared by `position`, then `id`; then the caller's private views by `position`, then `id` |
| `views.list`, `views.get` | which views | `visibility = 'workspace'` or `creator_member_id` = the caller; minus views failing `viewVisible(access, view)` (AC-479), from `packages/core/src/views/visible.ts` |
| `views.get` | columns and card fields shown | the stored config minus entries `fieldLevel` says are hidden |
| create | `position` | the largest `position` among that object's shared views (or the caller's private views) plus 1, read under the `objects` row lock |
| create | a replay | an existing row with the given `id`: returned as is when its object and creator match the call, else `ID_TAKEN` |
| move | the new positions | under the `objects` row lock: the view's `position` swapped with its neighbour's in the same group (shared views, or the caller's private views, ordered by `position` then `id`); the default view never moves and is never a neighbour |
| share with everyone, make private | the new `position` | the largest `position` in the group it joins plus 1, under the `objects` row lock |
| creator, locker, saver names | "<Name>" | the definitions store's members; "A removed member" when the id isn't among them (it lists active members only), "the workspace" for a seeded view with no creator |
| "Make private" disabled reason | the creator is gone | "This view's creator has left the workspace." when `creatorMemberId` isn't an active member; "Only <Name> can make this view private." for other members |
| create | the config | the dialog: "Start from this view" on → the current view's layout plus the draft query; off → the default config with `showNewAttributes: false` and every non system attribute listed shown |
| create | the limits | `VIEWS_SHARED_PER_OBJECT` 100 and `VIEWS_PRIVATE_PER_MEMBER_PER_OBJECT` 50 in `packages/core/src/engine/limits.ts`, counted under the `objects` row lock |
| duplicate | name and visibility | "<Name> copy" (then " 2", " 3" while taken); a private view stays private, a shared one becomes private to the duplicator |
| any write | `version` | `version + 1` |
| save query | `query_version`, `query_saved_*` | `query_version + 1`, `now()`, the caller's member id |
| save query | the clash check | `baseQueryVersion` from the `View` the tab held when the draft began; unequal and `force` absent → `VIEW_CHANGED` with `query_saved_by_member_id` and `query_saved_at` |
| `VIEW_CHANGED` dialog | the name | `querySavedBy` through the definitions store's members |
| layout save | hidden entries kept | `mergeLayout(stored, incoming, visible)` ([0020-view-config.md](0020-view-config.md)) |
| running a view | filter and sorts | `effectiveQuery(config or draft, attributes)` in `@crm/contracts`: archived, deleted and unknown attribute ids removed; empty sorts run as Created at descending |
| running a view | attributes of a through path's far object | `definitions.attributes(farObjectId)` (spec 0006's definitions store, which loads an object's attributes on first ask); FilterBuilder and `effectiveQuery`'s resolver ask for them, and the screen shows its loading state, opening no window, until every object a condition passes through has loaded |
| sort and the config check | which attributes sort | `isSortable(attribute)` in `@crm/contracts`: true exactly for the types and system columns the engine's `compileSorts` has a key for; `compileSorts` refuses through it, SortBuilder lists only them, and `ViewConfig`'s refine uses it |
| draft | when an operand edit applies | 300 ms after the last keystroke in a FilterBuilder operand (`FILTER_EDIT_MS` in `packages/data`); a new window key then replaces the old one, and the old window's requests are aborted |
| running a view | columns and widths | `effectiveColumns(config, attributes)` in `@crm/contracts` |
| running a view | `now`, `timeZone` | as spec 0006 (`Date.now()`, the browser's zone); "is me" resolves on the server to the caller's member id (spec 0004) |
| draft | URL text | `encodeDraft({ filter, sorts })`: canonical JSON (keys sorted), UTF-8, base64url without padding; dropped when over 6,000 characters |
| draft | whether it differs | canonical JSON of the draft unequal to the saved `{ filter, sorts }` |
| lock | "Locked by <Name>" | `locked_by_member_id` through members |
| live | the event | `views` outbox row through `filterEvent`; named ids: the client refetches `views.list` for the object and `views.get` for each named view it holds; coarse: `views.list` for the object, then `views.get` for each held view of it whose `version` moved or which left the list |
| live toast | "<Name> changed the filters" | `querySavedBy` of the refetched view, when its `queryVersion` grew and the tab has no draft |
| row count label | "124 people", "10,000+ people" | the window's `count` (spec 0006), with the object's singular or plural name |

### Key invariants

- A view's config always parses with `ViewConfig`; a stored config that fails (a bug, a later downgrade) is served as the default config with a logged warning, never as an error page.
- The server never runs a view's query on its own: the browser sends the effective filter and sorts to `records.query` and `records.count`, which check them through the door. A saved view can never widen what `records.query` returns.
- A view never changes because an attribute was archived or hidden; only a member's save changes it.
- A layout write never removes a column or card field the writer can't see.
- The default view of a live object is shared and exists; it can't be deleted or made private.
- Private views and their ids reach only their creator: through reads (the creator check) and through events (`filterEvent` makes them coarse on any channel shared with anyone else).
- Every view write except `views.markOpened` stores its outbox rows through `outboxHook`, in its own transaction; a refused write stores none.
- Views are read and written only through `packages/data`'s `data.views`; no screen holds a copy of a view.

### Security model

- `views` and `member_view_state` are tenant tables with forced row level security; every procedure runs through the member door and `inWorkspace` or `runWrite` (spec 0009).
- Private views: every read filters by `creator_member_id`; a non creator gets `NOT_FOUND` for any call naming one, the same as an unknown id.
- A view's filter can name only attributes of its object (or along through paths); `views.saveQuery` parses the filter with `FilterGroup` and checks every attribute id through the compiler's attribute check (spec 0009 AC-141), so a saved view can't hold a filter the member couldn't run.
- Views built on hidden attributes or records are absent; columns and card fields naming hidden attributes are cut from what the member receives.
- The config is user controlled JSON: strict Zod (unknown keys refused), 64 kB cap, attribute ids checked against the object, names trimmed and limited. Nothing in it reaches SQL except through the engine's parameterised compiler.
- `views.manage` is checked on the server for lock, unlock and default; the client only hides the controls.
- `security-access-reviewer` reviews milestones 1 and 2; `state-performance-reviewer` reviews milestones 1 and 3.

### Configuration required

None. No new environment variables or services.

### Critical test scenarios

- Happy path: open People, add "Owner is me" and "Company › Industry is Software", sort by Created at, Save; a second browser sees the new filter with the toast; the copied link with a draft opens the same draft, verifies **AC-462**, **AC-464** to **AC-468**.
- Clash: two browsers draft different filters; the first saves; the second gets `VIEW_CHANGED`, picks Replace, then Save as new view on a third try, verifies **AC-469**.
- Layout: move, resize, pin and hide in one browser; the other follows within a second; a locked view's member changes stay local and reset on leaving, verifies **AC-470**, **AC-471**, **AC-476**.
- Managing: create private and shared views, name clashes, the 101st shared view, duplicate, move, delete with fallback, set default, the default can't be deleted, verifies **AC-472** to **AC-475**, **AC-477**, **AC-478**.
- Access (rules injected): a view filtering on a hidden field and one naming a hidden record are absent for the restricted member; a column on a hidden field is cut; that member's layout save keeps it; another member's private view answers `NOT_FOUND`; a member's lock call gets 403, verifies **AC-463**, **AC-477**, **AC-479**, **AC-488**.
- Archived: archive an attribute used in a view's filter, sort and columns; the Callout; restore brings it back unchanged; saving a new filter drops it, verifies **AC-480**.
- Sorts: every sortable type against the reference evaluator, empties last both ways, verifies **AC-465**.
- Live and privacy: two browsers; a private view's change reaches the other member's frames only as a coarse `views` event with no id, the creator's second tab follows within a second, and the other member's tab makes one `views.list` call and no `views.get`; a shared change reaches both, verifies **AC-481**, **AC-482**.
- Removed member: a member with two private views and one shared, locked view is removed; their private views and last opened rows are gone in the same transaction with the `views` rows stored; the shared view reads "A removed member" and "Make private" is disabled with its reason, verifies **AC-477**, **AC-490**.
- No view left: with rules injected, every shared view of an object filters on a field hidden from a member who has no private view; the object page shows "No views are available to you" and Create view works, verifies **AC-462**.
- Scale: the shape table on the local capped seed with 100 members online; `views.list` with 150 views; idle tab network log, verifies **AC-483** to **AC-485**.

## Build plan

Tracer Bullet: milestone 1 threads one saved query through every layer (table, procedure, event, store, URL, toolbar) on the default views; milestone 2 widens to many views and the layout; milestone 3 proves access, archive handling and scale.

**Milestone 1: filter and sort any object, saved on its default view** (after spec 0006 milestone 3 and spec 0007 milestones 1 and 2, which in the build order also brings spec 0009 milestone 1)
1. Migration: `view_kind`, `view_visibility`, `views` with its constraints and policy, `objects.default_view_id`; the backfill of one default view per live object; guard tests extended to the new table, satisfies **AC-462**
2. Contracts: `ViewConfig`, `ViewLayout`, `ViewSummary`, `View`, `effectiveQuery` (newest first when the sorts are empty), `effectiveColumns`, `encodeDraft` and `decodeDraft`, `isSortable` (with `compileSorts` changed to refuse through it, and a test walking every type through both) with unit tests; `VIEW_CHANGED` and `VIEW_IS_DEFAULT` in the error map; `Change.views`; the `views.list`, `views.get`, `views.saveQuery` contracts, satisfies **AC-464** to **AC-467**, **AC-469**
3. Core: `packages/core/src/views/` with `seedDefaultView` (called by `createWorkspace` and `defineObject`), `listViews`, `getView`, `saveViewQuery` (version check, attribute check through the compiler), `viewFacts` for spec 0009's `views` rule, the access table entries, every write through `runWrite` recording `Change.views` for `outboxHook`; tests on real Postgres, satisfies **AC-462**, **AC-468**, **AC-469**, **AC-482**, **AC-488**
4. API: `apps/api/src/modules/views/router.ts` (thin), satisfies **AC-488**
5. Data layer: `data.views` (per object list, per view body, the `views` handler on spec 0007's live router for named and coarse events, `saveQuery` server confirmed) and the draft helpers in `@crm/data/react` (`useViewDraft` over the router's search param, the 300 ms operand debounce with the old window's requests aborted), satisfies **AC-464**, **AC-466** to **AC-468**
6. Screen: the `/w/$slug/objects/$object/views/$viewId` route with the redirect and the no view state, the Toolbar with FilterChips, the Filter Popover (FilterBuilder, loading while a through path's far attributes load), the SortChip Popover (SortBuilder), the column menu's Sort, Discard and Save, a board view shown as a table with its Callout; replaces People's unsaved sort from spec 0006 and reuses spec 0014's Filter and Sort when present; `ux-interaction-reviewer`, `design-system-guardian`, `dxe quick`, satisfies **AC-462** to **AC-468**, **AC-486**, **AC-487**
7. Deploy; Playwright: save a filter in one browser, see it in another, a draft link; `security-access-reviewer`, `state-performance-reviewer`, satisfies **AC-468**, **AC-489**

**Milestone 2: saved views, private and shared, and the layout**
8. Migration: `member_view_state`, satisfies **AC-478**
9. Core and API: `createView` (with its replay rule), `updateView`, `setViewLayout` with `mergeLayout`, `moveView` (swap with the neighbour under the `objects` lock), `setViewLocked`, `setDefaultView`, `deleteView`, `markViewOpened`, the rules table, the limits; `deleteMemberViews` wired into spec 0009's `removeMember`; the remaining procedures; private view events coarse through `filterEvent` checked on the frames, satisfies **AC-472** to **AC-478**, **AC-482**, **AC-488**, **AC-490**
10. Data layer: optimistic layout saves (500 ms debounce, rollback on refusal), local only layout on locked views, server confirmed create, rename, move, lock, default and delete; fallback when the open view disappears, satisfies **AC-470**, **AC-474**, **AC-476**
11. Library: the ViewBar switcher variant (`ViewChoice` gains `section` and `isLocked`, see [0020-screen.md](0020-screen.md)), with its stories and README lines; `design-system-guardian` reviews it before it lands
12. Screen: the switcher (default, shared, a Private section, lock icons, Create view), the create dialog, the view menu with every item and its disabled reason (the removed creator's included), View settings (ViewSettings in a Popover), the lock line in the view bar, the `VIEW_CHANGED` dialog, the grid's column changes wired to `setLayout`, the "+" header rule; reviewers as in task 6, satisfies **AC-469** to **AC-478**, **AC-486**, **AC-487**, **AC-490**
13. Deploy; Playwright two browser flows for layout, private views, lock and delete, locally and in production; `security-access-reviewer`, satisfies **AC-482**, **AC-489**

**Milestone 3: hidden, archived, live breadth and scale**
14. Core: `viewVisible` (filter at every depth and hop, sorts, board grouping, record operands) in `views.list` and `views.get`; hidden columns cut; tests with injected rules, satisfies **AC-463**, **AC-479**
15. Archived handling: `effectiveQuery` and `effectiveColumns` skip archived attributes, the Callout, the "saving removes it" rule, restore round trip, satisfies **AC-480**
16. Live breadth: settle and row notes on saved views and drafts checked end to end; the no request when idle check, satisfies **AC-481**, **AC-485**
17. Scale: the shape table through `records.query` on the local capped stack with `steady` at 100 members, `views.list` timing with 150 views, results in `verify.md`; `state-performance-reviewer`, satisfies **AC-483**, **AC-484**
18. Full Playwright suite locally and in production, `verify.md`; every reviewer before it lands, satisfies **AC-465**, **AC-487**, **AC-489**

## Consequences

**Positive**:
- One view model serves tables now and boards (#21), lists (#51), reports (#52) and the API's saved filters later.
- Saved views can never widen access: the server checks every query the browser runs.
- Drafts in the URL make a filtered state shareable without saving anything.
- Views ride the same outbox, relay and `filterEvent` as every other change: no member channel and no special path for private views.

**Negative / tradeoffs**:
- Layout changes on a shared view are last save wins: two members resizing the same column at once end with one width.
- A member's draft lives only in the URL; navigating away loses it.
- Views built on hidden things are simply absent, so an admin's shared view may be missing for some members with no explanation.
- A view whose filter names an archived attribute runs with a hole (more rows than its author meant) until the attribute is restored or the filter saved again.
- Up to 100 shared views per object can make the switcher long; search in the switcher is a later addition.
- Each `views.markOpened` is one small write per view switch.
- Every private view write, and every view delete, reaches other members as a coarse event, so each tab holding views of that object makes one `views.list` call (at most one a second per object). A member dragging a column width on a private view costs every other tab on that object up to one small read a second.
- A removed member's private views are gone for good; nobody can take them over.
- A filter operand applies 300 ms after the last keystroke, a short wait in exchange for not opening a window per keystroke.

**Neutral**:
- Two migrations (views; member view state). Two new error codes. One library variant (the ViewBar switcher).
- Spec 0012 AC-229's "last column of every open table" now means views with "show new attributes" on, and the view it was created from.
- People's unsaved column sort (spec 0006 AC-57) becomes the default view's draft.

## Follow-up

- [ ] **Spec 0012**: narrow AC-229 to "every view that shows new attributes, and the view it was created from" (`/sync`).
- [ ] **Spec 0006**: AC-57's unsaved People sort is replaced by the view draft; record it (`/sync`).
- [ ] **Spec 0009**: the `views.manage` catalog entry reads "lock and unlock shared views, change a locked one, choose the default view" (`/sync`).
- [ ] **Spec 0009**: `removeMember` now deletes the member's private views and their last opened rows through `deleteMemberViews` (this spec's AC-490), replacing "private views they own stay, visible to nobody, until #20 decides"; close its #20 follow up (`/sync`).
- [ ] **Spec 0009**: its `views` rule takes its facts from this spec's `viewFacts` (view id to creator and visibility; a view not found counts as seen by nobody) (`/sync`).
- [ ] **Spec 0007**: its #20 follow up (an exemption for private view writes) is moot: private views store rows from the first day and travel coarse through `filterEvent` (`/sync`).
- [ ] **Spec 0004 and the engine**: `compileSorts` refuses through `isSortable` from `@crm/contracts` (`/sync` once built).
- [ ] **#12 (spec 0011)**: measure the refetch load from coarse `views` events (private view writes and view deletes, coalesced at one a second per object) at 100 online on one object, beside the coarse job events of spec 0022.
- [ ] **#21**: `config.board` and the board kind (spec 0021).
- [ ] **#51**: views on lists (`list_id`), entry attributes in filters and columns.
- [ ] **#24**: rules exercised for real; the view absence message for admins ("2 views use fields hidden from some members") if wanted; warn an admin choosing a default view whose query names a field restricted for some members; the `views` rule then also needs the attribute and record ids each view's query names, so `viewVisible` can run per audience.
- [ ] **#34**: saved views readable through the public API (`views.list` per key), using the same `viewVisible`.
- [ ] **#11**: product events `view_created` and `view_query_saved` (ids only) in the event catalog.
- [ ] A search field in the view switcher when an object passes 20 views.

## Owner decisions

**Answered by the owner on 3 October 2026 (the recommended defaults for #11 to #22) and in the cross check of 8 October 2026.**

1. **Who may choose an object's default view?** Decided: owners and admins only (`views.manage`), because it changes where everyone lands. Runner up: any member, like any shared view edit.
2. **Should a member be able to make a shared view private?** Decided: only its creator, while still a member, and never the default view, so nobody can pull a view out from under the team. Runner up: owners and admins too.
3. **Should new attributes appear in every existing view?** Decided: no; only in the default views (which show everything) and in the view the attribute was created from. Runner up: every view, as spec 0012 AC-229 says today.
4. **View limits**: decided, 100 shared views per object and 50 private views per member per object. Plans (#38) may lower them.
5. **Order of a view with no sorts**: decided, newest first everywhere (spec 0006 AC-57), so AC-465 runs empty sorts as Created at descending.
6. **How private view changes travel live**: decided, through spec 0009's `filterEvent` `views` rule with this spec's facts and spec 0007 milestone 2's `planDelivery`: coarse on any channel whose members may not all see the view, and `data.views` answers a coarse event by refetching the object's list and the changed bodies it holds. No member channel, no special audience, and no write without an outbox row.
7. **A removed member's views**: decided, `removeMember` deletes their private views in its transaction and stores the `views` rows; shared views keep `creator_member_id`; "Make private" is disabled with "This view's creator has left the workspace."; the creator's name reads "A removed member".
