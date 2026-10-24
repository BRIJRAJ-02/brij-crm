// The picture choice and social links stores behind a door that loads them on first use (`stores.ts`), so they stay
// out of the app's first load. Screens get each workspace's holder at once: it reads loading until the stores
// arrive, then speaks for the real one, holding it while the screen does.
import type { PictureChoiceHeld, PictureChoiceState } from './picture.ts';
import type { SocialLinksHeld, SocialLinksState } from './socials.ts';
import type { ProfileStores } from './stores.ts';

/** A holder a screen retains: subscribe, read, hold, and try a failed read again. */
interface Held<State> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => State;
  readonly retain: () => () => void;
  readonly retry: () => void;
}

/** The two stores, loaded by `load` the first time anything asks; holders answer at once. */
export function lazyProfileStores(load: () => Promise<ProfileStores>) {
  let loaded: Promise<ProfileStores> | undefined;
  let stores: ProfileStores | undefined;
  const open = (): Promise<ProfileStores> =>
    (loaded ??= load().then((made) => {
      stores = made;
      return made;
    }));
  const holders = new Map<string, Held<unknown>>();

  /** One stand in per store and workspace, speaking for the real holder once the stores have loaded. */
  function stand<State>(key: string, real: (made: ProfileStores) => Held<State>, loading: State): Held<State> {
    const found = holders.get(key);
    if (found !== undefined) return found as Held<State>;
    const listeners = new Set<() => void>();
    const tell = () => {
      for (const listener of listeners) listener();
    };
    let holds = 0;
    let release: (() => void) | undefined;
    let heard = false;
    const arrived = () =>
      open().then((made) => {
        const inner = real(made);
        if (!heard) {
          heard = true;
          inner.subscribe(tell);
        }
        if (holds > 0) release ??= inner.retain();
        tell();
        return inner;
      });
    const made: Held<State> = {
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      getSnapshot: () => (stores === undefined ? loading : real(stores).getSnapshot()),
      retain() {
        holds += 1;
        void arrived();
        return () => {
          holds -= 1;
          if (holds === 0) {
            release?.();
            release = undefined;
          }
        };
      },
      retry() {
        void arrived().then((inner) => {
          inner.retry();
        });
      },
    };
    holders.set(key, made);
    return made;
  }

  return {
    /** Both stores, once loaded. */
    load: open,
    /** Whether the person's picture shows on their public pages, in a workspace. */
    picture: (workspace: string): PictureChoiceHeld =>
      stand<PictureChoiceState>(`picture:${workspace}`, (made) => made.picture.of(workspace), { status: 'loading' }),
    /** Their social links, in a workspace. */
    socials: (workspace: string): SocialLinksHeld =>
      stand<SocialLinksState>(`socials:${workspace}`, (made) => made.socials.of(workspace), { status: 'loading' }),
    /** Signed out: forgets both stores' copies and the stand ins. */
    clear: (): void => {
      stores?.picture.clear();
      stores?.socials.clear();
      holders.clear();
    },
  };
}
