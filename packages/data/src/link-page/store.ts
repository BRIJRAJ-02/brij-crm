// The link page's blocks (spec 0051), as Settings › Account › Link page holds them: the person's own, the same in
// every workspace, read through `profile.items` when a screen first holds them. Every change shows at once and is
// sent one after another, so an order never reaches the server ahead of the add it names. What the screen draws is
// the server's last answer with the changes still on their way laid over it: a refused change simply leaves the
// list, which puts the rows back, and a toast says why, with Try again. Only the person edits their page, so no
// live event carries it; another tab's change shows when a screen next holds it, and an order made from a stale
// list is refused by the server and read again.
import type { ProfileBlock, ProfileCounts, ProfileItem, ProfileItems, ProfilePageChoice } from '@crm/contracts';
import {
  checkContactCard,
  checkProfileLink,
  linkMarkOf,
  PROFILE_LIMITS,
  PROFILE_LINK_ICONS,
  PROFILE_NOTE_MAX,
  PROFILE_TEXT_BREAKS,
  PROFILE_TEXT_MAX,
  PROFILE_TITLE_MAX,
  profileLimitSentence,
  profileLinkProblem,
  type ProfileBlockKind,
  type ProfileContactField,
} from '@crm/contracts/link-page';
import type { PROFILE_HUES } from '@crm/contracts/link-page';
import { toDataError, type DataError } from '../errors.ts';
import type { Notice } from '../notice.ts';

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
      /**
       * The page's views and each block's presses over 30 days (AC-5127), read beside the blocks; absent until they
       * arrive, or when their read failed (the figures are a nicety: the blocks never wait for them).
       */
      readonly counts?: ProfileCounts;
      /** The figures' read failed and there are none to show: the screen says so; Try again reads them again. */
      readonly countsFailed?: boolean;
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
  readonly counts: (input: { readonly workspace: string }) => Promise<ProfileCounts>;
  readonly pageChoices: (input: { readonly workspace: string }) => Promise<readonly ProfilePageChoice[]>;
  readonly saveItem: (input: {
    readonly workspace: string;
    readonly id: string;
    readonly block: ProfileBlock;
    readonly isEdit?: boolean;
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
  /**
   * A refusal's one sentence (`refusalSummary`), handed in by the data layer rather than imported, so this store's
   * chunk shares nothing with the first load but what the layer passes it.
   */
  readonly summary: (error: DataError) => string;
  /** The clock, in milliseconds; tests pass their own. */
  readonly now?: () => number;
}

/** The profile procedures the store calls, as the data layer's oRPC client answers them. */
interface ProfileProcedures {
  readonly items: (input: { workspace: string }, options: { signal?: AbortSignal }) => Promise<ProfileItems>;
  readonly counts: (input: { workspace: string }, options: { signal?: AbortSignal }) => Promise<ProfileCounts>;
  readonly pageChoices: (
    input: { workspace: string },
    options: { signal?: AbortSignal },
  ) => Promise<readonly ProfilePageChoice[]>;
  readonly saveItem: (
    input: { workspace: string; id: string; block: ProfileBlock; isEdit?: boolean; mutationId: string },
    options: { signal?: AbortSignal },
  ) => Promise<ProfileItem>;
  readonly orderItems: (
    input: { workspace: string; ids: string[]; mutationId: string },
    options: { signal?: AbortSignal },
  ) => Promise<ProfileItems>;
  readonly archiveItem: (
    input: { workspace: string; id: string; archived: boolean; mutationId: string },
    options: { signal?: AbortSignal },
  ) => Promise<ProfileItems>;
  readonly deleteItem: (
    input: { workspace: string; id: string; mutationId: string },
    options: { signal?: AbortSignal },
  ) => Promise<{ readonly id: string }>;
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
export type BlockProblems = Readonly<
  Partial<Record<'title' | 'url' | 'note' | 'icon' | 'page' | 'body' | ProfileContactField, string>>
>;

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
  | { readonly kind: 'text'; readonly title?: string; readonly body: string }
  | { readonly kind: 'page'; readonly workspaceId?: string; readonly pageId?: string }
  | ({ readonly kind: 'contact' } & Readonly<Partial<Record<ProfileContactField, string>>>);

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
 * No Zod: the store loads with the editor (its own chunk), and the server checks again with the schemas.
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
  if (draft.kind === 'contact') {
    const { kind: _kind, ...typed } = draft;
    const checked = checkContactCard(typed);
    return checked.ok
      ? { ok: true, block: { kind: 'contact', ...checked.card } }
      : { ok: false, problems: checked.problems };
  }
  if (draft.kind === 'text') {
    const text: Partial<Record<'title' | 'body', string>> = {};
    const kept = draft.title?.trim() ?? '';
    if (kept.length > PROFILE_TITLE_MAX.text) text.title = 'Keep the title to 60 characters.';
    else if (/[\r\n]/.test(kept)) text.title = 'Keep it to one line.';
    // A Windows paste arrives with \r\n; it is one break, not two, here and on the server alike.
    const body = draft.body.replaceAll('\r\n', '\n').trim();
    if (body === '') text.body = 'Write something, or leave the block out.';
    else if (body.length > PROFILE_TEXT_MAX) text.body = 'Keep it to 1,000 characters.';
    else if ((body.match(/\n/g) ?? []).length > PROFILE_TEXT_BREAKS) {
      text.body = 'Keep it to 20 line breaks. A longer piece reads better somewhere it can be a page.';
    }
    if (Object.keys(text).length > 0) return { ok: false, problems: text };
    return { ok: true, block: { kind: 'text', body, ...(kept === '' ? {} : { title: kept }) } };
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
  const now = deps.now ?? Date.now;
  // The blocks are the person's, the same in every workspace: one copy and one queue of writes, whichever
  // workspace a screen opens them from. The workspace only picks the route each call goes through.
  let held: ReturnType<typeof make> | undefined;
  let workspace = '';

  function make() {
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
    let counts: ProfileCounts | undefined;
    let countsFailed = false;
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
          ...(counts === undefined ? {} : { counts }),
          ...(countsFailed ? { countsFailed: true } : {}),
        };
      }
      for (const listener of listeners) listener();
    };

    // The figures: read when a screen holds the page (and on Try again), never with every read of the blocks, and
    // only the newest answer lands. A failed read keeps the last figures, or says they didn't load. They are not
    // live: a screen shows them as of when it opened, which is what a 30 day figure needs.
    let countsAsked = 0;
    let countsAt: number | undefined;
    const readCounts = () => {
      const asked = (countsAsked += 1);
      countsAt = now();
      deps.api.counts({ workspace }).then(
        (answer) => {
          if (asked !== countsAsked) return;
          counts = answer;
          countsFailed = false;
          if (confirmed !== undefined) show();
        },
        () => {
          if (asked !== countsAsked) return;
          countsAt = undefined;
          countsFailed = counts === undefined;
          if (confirmed !== undefined) show();
        },
      );
    };

    const read = (): Promise<ProfileItems> => {
      const asOf = landed;
      reading ??= deps.api
        .items({ workspace })
        .then(
          (answer) => {
            // A write landed while this read was out: its answer is newer, so this one lands nothing, and the lists
            // are read again once the writes waiting have gone, so a read meant to catch up still does.
            if (landed === asOf) {
              confirmed = { items: answer.items, archived: answer.archived };
              failed = undefined;
              readAt = now();
              show();
            } else {
              void queue.then(() => read()).catch(() => undefined);
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
            message: deps.summary(refusal),
            action: { label: TRY_AGAIN, onAction: () => void retry() },
          });
          // What failed may have been stale (another tab): read the server's lists again behind the toast.
          if (['CONFIG_INVALID', 'NOT_FOUND', 'LIMIT_REACHED'].includes(refusal.code))
            void read().catch(() => undefined);
          return false;
        } finally {
          pending = pending.filter((each) => each.id !== id);
          show();
        }
      });
      // A listener that throws never jams the writes after it.
      queue = sending.catch(() => false);
      return sending;
    };

    // The newest save of each block: Try again on an older one never puts its words back over a newer edit.
    const latestSave = new Map<string, number>();
    const save = (id: string, block: ProfileBlock, shown: ProfileItem): Promise<boolean> => {
      const isEdit = state.status === 'ready' && [...state.items, ...state.archived].some((item) => item.id === id);
      const ticket = made + 1;
      latestSave.set(id, ticket);
      return write(
        { show: upsert(shown), ...(isEdit ? {} : { adds: id }) },
        () => deps.api.saveItem({ workspace, id, block, ...(isEdit ? { isEdit } : {}), mutationId: deps.mintId() }),
        (lists, answer) => upsert(answer)(lists),
        () => (latestSave.get(id) === ticket ? save(id, block, shown) : Promise.resolve(false)),
      );
    };

    const order = (ids: readonly string[]): Promise<boolean> =>
      write(
        { show: ordered(ids) },
        // The ids are chosen when it is sent, from what the server holds by then (every write before it has landed):
        // an add that was refused meanwhile is left out rather than making the whole order stale.
        () => {
          const base = confirmed ?? { items: [], archived: [] };
          const sent = ordered(ids)(base).items.map((item) => item.id);
          return deps.api.orderItems({ workspace, ids: sent, mutationId: deps.mintId() });
        },
        (_lists, answer) => ({ items: answer.items, archived: answer.archived }),
        // Try again sends the order as the list stands then; with nothing left to order it sends nothing.
        () => {
          const now = state.status === 'ready' ? state.items.map((item) => item.id) : [];
          if (now.length === 0) return Promise.resolve(false);
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
        if (countsAt === undefined || now() - countsAt >= LINK_PAGE_FRESH_MS) readCounts();
        return () => undefined;
      },
      retry() {
        if (confirmed === undefined) {
          failed = undefined;
          show();
        }
        void read().catch(() => undefined);
        readCounts();
      },
    };
    return { holder, read, save, order, archive, remove };
  }

  const of = (opened: string) => {
    workspace = opened;
    held ??= make();
    return held;
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
    /** Signed out: forgets the copy. */
    clear: (): void => {
      held = undefined;
    },
  };
}

/**
 * The link page's store and its rules as the editor uses them, made once by the data layer the first time a screen
 * asks (`data.linkPage.load()`), so none of it rides in the app's first load.
 */
export function openLinkPage(given: {
  /** The profile procedures of the data layer's client. */
  readonly profile: ProfileProcedures;
  /** The data layer's one call path (retries, the session's end, refusals as DataError). */
  readonly call: <T>(run: (options: { readonly signal?: AbortSignal }) => Promise<T>) => Promise<T>;
  readonly mintId: () => string;
  readonly notify: (notice: Notice) => void;
  readonly summary: (error: DataError) => string;
}) {
  const { profile, call } = given;
  const deps: LinkPageDeps = {
    api: {
      items: (input) => call((options) => profile.items(input, options)),
      counts: (input) => call((options) => profile.counts(input, options)),
      pageChoices: (input) => call((options) => profile.pageChoices(input, options)),
      saveItem: (input) => call((options) => profile.saveItem(input, options)),
      orderItems: (input) => call((options) => profile.orderItems({ ...input, ids: [...input.ids] }, options)),
      archiveItem: (input) => call((options) => profile.archiveItem(input, options)),
      deleteItem: (input) => call((options) => profile.deleteItem(input, options)),
    },
    mintId: given.mintId,
    notify: given.notify,
    summary: given.summary,
  };
  const store = createLinkPageStore(deps);
  return {
    /** The blocks, held while a screen shows them (`useLinkPage`). */
    view: (workspace: string): LinkPageHeld => store.of(workspace),
    /** Reads them now (the route's loader); rejects with the refusal. */
    read: (workspace: string): Promise<void> => store.read(workspace).then(() => undefined),
    /** Adds or edits a block: `shown` at once, idempotent on `id`. Answers whether it landed. */
    save: store.save,
    /** The whole order of the live blocks. */
    order: store.order,
    /** Archives a block, or restores it to the end. */
    archive: store.archive,
    /** Deletes a block for good (the screen asks first). */
    remove: store.remove,
    /** The booking pages the person may still place, from every workspace, read fresh each time. */
    pageChoices: store.pageChoices,
    /** A block as typed, checked as the server will: each field's problem, or the block to send. */
    check: checkBlock,
    /** Whether one more block of a kind fits: undefined, or the limit's sentence. */
    limit: blockLimit,
    /** The network whose mark a link's address shows, as the server will answer it. */
    markOf: linkMarkOf,
    /** The icons a link may pick, in the order the editor offers them. */
    icons: PROFILE_LINK_ICONS,
    /** A new block's id. */
    newId: (): string => deps.mintId(),
    /** Signed out: forgets the copy. */
    clear: store.clear,
  };
}

/** The link page's store, as `data.linkPage.load()` answers it. */
export type LinkPageStore = ReturnType<typeof openLinkPage>;
