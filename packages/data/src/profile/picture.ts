// Whether the signed in person's account picture shows on their public pages (owner ask A124, 23 Oct 2026): their
// booking pages and `/<handle>` profile show initials while it is off. The person's own, the same in every
// workspace, read with their profile: `profile.get` (Settings › Profile's loader) reads through here, so the screen
// held right after it needs no read of its own. A change shows at once and is sent, one after another; refused, it
// is put back and a toast says why, with Try again. Only the person holds it, so no live event carries it: another
// device's change shows when a screen next holds it.
import type { MyProfile, UpdateMyProfileInput } from '@crm/contracts';
import { refusalSummary, toDataError } from '../errors.ts';
import type { Notice } from '../notice.ts';

/** The person's picture choice as a screen holds it. */
export type PictureChoiceState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready';
      /** The picture stays off their public pages: the latest change on its way, else what the server said. */
      readonly isHidden: boolean;
      /** A change is on its way. */
      readonly isSaving: boolean;
      /** False for a member with no sign in of their own, who has no picture to hide. */
      readonly canChange: boolean;
    };

/** One workspace's copy of the choice, read when first held. */
export interface PictureChoiceHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => PictureChoiceState;
  readonly retain: () => () => void;
  /** Reads it again after a read failed (Try again). */
  readonly retry: () => void;
}

/** What the store calls on the API: the profile's read and its update. */
export interface PictureChoiceApi {
  readonly get: (input: { readonly workspace: string }) => Promise<MyProfile>;
  readonly update: (input: UpdateMyProfileInput) => Promise<MyProfile>;
}

/** What the store is made with. */
export interface PictureChoiceDeps {
  readonly api: PictureChoiceApi;
  readonly mintId: () => string;
  readonly notify: (notice: Notice) => void;
  /** The clock, in milliseconds; tests pass their own. */
  readonly now?: () => number;
}

/** A read this recent serves a new holder as it is: the route's loader and the screen it opens hold it together. */
export const PICTURE_CHOICE_FRESH_MS = 1_000;

/** The refusal toast's action, which sends the refused change once more. */
const TRY_AGAIN = 'Try again';

/** The person's picture choice in each workspace, and their profile's reads. */
export function createPictureChoiceStore(deps: PictureChoiceDeps) {
  const held = new Map<string, ReturnType<typeof make>>();
  const now = deps.now ?? Date.now;

  function make(workspace: string) {
    let state: PictureChoiceState = { status: 'loading' };
    let reading: Promise<MyProfile> | undefined;
    let readAt: number | undefined;
    // What the server last said, and the changes still on their way, oldest first: the screen shows the latest.
    let confirmed: { readonly isHidden: boolean; readonly canChange: boolean } | undefined;
    let inFlight: readonly { readonly id: number; readonly isHidden: boolean }[] = [];
    let queue: Promise<unknown> = Promise.resolve();
    let made = 0;
    // Changes landed so far: a read sent before one landed never puts its older answer over it.
    let landed = 0;
    const listeners = new Set<() => void>();
    const set = (next: PictureChoiceState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const show = () => {
      if (confirmed === undefined) return;
      set({
        status: 'ready',
        isHidden: inFlight.at(-1)?.isHidden ?? confirmed.isHidden,
        isSaving: inFlight.length > 0,
        canChange: confirmed.canChange,
      });
    };
    const confirm = (profile: MyProfile) => {
      confirmed = { isHidden: profile.pictureHidden === true, canChange: profile.pictureHidden !== undefined };
      readAt = now();
      show();
    };
    const read = (): Promise<MyProfile> => {
      const asOf = landed;
      reading ??= deps.api
        .get({ workspace })
        .then(
          (profile) => {
            if (landed === asOf) confirm(profile);
            return profile;
          },
          (error: unknown) => {
            const refusal = toDataError(error);
            if (state.status !== 'ready') set({ status: 'error', message: refusal.message });
            throw refusal;
          },
        )
        .finally(() => {
          reading = undefined;
        });
      return reading;
    };
    const change = (isHidden: boolean): Promise<boolean> => {
      if (state.status !== 'ready' || !state.canChange) return Promise.resolve(false);
      if (state.isHidden === isHidden) return Promise.resolve(true);
      made += 1;
      const id = made;
      inFlight = [...inFlight, { id, isHidden }];
      show();
      const sending = queue.then(async () => {
        try {
          const answer = await deps.api.update({ workspace, pictureHidden: isHidden, mutationId: deps.mintId() });
          landed += 1;
          confirm(answer);
          return true;
        } catch (error) {
          // Put back below, as the change leaves the list; Try again sends it once more.
          deps.notify({
            tone: 'danger',
            message: refusalSummary(toDataError(error)),
            action: { label: TRY_AGAIN, onAction: () => void change(isHidden) },
          });
          return false;
        } finally {
          inFlight = inFlight.filter((each) => each.id !== id);
          show();
        }
      });
      queue = sending;
      return sending;
    };
    const holder: PictureChoiceHeld = {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain() {
        // Read again whenever a screen holds it, so another device's change shows on the next visit; a read that
        // just landed (the loader's, for the screen it opens) already is that visit's.
        if (readAt === undefined || now() - readAt >= PICTURE_CHOICE_FRESH_MS) void read().catch(() => undefined);
        return () => undefined;
      },
      retry() {
        if (state.status === 'error') set({ status: 'loading' });
        void read().catch(() => undefined);
      },
    };
    return { holder, read, change };
  }

  const of = (workspace: string) => {
    const found = held.get(workspace);
    if (found !== undefined) return found;
    const made = make(workspace);
    held.set(workspace, made);
    return made;
  };

  return {
    /** The choice in a workspace, read when a screen first holds it. */
    of: (workspace: string): PictureChoiceHeld => of(workspace).holder,
    /** Reads the caller's profile now (a route loader), the choice with it; rejects with the refusal. */
    read: (workspace: string): Promise<MyProfile> => of(workspace).read(),
    /**
     * Keeps the picture off (`true`) or shows it again, at once; put back with a toast and Try again if refused.
     * Answers whether it landed; false, with nothing sent, while unread or for a member who can't change it.
     */
    change: (workspace: string, isHidden: boolean): Promise<boolean> => of(workspace).change(isHidden),
    /** Signed out: forgets every workspace's copy. */
    clear: (): void => {
      held.clear();
    },
  };
}
