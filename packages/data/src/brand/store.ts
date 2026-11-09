// The brand kit and a link page's own colour and photos (spec 0060), as Settings › Brand and the link page's Design
// panel hold them. Two copies per workspace: the workspace's kit (its accent pair, its logo, whether the reader may
// change it), and the reader's own link page look beyond its names (their accent pair, their cover and photo ground,
// and the workspace's accent their page follows until they pick their own). A change shows at once and is sent;
// refused, the copy goes back to what it was and the refusal comes back to the screen, which says why beside the
// control that changed. Only an admin edits the kit and only the person edits their page, so no live event carries
// either: another tab's change shows when a screen next holds it. The colours a page draws for an accent come from
// `brandVariables()`, the same pure function the live page's stylesheet is made with, so a preview is exactly what
// visitors see (AC-7). Loaded on first use (`data.brand.load()`), so none of it rides in the app's first load.
import type { PageImageSlot, PageTemplate, ProfileAccent, ProfileLook, WorkspaceBrand } from '@crm/contracts';
import { brandProperties, brandVariables, BRAND_HEX_PATTERN } from '@crm/contracts/brand-colour';
import { toDataError, type DataError } from '../errors.ts';

import { BRAND_QUICK_PICKS } from './picks.ts';

export { BRAND_QUICK_PICKS } from './picks.ts';

/** Custom property pairs a page or preview root takes (`brandProperties()`). */
export type BrandVariablePairs = readonly (readonly [string, string])[];

/** What an accent pair draws as: its variables, and the colours the guard chose, for the picker's note (AC-6). */
export interface BrandColours {
  /** The custom properties a preview root takes, exactly as the page's own stylesheet sets them. */
  readonly variables: BrandVariablePairs;
  /** Whether the guard moved the colour noticeably: the picker shows the drawn colours and one line. */
  readonly adjusted: boolean;
  /** The fill drawn in light and in dark, for the picker's two swatches. */
  readonly light: string;
  readonly dark: string;
}

/**
 * The colours `accent` (and its own dark one, when set) draws as, or undefined for none: the product's own accent,
 * which needs no variables at all. A value that isn't a checked hex is none too: it never reaches a page.
 */
export function brandColours(accent?: string, accentDark?: string): BrandColours | undefined {
  if (accent === undefined || !BRAND_HEX_PATTERN.test(accent)) return undefined;
  const dark = accentDark !== undefined && BRAND_HEX_PATTERN.test(accentDark) ? accentDark : undefined;
  const drawn = brandVariables({ accent, ...(dark === undefined ? {} : { accentDark: dark }) });
  return {
    variables: brandProperties(drawn),
    adjusted: drawn.adjusted,
    light: drawn.light.accent,
    dark: drawn.dark.accent,
  };
}

/** A held copy: read when a screen first holds it, its state re-read on Try again. */
export interface BrandHeld<State> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => State;
  /** Held while a screen shows it; read when first held, unless a read just landed. */
  readonly retain: () => () => void;
  /** Reads it again (Try again). */
  readonly retry: () => void;
}

/** A copy as a screen holds it. */
export type BrandHeldState<Value> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: DataError }
  | { readonly status: 'ready'; readonly value: Value; readonly isSaving: boolean };

/** The workspace's kit as Settings › Brand shows it. */
export type BrandKit = WorkspaceBrand;

/** A link page's look beyond its names, and the workspace accent it follows until its owner picks one. */
export interface PageLookExtras extends ProfileLook {
  /** The workspace's accent pair: what the page wears while `accent` is unset (AC-14). */
  readonly workspaceAccent?: string;
  readonly workspaceAccentDark?: string;
  /** The workspace's template (spec 0068, AC-6804): what the page wears while it has none of its own. */
  readonly workspaceTemplate?: PageTemplate;
}

/** The brand procedures the store calls, as the data layer's client answers them. */
interface BrandProcedures {
  readonly get: (input: { workspace: string }, options: { signal?: AbortSignal }) => Promise<WorkspaceBrand>;
  readonly save: (
    input: {
      workspace: string;
      accent: string | null;
      accentDark: string | null;
      template?: PageTemplate;
      mutationId: string;
    },
    options: { signal?: AbortSignal },
  ) => Promise<WorkspaceBrand>;
  readonly publishTemplate: (
    input: { workspace: string; mutationId: string },
    options: { signal?: AbortSignal },
  ) => Promise<WorkspaceBrand>;
  readonly discardTemplate: (
    input: { workspace: string; mutationId: string },
    options: { signal?: AbortSignal },
  ) => Promise<WorkspaceBrand>;
}

/** The two profile procedures this store calls. */
interface LookProcedures {
  readonly look: (input: { workspace: string }, options: { signal?: AbortSignal }) => Promise<ProfileLook>;
  readonly saveAccent: (
    input: { workspace: string; accent: string | null; accentDark: string | null; mutationId: string },
    options: { signal?: AbortSignal },
  ) => Promise<ProfileAccent>;
}

/** An image's bytes sent to one of our own routes (`POST`), or taken away (`DELETE`), for a workspace. */
export type ImageSend = (
  path: string,
  workspace: string,
  body?: Blob,
  /** Whose link page a photo is for (spec 0070): absent, the caller's own. */
  member?: string,
) => Promise<{ readonly version?: string; readonly removed?: boolean; readonly same?: boolean }>;

/** A read this recent serves a new holder as it is: the route's loader and the screen it opens hold it together. */
const FRESH_MS = 1_000;

/** One held copy of `Value`, read with `load`, with a change laid over it while it is on its way. */
function holder<Value>(load: () => Promise<Value>, now: () => number) {
  let state: BrandHeldState<Value> = { status: 'loading' };
  let reading: Promise<Value> | undefined;
  let readAt: number | undefined;
  const listeners = new Set<() => void>();
  const set = (next: BrandHeldState<Value>) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const read = (): Promise<Value> => {
    reading ??= load().then(
      (value) => {
        reading = undefined;
        readAt = now();
        set({ status: 'ready', value, isSaving: false });
        return value;
      },
      (error: unknown) => {
        reading = undefined;
        const refused = toDataError(error);
        if (state.status !== 'ready') set({ status: 'error', error: refused });
        throw refused;
      },
    );
    return reading;
  };
  // Changes go out one after another, so the server sees them in the order they were made, and only the latest
  // decides what shows: an earlier answer never lays its value over a newer pick, and an earlier refusal never
  // takes a newer pick away (it still comes back, so the screen says why).
  let queue: Promise<unknown> = Promise.resolve();
  let made = 0;
  /**
   * Shows `next` at once, then runs `send` after every change before it; the latest change's answer stands, and
   * its refusal puts back what was there before it. Answers the refusal, or undefined when it landed, so the
   * screen can say why beside the control.
   */
  const change = async (
    next: (value: Value) => Value,
    send: () => Promise<(value: Value) => Value>,
  ): Promise<DataError | undefined> => {
    if (state.status !== 'ready') return undefined;
    made += 1;
    const mine = made;
    const was = state.value;
    set({ status: 'ready', value: next(was), isSaving: true });
    const sent = queue.then(send);
    queue = sent.catch(() => undefined);
    try {
      const landed = await sent;
      if (mine === made) {
        // Read afresh: a read may have landed while the change was out.
        const after = held.getSnapshot();
        set({ status: 'ready', value: landed(after.status === 'ready' ? after.value : was), isSaving: false });
      }
      return undefined;
    } catch (error) {
      if (mine === made) set({ status: 'ready', value: was, isSaving: false });
      return toDataError(error);
    }
  };
  const held: BrandHeld<BrandHeldState<Value>> = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    retain() {
      if (readAt === undefined || now() - readAt >= FRESH_MS) void read().catch(() => undefined);
      return () => undefined;
    },
    retry() {
      if (state.status === 'error') set({ status: 'loading' });
      void read().catch(() => undefined);
    },
  };
  return { held, read, change };
}

/** `value` without `key` when `next` is undefined, else with it: a cleared field leaves the copy. */
function withField<Value extends object, Key extends keyof Value>(
  value: Value,
  key: Key,
  next: Value[Key] | undefined,
): Value {
  const { [key]: _gone, ...rest } = value;
  return (next === undefined ? rest : { ...rest, [key]: next }) as Value;
}

/** A version, as the image paths take them. */
const VERSION = /^[0-9a-f]{12}$/;

/**
 * The brand kit's and a link page look's store, made once by the data layer the first time a screen asks
 * (`data.brand.load()`).
 */
export function openBrand(given: {
  /** The brand procedures of the data layer's client. */
  readonly brand: BrandProcedures;
  /** The profile procedures of the data layer's client. */
  readonly profile: LookProcedures;
  /** The data layer's one call path (retries, the session's end, refusals as DataError). */
  readonly call: <T>(run: (options: { readonly signal?: AbortSignal }) => Promise<T>) => Promise<T>;
  readonly mintId: () => string;
  /** An image to or from one of our own upload routes. */
  readonly send: ImageSend;
  /** The clock, in milliseconds; tests pass their own. */
  readonly now?: () => number;
  /** A logo landed or was removed: the sidebar's head and the tab's icon follow it at once (undefined: none). */
  readonly onLogo?: (workspace: string, version: string | undefined) => void;
  /**
   * Whose link page the Design panel dresses (spec 0070, AC-7002): absent, the caller's own; else that member's, its
   * look, accent and photos read and sent with `member`. The workspace's own kit is the same either way.
   */
  readonly member?: string;
}) {
  const { call, send } = given;
  const page: { readonly member?: string } = given.member === undefined ? {} : { member: given.member };
  const now = given.now ?? Date.now;
  const kits = new Map<string, ReturnType<typeof holder<BrandKit>>>();
  const looks = new Map<string, ReturnType<typeof holder<PageLookExtras>>>();

  const kitOf = (workspace: string) => {
    let found = kits.get(workspace);
    if (found === undefined) {
      found = holder(() => call((options) => given.brand.get({ workspace }, options)), now);
      kits.set(workspace, found);
    }
    return found;
  };

  const lookOf = (workspace: string) => {
    let found = looks.get(workspace);
    if (found === undefined) {
      found = holder<PageLookExtras>(async () => {
        // The page's own, and the workspace's accent it follows until it has one: read together.
        const [own, kit] = await Promise.all([
          call((options) => given.profile.look({ workspace, ...page }, options)),
          call((options) => given.brand.get({ workspace }, options)),
        ]);
        return {
          ...own,
          ...(kit.accent === undefined ? {} : { workspaceAccent: kit.accent }),
          ...(kit.accentDark === undefined ? {} : { workspaceAccentDark: kit.accentDark }),
          workspaceTemplate: kit.template,
        };
      }, now);
      looks.set(workspace, found);
    }
    return found;
  };

  return {
    /** The colours an accent pair draws as, for a preview and the picker's note; undefined is the product's own. */
    colours: brandColours,
    /** The nine quick picks, in the library's hue order. */
    quickPicks: BRAND_QUICK_PICKS,

    /** Settings › Brand: the workspace's kit, read when first held. */
    kit: (workspace: string): BrandHeld<BrandHeldState<BrandKit>> => kitOf(workspace).held,
    /** Reads the kit now (the route's loader); rejects with the refusal. */
    readKit: (workspace: string): Promise<BrandKit> => kitOf(workspace).read(),
    /**
     * Saves the kit's accent pair (AC-3), whole: undefined clears one, and no accent means the product's own. Shown
     * at once; answers the refusal, or undefined once it landed.
     */
    saveKit: (workspace: string, accent?: string, accentDark?: string): Promise<DataError | undefined> => {
      // Their page's copy names the workspace's accent too, so it is read again when next held.
      looks.delete(workspace);
      return kitOf(workspace).change(
        (kit) =>
          withField(withField(kit, 'accent', accent), 'accentDark', accent === undefined ? undefined : accentDark),
        async () => {
          const saved = await call((options) =>
            given.brand.save(
              {
                workspace,
                accent: accent ?? null,
                accentDark: accent === undefined ? null : (accentDark ?? null),
                mutationId: given.mintId(),
              },
              options,
            ),
          );
          return () => saved;
        },
      );
    },
    /**
     * Picks the workspace's template (spec 0068, AC-6804), the accent pair kept as it is. It waits for Publish
     * (`publishTemplate`): the kit's `templateDraft` until then, the live one picked again clearing it. Shown at
     * once; answers the refusal, or undefined once it landed.
     */
    saveTemplate: (workspace: string, template: PageTemplate): Promise<DataError | undefined> => {
      return kitOf(workspace).change(
        (kit) => withField(kit, 'templateDraft', template === kit.template ? undefined : template),
        async () => {
          const held = kitOf(workspace).held.getSnapshot();
          const kit = held.status === 'ready' ? held.value : undefined;
          const saved = await call((options) =>
            given.brand.save(
              {
                workspace,
                accent: kit?.accent ?? null,
                accentDark: kit?.accent === undefined ? null : (kit.accentDark ?? null),
                template,
                mutationId: given.mintId(),
              },
              options,
            ),
          );
          return () => saved;
        },
      );
    },
    /**
     * Puts the waiting template live on every public page (spec 0068). Shown at once; answers the refusal, or
     * undefined once it landed.
     */
    publishTemplate: (workspace: string): Promise<DataError | undefined> => {
      // Their page's copy names the workspace's template too, so it is read again when next held.
      looks.delete(workspace);
      return kitOf(workspace).change(
        (kit) => withField({ ...kit, template: kit.templateDraft ?? kit.template }, 'templateDraft', undefined),
        async () => {
          const saved = await call((options) =>
            given.brand.publishTemplate({ workspace, mutationId: given.mintId() }, options),
          );
          return () => saved;
        },
      );
    },
    /** Lets the waiting template go: every public page keeps the one it wears. */
    discardTemplate: (workspace: string): Promise<DataError | undefined> =>
      kitOf(workspace).change(
        (kit) => withField(kit, 'templateDraft', undefined),
        async () => {
          const saved = await call((options) =>
            given.brand.discardTemplate({ workspace, mutationId: given.mintId() }, options),
          );
          return () => saved;
        },
      ),
    /**
     * The workspace's logo (AC-2): the bytes as the request body, already drawn again by the screen. Answers the
     * refusal, or undefined once it landed and the kit names the new version.
     */
    uploadLogo: (workspace: string, image: Blob): Promise<DataError | undefined> =>
      kitOf(workspace).change(
        (kit) => kit,
        async () => {
          const { version } = await send('/api/brand/logo', workspace, image);
          given.onLogo?.(workspace, version);
          return (kit) => withField(kit, 'logo', version === undefined ? undefined : { version });
        },
      ),
    /** Removes the workspace's logo (the screen asks first, in a Modal). Answers the refusal, or undefined. */
    removeLogo: (workspace: string): Promise<DataError | undefined> =>
      kitOf(workspace).change(
        (kit) => withField(kit, 'logo', undefined),
        async () => {
          await send('/api/brand/logo', workspace);
          given.onLogo?.(workspace, undefined);
          return (kit) => withField(kit, 'logo', undefined);
        },
      ),
    /** Where a member's browser reads the logo: `/api/brand/logo?workspace=&v=`, their own copy only. */
    logoSrc: (workspace: string, version: string): string | undefined =>
      VERSION.test(version)
        ? `/api/brand/logo?${new URLSearchParams({ workspace, v: version }).toString()}`
        : undefined,

    /** The link page's Design panel: the page's own accent pair and photos, read when first held. */
    look: (workspace: string): BrandHeld<BrandHeldState<PageLookExtras>> => lookOf(workspace).held,
    /**
     * The page's own accent pair (AC-14), whole: undefined follows the workspace's brand again. Shown at once;
     * answers the refusal, or undefined once it landed. Their personal booking pages wear it too.
     */
    saveAccent: (workspace: string, accent?: string, accentDark?: string): Promise<DataError | undefined> =>
      lookOf(workspace).change(
        (look) =>
          withField(withField(look, 'accent', accent), 'accentDark', accent === undefined ? undefined : accentDark),
        async () => {
          const saved = await call((options) =>
            given.profile.saveAccent(
              {
                workspace,
                ...page,
                accent: accent ?? null,
                accentDark: accent === undefined ? null : (accentDark ?? null),
                mutationId: given.mintId(),
              },
              options,
            ),
          );
          return (look) =>
            withField(
              withField(look, 'accent', saved.accent ?? undefined),
              'accentDark',
              saved.accentDark ?? undefined,
            );
        },
      ),
    /**
     * A cover, photo ground or profile photo (AC-10, AC-13): the bytes, already cropped and drawn again by the screen. Answers the
     * refusal, `'same'` when the page already has exactly this photo (the same picture in the same crop: nothing was
     * stored and nothing changed, spec 0068), or undefined once it landed and the look names the new version.
     */
    uploadPhoto: async (
      workspace: string,
      slot: PageImageSlot,
      image: Blob,
    ): Promise<DataError | 'same' | undefined> => {
      // What the server said of the photo, filled in by the send below once it answers.
      const answered = { isSame: false };
      const refused = await lookOf(workspace).change(
        (look) => look,
        async () => {
          const { version, same } = await send(`/api/me/link-page/${slot}`, workspace, image, given.member);
          answered.isSame = same === true;
          return (look) => withField(look, slot, version);
        },
      );
      return refused ?? (answered.isSame ? 'same' : undefined);
    },
    /** Takes a cover, photo ground or profile photo off the page (the screen asks first). Answers the refusal, or undefined. */
    removePhoto: (workspace: string, slot: PageImageSlot): Promise<DataError | undefined> =>
      lookOf(workspace).change(
        (look) => withField(look, slot, undefined),
        async () => {
          await send(`/api/me/link-page/${slot}`, workspace, undefined, given.member);
          return (look) => withField(look, slot, undefined);
        },
      ),
    /**
     * Where the editor's browser reads one of the page's photos as its draft holds it: `/api/me/link-page/<slot>`,
     * through the same door as the upload, so a team page manager sees the photo they put on a member's page too.
     */
    photoSrc: (workspace: string, slot: PageImageSlot, version: string): string | undefined =>
      VERSION.test(version)
        ? `/api/me/link-page/${slot}?${new URLSearchParams({
            workspace,
            ...page,
            v: version,
          }).toString()}`
        : undefined,

    /** Signed out: forgets every copy. */
    clear: (): void => {
      kits.clear();
      looks.clear();
    },
  };
}

/** The brand store, as `data.brand.load()` answers it. */
export type BrandStore = ReturnType<typeof openBrand>;
