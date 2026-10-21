// The sidebar (spec 0034): each member's stored choices for it in one
// workspace (order, hidden items, favourites, folded sections, section order
// and the rail), read resolved through the access door (`nav.get`) and
// changed one small operation at a time (`nav.change`). The model and the
// pure apply rule live in `nav-model.ts` (`@crm/contracts/navigation`), with
// no Zod, so the browser applies a change before the answer comes.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { NAV_ITEM_KINDS, NAV_PAGES, NAV_SECTIONS, NAV_STARRABLE_KINDS } from './nav-model.ts';
import { Hue } from './values/hues.ts';
import { Uuid } from './values/ids.ts';
import { ObjectIcon } from './values/object-icons.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** One of the sidebar's sections. */
export const NavSection = z.enum(NAV_SECTIONS);
/** One of the sidebar's sections. */
export type NavSection = z.infer<typeof NavSection>;

/** A page the sidebar stores choices for (Inbox, Tasks, Bookings and Captures). */
export const NavPageKey = z.enum(NAV_PAGES);
/** A page the sidebar stores choices for. */
export type NavPageKey = z.infer<typeof NavPageKey>;

/** What a stored item points at. */
const itemKind = z.enum(NAV_ITEM_KINDS);

const isUuid = (value: string) => Uuid.safeParse(value).success;

/** A page's key for `page`, else a uuid: the one check every item operation shares. */
function checkRef(ref: { readonly kind: string; readonly id: string }, ctx: z.RefinementCtx): void {
  const fits = ref.kind === 'page' ? (NAV_PAGES as readonly string[]).includes(ref.id) : isUuid(ref.id);
  if (!fits) ctx.addIssue({ code: 'custom', path: ['id'], message: 'That item doesn’t exist.' });
}

const item = {
  kind: itemKind,
  id: z.string().min(1).max(64),
};
const starrable = {
  kind: z.enum(NAV_STARRABLE_KINDS),
  id: Uuid,
};

const Index = z.number().int().min(0).max(1_000);

/**
 * One change to the member's sidebar (AC-938): a move inside a section, hide
 * or show, star or unstar, fold, a section move, the rail, or a reset.
 * Each is applied to the stored row under its lock, so two tabs changing
 * different things at once both keep their change. A page is named by its
 * key, anything else by its id.
 */
export const NavOp = z
  .discriminatedUnion('op', [
    z.object({ op: z.literal('move'), ...item, toIndex: Index }),
    z.object({ op: z.literal('hide'), ...item }),
    z.object({ op: z.literal('show'), ...item }),
    z.object({ op: z.literal('star'), ...starrable }),
    z.object({ op: z.literal('unstar'), ...starrable }),
    z.object({ op: z.literal('fold'), section: NavSection, folded: z.boolean() }),
    z.object({ op: z.literal('moveSection'), section: NavSection, toIndex: Index }),
    z.object({ op: z.literal('rail'), on: z.boolean() }),
    z.object({ op: z.literal('reset') }),
  ])
  .superRefine((op, ctx) => {
    if ('kind' in op) checkRef(op, ctx);
  })
  // Ids leave in lower case, the spelling every policy and stored item is keyed by (spec 0009); a page keeps its key.
  .transform((op) => ('kind' in op && op.kind !== 'page' ? { ...op, id: op.id.toLowerCase() } : op));
/** One change to the member's sidebar. */
export type NavOp = z.infer<typeof NavOp>;

/** One stored item, as it leaves the server: only items that resolve for the reader. */
export const NavItemPrefOut = z.object({
  kind: itemKind,
  id: z.string(),
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
});

/**
 * A favourite the reader may read, resolved on the server (AC-925, AC-939):
 * a view with its name and its object, or a record with its display name and
 * its object. One they can't read, or that is in the trash, isn't listed.
 */
export const NavFavourite = z.object({
  kind: z.enum(['view', 'record']),
  id: Uuid,
  /** The view's name, or the record's display name ("" when it has none: the screen says "Unnamed"). */
  label: z.string(),
  objectId: Uuid,
  /** The object's API name, for the item's address. */
  objectSlug: z.string(),
  /** The object's plural name: a view's `meta` ("Companies"). */
  objectName: z.string(),
  /** The object's singular name: an unnamed record's "Unnamed person". */
  objectSingularName: z.string(),
  icon: ObjectIcon,
  hue: Hue,
});
/** A favourite the reader may read. */
export type NavFavourite = z.infer<typeof NavFavourite>;

/**
 * The member's sidebar, resolved through the access door (AC-936, AC-939):
 * their stored items that resolve (nothing they can't read, by name or id),
 * the section order and folds, the rail, the starred items resolved, which
 * pages exist for them above the sections and under Scheduling, and the
 * row's `version` (0 with nothing stored), which the browser uses to ignore
 * a stale answer.
 */
export const NavState = z.object({
  items: z.array(NavItemPrefOut),
  sections: z.object({ order: z.array(NavSection), folded: z.array(NavSection) }),
  rail: z.boolean(),
  version: z.number().int().min(0),
  favourites: z.array(NavFavourite),
  /** The pages above the sections (AC-924): Tasks for every member; Inbox joins once notifications (#28) exist. */
  top: z.array(NavPageKey),
  /** The Scheduling pages the member's role may open (AC-928): all four, none for a guest. */
  scheduling: z.array(NavPageKey),
});
/** The member's sidebar, resolved. */
export type NavState = z.infer<typeof NavState>;

/** Reading the member's own sidebar in a workspace: nothing but the workspace. */
export const GetNavInput = WorkspaceScoped;
/** Reading the member's own sidebar. */
export type GetNavInput = z.infer<typeof GetNavInput>;

/** One change to the member's own sidebar; `mutationId` lets the tab that sent it skip its own `nav` event. */
export const ChangeNavInput = WorkspaceScoped.extend({
  op: NavOp,
  mutationId: Uuid,
});
/** One change to the member's own sidebar. */
export type ChangeNavInput = z.infer<typeof ChangeNavInput>;

/** What a change answers: the row's new version. */
export const NavChanged = z.object({ version: z.number().int().min(1) });
/** What a change answers. */
export type NavChanged = z.infer<typeof NavChanged>;

/**
 * The sidebar (spec 0034). `get` answers the caller's own sidebar resolved
 * through the door. `change` applies one operation to the caller's own row
 * (never anyone else's; it takes no member id) and stores one `nav` event
 * naming them: 409 `NAV_LIMIT` past 50 favourites or 400 items, 404
 * `NOT_FOUND` when starring a view or record that doesn't exist or that the
 * caller can't read (the same answer for both), 422 `CONFIG_INVALID` for
 * hiding or starring a kind that can't be.
 */
export const navContract = {
  get: oc.input(GetNavInput).output(NavState),
  change: oc.input(ChangeNavInput).output(NavChanged),
};
