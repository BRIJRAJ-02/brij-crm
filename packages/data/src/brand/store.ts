// The brand kit and a link page's own colour and photos (spec 0060), as Settings › Brand and the link page's Design
// panel hold them. Two copies per workspace: the workspace's kit (its accent pair, its logo, whether the reader may
// change it), and the reader's own link page look beyond its names (their accent pair, their cover and photo ground,
// and the workspace's accent their page follows until they pick their own). A change shows at once and is sent;
// refused, the copy goes back to what it was and the refusal comes back to the screen, which says why beside the
// control that changed. Only an admin edits the kit and only the person edits their page, so no live event carries
// either: another tab's change shows when a screen next holds it. The colours a page draws for an accent come from
// `brandVariables()`, the same pure function the live page's stylesheet is made with, so a preview is exactly what
// visitors see (AC-7). Loaded on first use (`data.brand.load()`), so none of it rides in the app's first load.
import type { PageImageSlot, ProfileAccent, ProfileLook, WorkspaceBrand } from '@crm/contracts';
import { brandProperties, brandVariables, BRAND_HEX_PATTERN } from '@crm/contracts/brand-colour';
import { toDataError, type DataError } from '../errors.ts';

/**
 * The quick picks the colour pickers offer (AC-3): the library's nine hues, each as its dot colour in light (the
 * `dot-<hue>` tokens, which `packages/tokens/src/packs.test.ts` holds these to), so a pick is the same colour the app's own tags use.
 */
export const BRAND_QUICK_PICKS = [
  { hue: 'gray', value: '#cad0d9' },
  { hue: 'red', value: '#ff5b59' },
  { hue: 'orange', value: '#fb8f3c' },
  { hue: 'yellow', value: '#f5b900' },
  { hue: 'lime', value: '#b3cf2f' },
  { hue: 'green', value: '#0fc27b' },
  { hue: 'sky', value: '#3fb3e8' },
  { hue: 'blue', value: '#266df0' },
  { hue: 'purple', value: '#9d6ef5' },
] as const;

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
}

/** The brand procedures the store calls, as the data layer's client answers them. */
interface BrandProcedures {
  readonly get: (input: { workspace: string }, options: { signal?: AbortSignal }) => Promise<WorkspaceBrand>;
  readonly save: (
    input: { workspace: string; accent: string | null; accentDark: string | null; mutationId: string },
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
) => Promise<{ readonly version?: string; readonly removed?: boolean }>;

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
  /**
   * Shows `next` at once, then runs `send`; its answer stands, a refusal puts back what was there. Answers the
   * refusal, or undefined when it landed, so the screen can say why beside the control.
   */
  const change = async (
    next: (value: Value) => Value,
    send: () => Promise<(value: Value) => Value>,
  ): Promise<DataError | undefined> => {
    if (state.status !== 'ready') return undefined;
    const was = state.value;
    set({ status: 'ready', value: next(was), isSaving: true });
    try {
      const landed = await send();
      // Read afresh: a read may have landed while the change was out.
      const after = held.getSnapshot();
      set({ status: 'ready', value: landed(after.status === 'ready' ? after.value : was), isSaving: false });
      return undefined;
    } catch (error) {
      set({ status: 'ready', value: was, isSaving: false });
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

/** A workspace address, a handle and a version, as the image paths take them. */
const VERSION = /^[0-9a-f]{12}$/;
const HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
}) {
  const { call, send } = given;
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
      found = holder(async () => {
        // The page's own, and the workspace's accent it follows until it has one: read together.
        const [own, kit] = await Promise.all([
          call((options) => given.profile.look({ workspace }, options)),
          call((options) => given.brand.get({ workspace }, options)),
        ]);
        return {
          ...own,
          ...(kit.accent === undefined ? {} : { workspaceAccent: kit.accent }),
          ...(kit.accentDark === undefined ? {} : { workspaceAccentDark: kit.accentDark }),
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
     * The workspace's logo (AC-2): the bytes as the request body, already drawn again by the screen. Answers the
     * refusal, or undefined once it landed and the kit names the new version.
     */
    uploadLogo: (workspace: string, image: Blob): Promise<DataError | undefined> =>
      kitOf(workspace).change(
        (kit) => kit,
        async () => {
          const { version } = await send('/api/brand/logo', workspace, image);
          return (kit) => withField(kit, 'logo', version === undefined ? undefined : { version });
        },
      ),
    /** Removes the workspace's logo (the screen asks first, in a Modal). Answers the refusal, or undefined. */
    removeLogo: (workspace: string): Promise<DataError | undefined> =>
      kitOf(workspace).change(
        (kit) => withField(kit, 'logo', undefined),
        async () => {
          await send('/api/brand/logo', workspace);
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
     * A cover or photo ground (AC-10, AC-13): the bytes, already cropped and drawn again by the screen. Answers the
     * refusal, or undefined once it landed and the look names the new version.
     */
    uploadPhoto: (workspace: string, slot: PageImageSlot, image: Blob): Promise<DataError | undefined> =>
      lookOf(workspace).change(
        (look) => look,
        async () => {
          const { version } = await send(`/api/me/link-page/${slot}`, workspace, image);
          return (look) => withField(look, slot, version);
        },
      ),
    /** Takes a cover or photo ground off the page (the screen asks first). Answers the refusal, or undefined. */
    removePhoto: (workspace: string, slot: PageImageSlot): Promise<DataError | undefined> =>
      lookOf(workspace).change(
        (look) => withField(look, slot, undefined),
        async () => {
          await send(`/api/me/link-page/${slot}`, workspace);
          return (look) => withField(look, slot, undefined);
        },
      ),
    /** Where the owner's browser reads one of their photos: the handle's own route, which knows its owner. */
    photoSrc: (handle: string, slot: PageImageSlot, version: string): string | undefined =>
      HANDLE.test(handle) && handle.length <= 40 && VERSION.test(version)
        ? `/api/public/profiles/${handle}/${slot}?v=${version}`
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
