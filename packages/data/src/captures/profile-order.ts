// A profile's order (owner ask A102, 22 Oct 2026): Settings › Profile's moves, each the whole order of the owner's
// Public pages, shown at once in the held booking pages list (the one copy every screen reads) and sent one at a
// time, so the server always ends on the newest order. A move made while another is on its way waits, replacing any
// move already waiting: each carries the whole order, so the newest holds every change made before it. When the
// last move lands, its answer (each page's place and version) is put in place. When it is refused, the list goes
// back to the order the server last confirmed, and only that move rejects, so a screen says so once.
import type { BookingPageView, ProfileOrder } from '@crm/contracts';
import type { CaptureListStore, ItemsChange } from './list.ts';

/**
 * How a move came out: `saved`, its order is the server's now; or `replaced`, a later move took it over (it was
 * waiting, or it was sent and a later one went after it) and settles for both.
 */
export type ProfileMoveOutcome = 'saved' | 'replaced';

/** What the profile order needs: the held booking pages list, and the one write that sends an order. */
export interface ProfileOrderDeps {
  readonly list: Pick<CaptureListStore<BookingPageView>, 'items' | 'write'>;
  readonly send: (workspace: string, pageIds: readonly string[]) => Promise<ProfileOrder>;
}

/** A move as the run holds it: its order, and how to settle it. */
interface Move {
  readonly ids: readonly string[];
  readonly resolve: (settled: Settled) => void;
  readonly reject: (error: unknown) => void;
}

/** What a move's list write lands: the server's answer, or nothing for a move a later one took over. */
interface Settled {
  readonly answer?: ProfileOrder;
}

/** One workspace's moves, from the first until the last one settles. */
interface Run {
  /** The places the server holds, as last known: what a refusal puts back. */
  confirmed: ReadonlyMap<string, number>;
  isSending: boolean;
  waiting: Move | undefined;
}

/** The pages named at 0, 1, 2 … in the order given; every other page as it was. */
function placed(ids: readonly string[]): ItemsChange<BookingPageView> {
  const at = new Map(ids.map((id, index) => [id, index]));
  return (items) =>
    items.map((page) => {
      const position = at.get(page.id);
      return position === undefined || position === page.profilePosition
        ? page
        : { ...page, profilePosition: position };
    });
}

/** Every page the answer placed, at its place and version. */
function landed(answer: ProfileOrder): ItemsChange<BookingPageView> {
  const places = new Map(answer.pages.map((place) => [place.id, place]));
  return (items) =>
    items.map((page) => {
      const place = places.get(page.id);
      return place === undefined
        ? page
        : { ...page, profilePosition: place.profilePosition, updatedAt: place.updatedAt };
    });
}

/**
 * The profile order for every workspace: `reorder(workspace, pageIds)` shows the order at once and settles as the
 * module's header says; `clear()` forgets every run (sign out).
 */
export function createProfileOrder(deps: ProfileOrderDeps) {
  const runs = new Map<string, Run>();

  /** The places the server last confirmed, back on the pages that hold another. */
  const restore =
    (run: Run): ItemsChange<BookingPageView> =>
    (items) =>
      items.map((page) => {
        const position = run.confirmed.get(page.id);
        return position === undefined || position === page.profilePosition
          ? page
          : { ...page, profilePosition: position };
      });

  /** After a send settles: the move waiting goes next and this one is replaced, else the run ends with this one. */
  const afterSend = (workspace: string, run: Run, last: () => void, replaced: () => void) => {
    const waiting = run.waiting;
    run.waiting = undefined;
    if (waiting === undefined) {
      run.isSending = false;
      if (runs.get(workspace) === run) runs.delete(workspace);
      last();
      return;
    }
    replaced();
    send(workspace, run, waiting);
  };

  const send = (workspace: string, run: Run, move: Move) => {
    run.isSending = true;
    deps.send(workspace, move.ids).then(
      (answer) => {
        run.confirmed = new Map([
          ...run.confirmed,
          ...answer.pages.map((place) => [place.id, place.profilePosition] as const),
        ]);
        afterSend(
          workspace,
          run,
          () => move.resolve({ answer }),
          () => move.resolve({}),
        );
      },
      (error: unknown) => {
        // A later move carries this one's change: it goes on, and its outcome is both moves'.
        afterSend(
          workspace,
          run,
          () => move.reject(error),
          () => move.resolve({}),
        );
      },
    );
  };

  return {
    /** Puts the owner's pages in this order: at once in the list, then on the server, one move at a time. */
    reorder(workspace: string, pageIds: readonly string[]): Promise<ProfileMoveOutcome> {
      const ids = [...pageIds];
      // A run starts from the list as it stands, before this move shows: what the server holds.
      const run = runs.get(workspace) ?? {
        confirmed: new Map((deps.list.items(workspace) ?? []).map((page) => [page.id, page.profilePosition])),
        isSending: false,
        waiting: undefined,
      };
      runs.set(workspace, run);
      return deps.list
        .write<Settled>(workspace, {
          show: placed(ids),
          undo: restore(run),
          send: () =>
            new Promise<Settled>((resolve, reject) => {
              const move: Move = { ids, resolve, reject };
              if (!run.isSending) {
                send(workspace, run, move);
                return;
              }
              // The move already waiting is carried by this one, which holds its change too.
              run.waiting?.resolve({});
              run.waiting = move;
            }),
          land: (items, settled) => (settled.answer === undefined ? items : landed(settled.answer)(items)),
        })
        .then((settled) => (settled.answer === undefined ? 'replaced' : 'saved'));
    },
    /** Forgets every run (sign out): a move on its way settles as it would; one waiting is dropped, sent never. */
    clear() {
      for (const run of runs.values()) {
        run.waiting?.resolve({});
        run.waiting = undefined;
      }
      runs.clear();
    },
  };
}
