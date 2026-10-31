// Spec 0061's side of the link page store (R4, the editor and Insights): the six new kinds and the fields every
// block gained (a window, a tile size, a link's picture, card and notice), checked as the server will before
// anything is sent; and the reads and writes beside the blocks: a picture uploaded, a link's own site picture
// fetched, Insights over 7, 30 or 90 days, the share QR's style, and the CSV's address. Loaded with the store, in
// the editor's own chunk, never the first load. The server checks every one again with the contract's schemas.
import type { FetchedThumbnail, ProfileBlock, ProfileCounts, ProfileItem, ProfileQrStyle } from '@crm/contracts';
import { contrastRatio } from '@crm/contracts/brand-colour';
import {
  checkProfileLink,
  isInProfileWindow,
  MEDIA_LINK_REFUSAL,
  MEDIA_PROVIDER_NAMES,
  PROFILE_ALT_MAX,
  PROFILE_ALT_REFUSAL,
  PROFILE_BANNER_MAX,
  PROFILE_CAPTION_MAX,
  PROFILE_CONTROL,
  PROFILE_GALLERY_MAX,
  PROFILE_GALLERY_MIN,
  PROFILE_INSIGHT_DAYS,
  PROFILE_LIMITS,
  PROFILE_MEDIA_TITLE_MAX,
  PROFILE_NOTICES,
  PROFILE_SIZED_KINDS,
  PROFILE_TILE_SIZES,
  profileLimitSentence,
  profileLinkProblem,
  profileNoticeSentence,
  profileWindowProblem,
  profileWindowState,
  QR_BACKGROUND,
  QR_CONTRAST_MIN,
  QR_CONTRAST_REFUSAL,
  QR_LABEL_MAX,
  type MediaProvider,
  type ProfileBlockKind,
  type ProfileInsightDays,
  type ProfileNotice,
  type ProfileTileSize,
  type ProfileWindowState,
} from '@crm/contracts/link-page';
import { toDataError, type DataError } from '../errors.ts';

/** A block's "Show from" and "Hide after", as the editor sends them: ISO 8601 instants, either or both absent. */
export interface DraftWindow {
  readonly showFrom?: string;
  readonly hideAfter?: string;
}

/** The fields every kind but a heading may carry (AC-6111), and a tile size on the kinds that take one (AC-6103). */
export interface DraftExtras extends DraftWindow {
  readonly size?: ProfileTileSize;
}

/** A link's spec 0061 fields (AC-6101, AC-6102, AC-6113): its picture, the larger card and a notice. */
export interface DraftLinkExtras {
  readonly thumb?: string;
  readonly style?: 'row' | 'featured';
  readonly notice?: ProfileNotice;
}

/** Spec 0061's six kinds as the editor's Modals have them, before they are checked. */
export type ReachDraft =
  | ({ readonly kind: 'socials' } & DraftWindow)
  | ({ readonly kind: 'media'; readonly url: string; readonly title?: string } & DraftExtras)
  | ({
      readonly kind: 'image';
      readonly image?: string;
      readonly alt: string;
      readonly caption?: string;
      readonly url?: string;
    } & DraftExtras)
  | ({
      readonly kind: 'gallery';
      readonly images: readonly { readonly image: string; readonly alt: string }[];
      readonly display?: 'row' | 'grid';
    } & DraftExtras)
  | ({ readonly kind: 'times'; readonly workspaceId?: string; readonly pageId?: string } & DraftWindow)
  | ({ readonly kind: 'banner'; readonly text: string; readonly url?: string } & DraftWindow);

/** Why a spec 0061 field can't be kept, by field: `alt:0` is a gallery's first picture's description. */
export type ReachProblems = Readonly<Partial<Record<string, string>>>;

/** One line that may be empty: its problem, or undefined. */
function lineProblem(typed: string, max: number, long: string): string | undefined {
  if (PROFILE_CONTROL.test(typed.trim())) return 'Keep it to one line, with no special characters.';
  return typed.trim().length > max ? long : undefined;
}

/** A web address that may be left out: the canonical address, or its problem. */
function optionalUrl(typed: string | undefined): { readonly url?: string; readonly problem?: string } {
  const value = typed?.trim() ?? '';
  if (value === '') return {};
  const checked = checkProfileLink(value);
  return checked.ok ? { url: checked.url } : { problem: profileLinkProblem(checked.reason) };
}

/** A picture's alt text: its problem, or undefined. */
function altProblem(alt: string): string | undefined {
  if (alt.trim() === '') return PROFILE_ALT_REFUSAL;
  return lineProblem(alt, PROFILE_ALT_MAX, 'Keep the description to 200 characters.');
}

/** The service a pasted link is on, by its host alone, for the draft's "Plays from"; the server parses it whole. */
export function mediaProviderOf(pasted: string): MediaProvider | undefined {
  const typed = pasted.trim();
  if (typed === '') return undefined;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  const hosts: Readonly<Record<MediaProvider, readonly string[]>> = {
    youtube: ['youtu.be', 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'],
    vimeo: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'],
    spotify: ['open.spotify.com'],
    soundcloud: ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'],
    applemusic: ['music.apple.com'],
  };
  return (Object.keys(hosts) as MediaProvider[]).find((provider) => hosts[provider].includes(host));
}

/** A window's own problem (AC-6111): an instant that doesn't read, or the end at or before the start. */
function windowProblems(draft: DraftWindow): ReachProblems {
  const problems: Record<string, string> = {};
  for (const key of ['showFrom', 'hideAfter'] as const) {
    const at = draft[key];
    if (at !== undefined && Number.isNaN(Date.parse(at))) problems[key] = 'Pick a date and time.';
  }
  if (Object.keys(problems).length > 0) return problems;
  const problem = profileWindowProblem(draft);
  return problem === undefined ? {} : { hideAfter: problem };
}

/** The window as it is sent: each end once it is set, in one spelling. */
function windowOf(draft: DraftWindow): DraftWindow {
  return {
    ...(draft.showFrom === undefined ? {} : { showFrom: new Date(draft.showFrom).toISOString() }),
    ...(draft.hideAfter === undefined ? {} : { hideAfter: new Date(draft.hideAfter).toISOString() }),
  };
}

/** Whether a kind takes a tile size (AC-6103); every other kind spans the grid's whole row. */
export function isSizedKind(kind: ProfileBlockKind): boolean {
  return PROFILE_SIZED_KINDS.some((sized) => sized === kind);
}

/** The size as it is sent: absent for `small`, which is what absent means. */
function sizeOf(kind: ProfileBlockKind, size: ProfileTileSize | undefined): { readonly size?: ProfileTileSize } {
  if (!isSizedKind(kind) || size === undefined || size === 'small') return {};
  return PROFILE_TILE_SIZES.includes(size) ? { size } : {};
}

/**
 * The window and size laid onto a block another check made (AC-6103, AC-6111), with the window's problems; a heading
 * takes neither. The block's own fields are already checked.
 */
export function withExtras(
  block: ProfileBlock,
  extras: DraftExtras,
): { readonly ok: true; readonly block: ProfileBlock } | { readonly ok: false; readonly problems: ReachProblems } {
  if (block.kind === 'heading') return { ok: true, block };
  const problems = windowProblems(extras);
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return { ok: true, block: { ...block, ...windowOf(extras), ...sizeOf(block.kind, extras.size) } as ProfileBlock };
}

/**
 * A link's picture, card and notice (AC-6101, AC-6102, AC-6113), with the featured cap: at most 3 links drawn as the
 * larger card, counting the live ones but the one being edited.
 */
export function linkExtrasProblems(
  extras: DraftLinkExtras,
  items: readonly ProfileItem[],
  editing: string | undefined,
): ReachProblems {
  if (extras.style !== 'featured') return {};
  const featured = items.filter(
    (item) => item.kind === 'link' && item.id !== editing && 'style' in item && item.style === 'featured',
  ).length;
  return featured >= PROFILE_LIMITS.featured ? { style: profileLimitSentence('featured') } : {};
}

/** A link's spec 0061 fields as they are sent: a row is absent, as a notice left off is. */
export function linkExtrasOf(extras: DraftLinkExtras): DraftLinkExtras {
  return {
    ...(extras.thumb === undefined ? {} : { thumb: extras.thumb }),
    ...(extras.style === 'featured' ? { style: 'featured' as const } : {}),
    ...(extras.notice !== undefined && PROFILE_NOTICES.includes(extras.notice) ? { notice: extras.notice } : {}),
  };
}

/** One of spec 0061's kinds as typed, checked as the server will: each field's problem, or the block to send. */
export function checkReachBlock(
  draft: ReachDraft,
): { readonly ok: true; readonly block: ProfileBlock } | { readonly ok: false; readonly problems: ReachProblems } {
  const problems: Record<string, string | undefined> = { ...windowProblems(draft) };
  const window = windowOf(draft);
  const size = 'size' in draft ? sizeOf(draft.kind, draft.size) : {};
  const done = (block: ProfileBlock) =>
    Object.keys(problems).length > 0 ? { ok: false as const, problems } : { ok: true as const, block };
  switch (draft.kind) {
    case 'socials':
      return done({ kind: 'socials', ...window });
    case 'media': {
      const url = draft.url.trim();
      if (url === '') problems.url = 'Paste the link.';
      else if (mediaProviderOf(url) === undefined) problems.url = MEDIA_LINK_REFUSAL;
      const title = draft.title?.trim() ?? '';
      const long = lineProblem(title, PROFILE_MEDIA_TITLE_MAX, 'Keep the title to 100 characters.');
      if (long !== undefined) problems.title = long;
      return done({ kind: 'media', url, ...(title === '' ? {} : { title }), ...size, ...window });
    }
    case 'image': {
      if (draft.image === undefined) problems.image = 'Add a picture.';
      const alt = altProblem(draft.alt);
      if (alt !== undefined) problems.alt = alt;
      const caption = draft.caption?.trim() ?? '';
      const long = lineProblem(caption, PROFILE_CAPTION_MAX, 'Keep the caption to 120 characters.');
      if (long !== undefined) problems.caption = long;
      const link = optionalUrl(draft.url);
      if (link.problem !== undefined) problems.url = link.problem;
      return done({
        kind: 'image',
        image: draft.image ?? '',
        alt: draft.alt.trim(),
        ...(caption === '' ? {} : { caption }),
        ...(link.url === undefined ? {} : { url: link.url }),
        ...size,
        ...window,
      });
    }
    case 'gallery': {
      if (draft.images.length < PROFILE_GALLERY_MIN) problems.images = 'Add at least two pictures.';
      else if (draft.images.length > PROFILE_GALLERY_MAX) problems.images = 'Keep it to 12 pictures.';
      draft.images.forEach((each, at) => {
        const alt = altProblem(each.alt);
        if (alt !== undefined) problems[`alt:${String(at)}`] = alt;
      });
      return done({
        kind: 'gallery',
        images: draft.images.map((each) => ({ image: each.image, alt: each.alt.trim() })),
        ...(draft.display === 'grid' ? { display: 'grid' as const } : {}),
        ...size,
        ...window,
      });
    }
    case 'times':
      if (draft.workspaceId === undefined || draft.pageId === undefined) problems.page = 'Pick a booking page.';
      return done({ kind: 'times', workspaceId: draft.workspaceId ?? '', pageId: draft.pageId ?? '', ...window });
    case 'banner': {
      const text = draft.text.trim();
      if (text === '') problems.text = 'Write the banner’s line.';
      else {
        const long = lineProblem(text, PROFILE_BANNER_MAX, 'Keep the banner to 80 characters.');
        if (long !== undefined) problems.text = long;
      }
      const link = optionalUrl(draft.url);
      if (link.problem !== undefined) problems.url = link.problem;
      return done({ kind: 'banner', text, ...(link.url === undefined ? {} : { url: link.url }), ...window });
    }
  }
}

/**
 * Whether one more banner fits (AC-6112): one live at a time, so a banner whose window has ended frees the place.
 * Every other kind's cap counts its live blocks, as `blockLimit` does.
 */
export function bannerIsFull(items: readonly ProfileItem[], now: Date): boolean {
  return items.some((item) => item.kind === 'banner' && isInProfileWindow(item, now));
}

/** Where a block's window stands now, for its row's chip (AC-6111). */
export function windowStateOf(item: ProfileItem, now: Date): ProfileWindowState {
  if (item.kind === 'heading') return { state: 'always' };
  return profileWindowState(item, now);
}

/** A share QR's module colour's problem (AC-6124): too light to scan against the fixed white ground. */
export function qrColourProblem(hex: string): string | undefined {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 'Use a colour like #1f2937.';
  return contrastRatio(hex.toLowerCase(), QR_BACKGROUND) >= QR_CONTRAST_MIN ? undefined : QR_CONTRAST_REFUSAL;
}

/** A share QR's frame label's problem (AC-6124). */
export function qrLabelProblem(label: string): string | undefined {
  if (label.trim() === '') return 'Write the label, or leave the frame off.';
  return lineProblem(label, QR_LABEL_MAX, 'Keep the label to 20 characters.');
}

/** A picture stored for the page, as the upload answers it. */
export interface StoredPicture {
  readonly image: string;
  readonly width: number;
  readonly height: number;
}

/** Insights for one period, as a screen holds it (AC-6118). */
export type InsightsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: DataError }
  | { readonly status: 'ready'; readonly counts: ProfileCounts };

/** One period's Insights, as a screen retains it. */
export interface InsightsHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => InsightsState;
  /** Held while a screen shows it; read when first held, and again once a minute has passed. */
  readonly retain: () => () => void;
  readonly retry: () => void;
}

/** The share QR's style, as a screen holds it (AC-6124): the saved one with the change on its way laid over it. */
export type QrStyleState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: DataError }
  | { readonly status: 'ready'; readonly style: ProfileQrStyle; readonly isSaving: boolean };

/** The QR's style, as a screen retains it. */
export interface QrStyleHeld {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => QrStyleState;
  readonly retain: () => () => void;
  readonly retry: () => void;
}

/** What the reach part calls on the API. */
export interface ReachApi {
  readonly counts: (input: { readonly workspace: string; readonly days: ProfileInsightDays }) => Promise<ProfileCounts>;
  readonly fetchThumbnail: (input: {
    readonly workspace: string;
    readonly id: string;
    readonly mutationId: string;
  }) => Promise<FetchedThumbnail>;
  readonly qrStyle: (input: { readonly workspace: string }) => Promise<ProfileQrStyle>;
  readonly saveQrStyle: (input: {
    readonly workspace: string;
    readonly style: ProfileQrStyle | null;
    readonly mutationId: string;
  }) => Promise<ProfileQrStyle>;
  /** Sends a picture's bytes to `/api/profile/images` for the workspace named; answers the stored picture. */
  readonly upload: (workspace: string, picture: Blob) => Promise<StoredPicture>;
}

/** How long a period's figures serve a new holder before they are read again. */
export const INSIGHTS_FRESH_MS = 60_000;

/** The reads and writes beside the blocks (spec 0061, R4). */
export function createReach(deps: {
  readonly api: ReachApi;
  readonly mintId: () => string;
  /** The clock, in milliseconds; tests pass their own. */
  readonly now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  // One copy per period: the figures are the person's own, the same whichever workspace the screen is in, so the
  // workspace only picks the route the read goes through.
  const insightsHeld = new Map<ProfileInsightDays, InsightsHeld>();
  let insightsWorkspace = '';

  const makeInsights = (days: ProfileInsightDays): InsightsHeld => {
    let state: InsightsState = { status: 'loading' };
    let readAt: number | undefined;
    let asked = 0;
    const listeners = new Set<() => void>();
    const set = (next: InsightsState) => {
      state = next;
      for (const listener of listeners) listener();
    };
    const read = () => {
      const ticket = (asked += 1);
      readAt = now();
      deps.api.counts({ workspace: insightsWorkspace, days }).then(
        (counts) => {
          if (ticket === asked) set({ status: 'ready', counts });
        },
        (error: unknown) => {
          if (ticket !== asked) return;
          readAt = undefined;
          // Figures already shown stay; a first read that failed says so, with Try again.
          if (state.status !== 'ready') set({ status: 'error', error: toDataError(error) });
        },
      );
    };
    return {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain() {
        if (readAt === undefined || now() - readAt >= INSIGHTS_FRESH_MS) read();
        return () => undefined;
      },
      retry() {
        if (state.status === 'error') set({ status: 'loading' });
        read();
      },
    };
  };

  let qrHeld: QrStyleHeld | undefined;
  let qrWorkspace = '';
  let qrSave: ((style: ProfileQrStyle | null) => Promise<DataError | undefined>) | undefined;

  const makeQr = (): QrStyleHeld => {
    let confirmed: ProfileQrStyle | undefined;
    let failed: DataError | undefined;
    // The newest change on its way: shown over what was confirmed, and the only one whose answer lands.
    let shown: ProfileQrStyle | undefined;
    let ticket = 0;
    let readAt: number | undefined;
    let state: QrStyleState = { status: 'loading' };
    const listeners = new Set<() => void>();
    const show = () => {
      if (confirmed === undefined) {
        state = failed === undefined ? { status: 'loading' } : { status: 'error', error: failed };
      } else {
        state = { status: 'ready', style: shown ?? confirmed, isSaving: shown !== undefined };
      }
      for (const listener of listeners) listener();
    };
    const read = () => {
      readAt = now();
      deps.api.qrStyle({ workspace: qrWorkspace }).then(
        (style) => {
          confirmed = style;
          failed = undefined;
          show();
        },
        (error: unknown) => {
          readAt = undefined;
          if (confirmed === undefined) {
            failed = toDataError(error);
            show();
          }
        },
      );
    };
    qrSave = (style) => {
      const mine = (ticket += 1);
      shown = style ?? {};
      show();
      return deps.api.saveQrStyle({ workspace: qrWorkspace, style, mutationId: deps.mintId() }).then(
        (saved) => {
          if (mine !== ticket) return undefined;
          confirmed = saved;
          shown = undefined;
          show();
          return undefined;
        },
        (error: unknown) => {
          if (mine === ticket) {
            // Refused: what was saved stands again, and the reason goes back to the control that changed.
            shown = undefined;
            show();
          }
          return toDataError(error);
        },
      );
    };
    return {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      retain() {
        if (readAt === undefined) read();
        return () => undefined;
      },
      retry() {
        failed = undefined;
        show();
        read();
      },
    };
  };

  return {
    /** One period's Insights (AC-6118, AC-6119): 7, 30 or 90 days, read when first held, kept a minute. */
    insights: (workspace: string, days: ProfileInsightDays): InsightsHeld => {
      insightsWorkspace = workspace;
      const found = insightsHeld.get(days);
      if (found !== undefined) return found;
      const made = makeInsights(days);
      insightsHeld.set(days, made);
      return made;
    },
    /** The periods Insights offers. */
    insightDays: PROFILE_INSIGHT_DAYS,
    /** The share QR's style (AC-6124), read when first held. */
    qrStyle: (workspace: string): QrStyleHeld => {
      qrWorkspace = workspace;
      qrHeld ??= makeQr();
      return qrHeld;
    },
    /**
     * Saves the QR's style whole (`null` back to the plain code): shown at once, put back on a refusal, which comes
     * back rather than a toast, since the control that changed is where its reason belongs.
     */
    saveQrStyle: (workspace: string, style: ProfileQrStyle | null): Promise<DataError | undefined> => {
      qrWorkspace = workspace;
      qrHeld ??= makeQr();
      return qrSave?.(style) ?? Promise.resolve(undefined);
    },
    /**
     * Stores a picture for the page (AC-6101, AC-6108): the bytes, already made at most 1,600 pixels by the screen,
     * which also leaves a photo's location behind. Rejects with a DataError: `INPUT_INVALID`, `PAYLOAD_TOO_LARGE`,
     * `RATE_LIMITED`, `API_UNAVAILABLE`.
     */
    uploadPicture: (workspace: string, picture: Blob): Promise<StoredPicture> =>
      deps.api.upload(workspace, picture).catch((error: unknown) => {
        throw toDataError(error);
      }),
    /**
     * Fetches a saved link's own site picture as its thumbnail (AC-6101), by the link's id: the address read is
     * the one saved, never one typed here. Answers the stored picture, or `none` when the site names none we can use.
     */
    fetchThumbnail: (workspace: string, id: string): Promise<FetchedThumbnail> =>
      deps.api.fetchThumbnail({ workspace, id, mutationId: deps.mintId() }).catch((error: unknown) => {
        throw toDataError(error);
      }),
    /** Where the owner's own browser reads one of their stored pictures: their copy, live or not. */
    pictureSrc: (workspace: string, imageId: string): string =>
      `/api/profile/images/${encodeURIComponent(imageId)}?${new URLSearchParams({ workspace }).toString()}`,
    /** The Insights CSV's address (AC-6120): one row per day, metric and key, `from` to `to` (at most 365 days). */
    insightsCsvHref: (workspace: string, from: string, to: string): string =>
      `/api/profile/insights.csv?${new URLSearchParams({ workspace, from, to }).toString()}`,
    /** The pieces of the rules the editor words its controls with. */
    rules: {
      mediaProviderOf,
      providerName: (provider: MediaProvider): string => MEDIA_PROVIDER_NAMES[provider],
      noticeSentence: profileNoticeSentence,
      notices: PROFILE_NOTICES,
      sizes: PROFILE_TILE_SIZES,
      isSizedKind,
      windowStateOf,
      bannerIsFull,
      qrColourProblem,
      qrLabelProblem,
      galleryMax: PROFILE_GALLERY_MAX,
      galleryMin: PROFILE_GALLERY_MIN,
    },
  };
}

/** The reach part, as the store hands it to the editor. */
export type LinkPageReach = ReturnType<typeof createReach>;
