// The signed in person's own social links (booking socials, 25 Oct 2026): LinkedIn, X, their website and the rest,
// shown on their booking pages and their `/<handle>` profile. The person's, the same in every workspace, read with
// their profile: `profile.get` (Settings › Profile's loader) confirms the set held here, so a screen held right after
// it needs no read of its own. A change of the whole set shows at once and is sent, one after another; refused, it is
// put back and a toast says why, with Try again. Settings › Profile's own Save sends the set with the rest of the
// page and confirms it here when it lands. Only the person holds it, so no live event carries it: another device's
// change shows when a screen next holds it.
import type { MyProfile, SocialLink, UpdateMyProfileInput } from '@crm/contracts';
import { toDataError } from '../errors.ts';
import { refusalSummary } from '../refusals.ts';
import type { Notice } from '../notice.ts';

/** The person's social links as a screen holds them. */
export type SocialLinksState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready';
      /** Their links, in order: the latest change on its way, else what the server said. */
      readonly links: readonly SocialLink[];
      /** A change is on its way. */
      readonly isSaving: boolean;
      /** False for a member with no sign in of their own, who has no links to keep. */
      readonly canChange: boolean;
    };

/** One workspace's copy of the set, read when first held. */
export interface SocialLinksHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => SocialLinksState;
  readonly retain: () => () => void;
  /** Reads it again after a read failed (Try again). */
  readonly retry: () => void;
}

/** What the store is made with. */
export interface SocialLinksDeps {
  /** The caller's profile read (the profile loader's, which confirms this store too). */
  readonly read: (workspace: string) => Promise<MyProfile>;
  readonly update: (input: UpdateMyProfileInput) => Promise<MyProfile>;
  readonly mintId: () => string;
  readonly notify: (notice: Notice) => void;
  /** The clock, in milliseconds; tests pass their own. */
  readonly now?: () => number;
}

/** A read this recent serves a new holder as it is: the route's loader and the screen it opens hold it together. */
export const SOCIAL_LINKS_FRESH_MS = 1_000;

/** The refusal toast's action, which sends the refused set once more. */
const TRY_AGAIN = 'Try again';

/** The person's social links in each workspace's copy. */
export function createSocialLinksStore(deps: SocialLinksDeps) {
  const held = new Map<string, ReturnType<typeof make>>();
  const now = deps.now ?? Date.now;

  function make(workspace: string) {
    let state: SocialLinksState = { status: 'loading' };
    let readAt: number | undefined;
    let confirmed: { readonly links: readonly SocialLink[]; readonly canChange: boolean } | undefined;
    let inFlight: readonly { readonly id: number; readonly links: readonly SocialLink[] }[] = [];
    let queue: Promise<unknown> = Promise.resolve();
    let made = 0;
    // Changes landed so far: a read sent before one landed never puts its older answer over it.
    let landed = 0;
    let reading = false;
    const listeners = new Set<() => void>();
    const set = (next: SocialLinksState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const show = () => {
      if (confirmed === undefined) return;
      set({
        status: 'ready',
        links: inFlight.at(-1)?.links ?? confirmed.links,
        isSaving: inFlight.length > 0,
        canChange: confirmed.canChange,
      });
    };
    const confirm = (profile: MyProfile) => {
      confirmed = { links: profile.socials ?? [], canChange: profile.socials !== undefined };
      readAt = now();
      show();
    };
    const read = () => {
      if (reading) return;
      reading = true;
      const asOf = landed;
      deps
        .read(workspace)
        .then(
          (profile) => {
            if (landed === asOf) confirm(profile);
          },
          (error: unknown) => {
            if (state.status !== 'ready') set({ status: 'error', message: toDataError(error).message });
          },
        )
        .finally(() => {
          reading = false;
        });
    };
    const change = (links: readonly SocialLink[]): Promise<boolean> => {
      if (state.status !== 'ready' || !state.canChange) return Promise.resolve(false);
      made += 1;
      const id = made;
      inFlight = [...inFlight, { id, links }];
      show();
      const sending = queue.then(async () => {
        try {
          const answer = await deps.update({ workspace, socials: [...links], mutationId: deps.mintId() });
          landed += 1;
          confirm(answer);
          return true;
        } catch (error) {
          // Put back below, as the change leaves the list; Try again sends it once more.
          deps.notify({
            tone: 'danger',
            message: refusalSummary(toDataError(error)),
            action: { label: TRY_AGAIN, onAction: () => void change(links) },
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
    const holder: SocialLinksHeld = {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain() {
        // Read again whenever a screen holds it, so another device's change shows on the next visit; a read that
        // just landed (the loader's, for the screen it opens) already is that visit's.
        if (readAt === undefined || now() - readAt >= SOCIAL_LINKS_FRESH_MS) read();
        return () => undefined;
      },
      retry() {
        if (state.status === 'error') set({ status: 'loading' });
        read();
      },
    };
    const landedElsewhere = (profile: MyProfile) => {
      landed += 1;
      confirm(profile);
    };
    return { holder, change, confirm, landedElsewhere };
  }

  const of = (workspace: string) => {
    const found = held.get(workspace);
    if (found !== undefined) return found;
    const fresh = make(workspace);
    held.set(workspace, fresh);
    return fresh;
  };

  return {
    /** The set in a workspace, read when a screen first holds it. */
    of: (workspace: string): SocialLinksHeld => of(workspace).holder,
    /**
     * Replaces the whole set, at once; put back with a toast and Try again if refused. Answers whether it landed;
     * false, with nothing sent, while unread or for a member who can't keep links.
     */
    change: (workspace: string, links: readonly SocialLink[]): Promise<boolean> => of(workspace).change(links),
    /** A profile read answered: the set it holds is the server's now. */
    confirm: (workspace: string, profile: MyProfile): void => {
      of(workspace).confirm(profile);
    },
    /** A profile change landed (Settings › Profile's Save): its answer is the set now, over any older read. */
    landed: (workspace: string, profile: MyProfile): void => {
      of(workspace).landedElsewhere(profile);
    },
    /** Signed out: forgets every workspace's copy. */
    clear: (): void => {
      held.clear();
    },
  };
}
