// The link page's blocks (spec 0051), as Settings › Account › Link page holds them: the person's own, the same in
// every workspace, read through `profile.items` when a screen first holds them. Every change shows at once and is
// sent one after another, so an order never reaches the server ahead of the add it names. What the screen draws is
// the server's last answer with the changes still on their way laid over it: a refused change simply leaves the
// list, which puts the rows back, and a toast says why, with Try again. Only the person edits their page, so no
// live event carries it; another tab's change shows when a screen next holds it, and an order made from a stale
// list is refused by the server and read again.
import type { ProfileBlock, ProfileItem, ProfileItems, ProfilePageChoice } from '@crm/contracts';
import {
  checkProfileLink,
  PROFILE_LIMITS,
  PROFILE_LINK_ICONS,
  PROFILE_NOTE_MAX,
  PROFILE_TITLE_MAX,
  profileLimitSentence,
  profileLinkProblem,
  type ProfileBlockKind,
} from '@crm/contracts/link-page';
import type { PROFILE_HUES } from '@crm/contracts/link-page';
import { toDataError, type DataError } from '../errors.ts';
import type { Notice } from '../notice.ts';
import { refusalSummary } from '../refusals.ts';

/** The blocks as a screen holds them. */
export type LinkPageState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: DataError }
  | {
      readonly status: 'ready';
      /** The live blocks, in order, with the changes on their way shown. */
      readonly items: readonly ProfileItem[];
      /** The archived ones, newest first. */
      readonly archived: readonly ProfileItem[];
      /** Blocks shown before the server made them: drawn, but their menu waits. */
      readonly pendingIds: ReadonlySet<string>;
      /** A change is on its way. */
      readonly isSaving: boolean;
    };

/** One workspace's copy of the blocks, as a screen retains it. */
export interface LinkPageHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => LinkPageState;
  /** Held while a screen shows it; read when first held, unless a read just landed. */
  readonly retain: () => () => void;
  /** Reads it again (Try again, or after a refusal). */
  readonly retry: () => void;
}

/** What the store calls on the API. */
export interface LinkPageApi {
  readonly items: (input: { readonly workspace: string }) => Promise<ProfileItems>;
  readonly pageChoices: (input: { readonly workspace: string }) => Promise<readonly ProfilePageChoice[]>;
  readonly saveItem: (input: {
    readonly workspace: string;
    readonly id: string;
    readonly block: ProfileBlock;
    readonly mutationId: string;
  }) => Promise<ProfileItem>;
  readonly orderItems: (input: {
    readonly workspace: string;
    readonly ids: readonly string[];
    readonly mutationId: string;
  }) => Promise<ProfileItems>;
  readonly archiveItem: (input: {
    readonly workspace: string;
    readonly id: string;
    readonly archived: boolean;
    readonly mutationId: string;
  }) => Promise<ProfileItems>;
  readonly deleteItem: (input: {
    readonly workspace: string;
    readonly id: string;
    readonly mutationId: string;
  }) => Promise<{ readonly id: string }>;
}

/** What the store is made with. */
export interface LinkPageDeps {
  readonly api: LinkPageApi;
  readonly mintId: () => string;
  readonly notify: (notice: Notice) => void;
  /** The clock, in milliseconds; tests pass their own. */
  readonly now?: () => number;
}

/** A read this recent serves a new holder as it is: the route's loader and the screen it opens hold it together. */
export const LINK_PAGE_FRESH_MS = 1_000;

/** Both lists as the server last said them. */
interface Lists {
  readonly items: readonly ProfileItem[];
  readonly archived: readonly ProfileItem[];
}

/** One change on its way: how it shows, and the block it adds before the server made it, if any. */
interface Pending {
  readonly id: number;
  readonly show: (lists: Lists) => Lists;
  readonly adds?: string;
}

/** Why a block can't be saved as typed, by field: the same rules the server keeps, said before anything is sent. */
export type BlockProblems = Readonly<Partial<Record<'title' | 'url' | 'note' | 'icon' | 'page', string>>>;

/** The refusal toast's action. */
const TRY_AGAIN = 'Try again';

/** The lists with `item` in place of the block with its id, or at the end of the live ones. */
function upsert(item: ProfileItem): (lists: Lists) => Lists {
  return (lists) =>
    lists.items.some((each) => each.id === item.id)
      ? { ...lists, items: lists.items.map((each) => (each.id === item.id ? item : each)) }
      : { items: [...lists.items, item], archived: lists.archived.filter((each) => each.id !== item.id) };
}

/** The live blocks in the order `ids` names; any it leaves out keep their places after them. */
function ordered(ids: readonly string[]): (lists: Lists) => Lists {
  return (lists) => {
    const at = new Map(ids.map((id, index) => [id, index]));
    const named = lists.items.filter((item) => at.has(item.id));
    const rest = lists.items.filter((item) => !at.has(item.id));
    named.sort((left, right) => (at.get(left.id) ?? 0) - (at.get(right.id) ?? 0));
    return { ...lists, items: [...named, ...rest] };
  };
}

/** The block `id` names moved to the archived list (archived) or to the end of the live one. */
function archivedAs(id: string, archived: boolean): (lists: Lists) => Lists {
  return (lists) => {
    if (archived) {
      const item = lists.items.find((each) => each.id === id);
      if (item === undefined) return lists;
      return {
        items: lists.items.filter((each) => each.id !== id),
        archived: [{ ...item, archivedAt: new Date().toISOString() }, ...lists.archived],
      };
    }
    const item = lists.archived.find((each) => each.id === id);
    if (item === undefined) return lists;
    const { archivedAt: _gone, ...live } = item;
    return {
      items: [...lists.items, live],
      archived: lists.archived.filter((each) => each.id !== id),
    };
  };
}

/** The lists without the block `id` names. */
function dropped(id: string): (lists: Lists) => Lists {
  return (lists) => ({
    items: lists.items.filter((each) => each.id !== id),
    archived: lists.archived.filter((each) => each.id !== id),
  });
}

/** How many live blocks of a kind there are. */
const countOf = (items: readonly ProfileItem[], kind: ProfileBlockKind) =>
  items.filter((item) => item.kind === kind).length;

/**
 * Whether one more block of `kind` fits (AC-5102): undefined when it does, else the limit's sentence, which the Add
 * menu disables the kind with and the server refuses with.
 */
export function blockLimit(items: readonly ProfileItem[], kind: ProfileBlockKind): string | undefined {
  if (items.length >= PROFILE_LIMITS.items) return profileLimitSentence('items');
  return countOf(items, kind) >= PROFILE_LIMITS[kind] ? profileLimitSentence(kind) : undefined;
}

/** A block as the editor's Modal has it, before it is checked. */
export type BlockDraft =
  | {
      readonly kind: 'link';
      readonly title: string;
      readonly url: string;
      readonly note: string;
      readonly icon?: string;
      readonly hue?: (typeof PROFILE_HUES)[number];
    }
  | { readonly kind: 'heading'; readonly title: string }
  | { readonly kind: 'page'; readonly workspaceId?: string; readonly pageId?: string };

/** A title's problem: present, one line, and short enough for its kind. */
function titleProblem(title: string, kind: 'link' | 'heading'): string | undefined {
  const trimmed = title.trim();
  if (trimmed === '') return kind === 'link' ? 'Give the link a title.' : 'Give the heading a title.';
  if (/[\r\n]/.test(trimmed)) return 'Keep it to one line.';
  if (trimmed.length > PROFILE_TITLE_MAX[kind]) {
    return kind === 'link' ? 'Keep the title to 60 characters.' : 'Keep the heading to 40 characters.';
  }
  return undefined;
}

/**
 * A block as typed, checked by the rules the server keeps (its kind's lengths, the address rule, a heading's text
 * once, ignoring case and surrounding spaces, among the blocks held): each field's problem, or the block to send.
 * No Zod: this runs in the first load's layer, and the server checks again with the schemas.
 */
export function checkBlock(
  draft: BlockDraft,
  items: readonly ProfileItem[],
  editing?: string,
): { readonly ok: true; readonly block: ProfileBlock } | { readonly ok: false; readonly problems: BlockProblems } {
  if (draft.kind === 'page') {
    if (draft.workspaceId === undefined || draft.pageId === undefined) {
      return { ok: false, problems: { page: 'Pick a booking page.' } };
    }
    return { ok: true, block: { kind: 'page', workspaceId: draft.workspaceId, pageId: draft.pageId } };
  }
  const problems: Partial<Record<'title' | 'url' | 'note' | 'icon' | 'page', string>> = {};
  const title = titleProblem(draft.title, draft.kind);
  if (title !== undefined) problems.title = title;
  if (draft.kind === 'heading') {
    const key = draft.title.trim().toLowerCase();
    const twin = items.some(
      (item) => item.kind === 'heading' && item.id !== editing && item.title.trim().toLowerCase() === key,
    );
    if (problems.title === undefined && twin) problems.title = 'You already have a heading called that.';
    if (problems.title !== undefined) return { ok: false, problems };
    return { ok: true, block: { kind: 'heading', title: draft.title.trim() } };
  }
  const checked = checkProfileLink(draft.url);
  if (!checked.ok) problems.url = profileLinkProblem(checked.reason);
  const note = draft.note.trim();
  if (note.length > PROFILE_NOTE_MAX) problems.note = 'Keep the note to 120 characters.';
  else if (/[\r\n]/.test(note)) problems.note = 'Keep it to one line.';
  const icon = PROFILE_LINK_ICONS.find((each) => each === draft.icon);
  if (draft.icon !== undefined && icon === undefined) problems.icon = 'Pick one of the icons.';
  if (Object.keys(problems).length > 0 || !checked.ok) return { ok: false, problems };
  return {
    ok: true,
    block: {
      kind: 'link',
      title: draft.title.trim(),
      url: checked.url,
      ...(note === '' ? {} : { note }),
      ...(icon === undefined ? {} : { icon }),
      ...(draft.hue === undefined ? {} : { hue: draft.hue }),
    },
  };
}

/** The person's link page in each workspace they open it from, and its writes. */
export function createLinkPageStore(deps: LinkPageDeps) {
  const held = new Map<string, ReturnType<typeof make>>();
  const now = deps.now ?? Date.now;

  function make(workspace: string) {
    let confirmed: Lists | undefined;
    let failed: DataError | undefined;
    let pending: readonly Pending[] = [];
    let reading: Promise<ProfileItems> | undefined;
    let readAt: number | undefined;
    let queue: Promise<unknown> = Promise.resolve();
    let made = 0;
    // Writes landed so far: a read sent before one landed never puts its older answer over it.
    let landed = 0;
    let state: LinkPageState = { status: 'loading' };
    const listeners = new Set<() => void>();

    const show = () => {
      if (confirmed === undefined) {
        state = failed === undefined ? { status: 'loading' } : { status: 'error', error: failed };
      } else {
        const lists = pending.reduce((shown, change) => change.show(shown), confirmed);
        state = {
          status: 'ready',
          items: lists.items,
          archived: lists.archived,
          pendingIds: new Set(pending.flatMap((change) => (change.adds === undefined ? [] : [change.adds]))),
          isSaving: pending.length > 0,
        };
      }
      for (const listener of listeners) listener();
    };

    const read = (): Promise<ProfileItems> => {
      const asOf = landed;
      reading ??= deps.api
        .items({ workspace })
        .then(
          (answer) => {
            // A write landed while this read was out: its answer is newer, so this one lands nothing.
            if (landed === asOf) {
              confirmed = { items: answer.items, archived: answer.archived };
              failed = undefined;
              readAt = now();
              show();
            }
            return answer;
          },
          (error: unknown) => {
            const refusal = toDataError(error);
            if (confirmed === undefined) {
              failed = refusal;
              show();
            }
            throw refusal;
          },
        )
        .finally(() => {
          reading = undefined;
        });
      return reading;
    };

    /**
     * Shows a change at once and sends it after every change before it. Its answer becomes what the server holds;
     * refused, it leaves the list (putting it back) and a toast says why, with Try again.
     */
    const write = <Answer>(
      change: Omit<Pending, 'id'>,
      send: () => Promise<Answer>,
      land: (lists: Lists, answer: Answer) => Lists,
      retry: () => Promise<boolean>,
    ): Promise<boolean> => {
      made += 1;
      const id = made;
      pending = [...pending, { id, ...change }];
      show();
      const sending = queue.then(async () => {
        try {
          const answer = await send();
          landed += 1;
          if (confirmed !== undefined) confirmed = land(confirmed, answer);
          return true;
        } catch (error) {
          const refusal = toDataError(error);
          deps.notify({
            tone: 'danger',
            message: refusalSummary(refusal),
            action: { label: TRY_AGAIN, onAction: () => void retry() },
          });
          // What failed may have been stale (another tab): read the server's lists again behind the toast.
          if (refusal.code === 'CONFIG_INVALID' || refusal.code === 'NOT_FOUND') void read().catch(() => undefined);
          return false;
        } finally {
          pending = pending.filter((each) => each.id !== id);
          show();
        }
      });
      queue = sending;
      return sending;
    };

    const save = (id: string, block: ProfileBlock, shown: ProfileItem): Promise<boolean> =>
      write(
        {
          show: upsert(shown),
          ...(state.status === 'ready' && !state.items.some((item) => item.id === id) ? { adds: id } : {}),
        },
        () => deps.api.saveItem({ workspace, id, block, mutationId: deps.mintId() }),
        (lists, answer) => upsert(answer)(lists),
        () => save(id, block, shown),
      );

    const order = (ids: readonly string[]): Promise<boolean> =>
      write(
        { show: ordered(ids) },
        () => deps.api.orderItems({ workspace, ids, mutationId: deps.mintId() }),
        (_lists, answer) => ({ items: answer.items, archived: answer.archived }),
        // Try again sends the order as the list stands then, so it never names a block that left meanwhile.
        () => {
          const now = state.status === 'ready' ? state.items.map((item) => item.id) : [];
          const kept = ids.filter((each) => now.includes(each));
          return order([...kept, ...now.filter((each) => !kept.includes(each))]);
        },
      );

    const archive = (id: string, archived: boolean): Promise<boolean> =>
      write(
        { show: archivedAs(id, archived) },
        () => deps.api.archiveItem({ workspace, id, archived, mutationId: deps.mintId() }),
        (_lists, answer) => ({ items: answer.items, archived: answer.archived }),
        () => archive(id, archived),
      );

    const remove = (id: string): Promise<boolean> =>
      write(
        { show: dropped(id) },
        () => deps.api.deleteItem({ workspace, id, mutationId: deps.mintId() }),
        (lists) => dropped(id)(lists),
        () => remove(id),
      );

    const holder: LinkPageHeld = {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain() {
        if (readAt === undefined || now() - readAt >= LINK_PAGE_FRESH_MS) void read().catch(() => undefined);
        return () => undefined;
      },
      retry() {
        if (confirmed === undefined) {
          failed = undefined;
          show();
        }
        void read().catch(() => undefined);
      },
    };
    return { holder, read, save, order, archive, remove };
  }

  const of = (workspace: string) => {
    const found = held.get(workspace);
    if (found !== undefined) return found;
    const fresh = make(workspace);
    held.set(workspace, fresh);
    return fresh;
  };

  return {
    /** The blocks, read when a screen first holds them. */
    of: (workspace: string): LinkPageHeld => of(workspace).holder,
    /** Reads them now (a route loader); rejects with the refusal. */
    read: (workspace: string): Promise<ProfileItems> => of(workspace).read(),
    /**
     * Adds or edits one block: `shown` at once (a new one at the end), sent after every change before it, idempotent
     * on `id`. Answers whether it landed; refused, it is put back and a toast says why.
     */
    save: (workspace: string, id: string, block: ProfileBlock, shown: ProfileItem): Promise<boolean> =>
      of(workspace).save(id, block, shown),
    /** Sets the whole order of the live blocks at once. */
    order: (workspace: string, ids: readonly string[]): Promise<boolean> => of(workspace).order(ids),
    /** Archives a block (it leaves the page at once), or restores it to the end. */
    archive: (workspace: string, id: string, archived: boolean): Promise<boolean> =>
      of(workspace).archive(id, archived),
    /** Deletes a block for good (the screen asks first). */
    remove: (workspace: string, id: string): Promise<boolean> => of(workspace).remove(id),
    /** The booking pages the person may still place, from every workspace, read fresh each time it is asked. */
    pageChoices: (workspace: string): Promise<readonly ProfilePageChoice[]> =>
      deps.api.pageChoices({ workspace }).catch((error: unknown) => {
        throw toDataError(error);
      }),
    /** Signed out: forgets every workspace's copy. */
    clear: (): void => {
      held.clear();
    },
  };
}
