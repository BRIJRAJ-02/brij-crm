// Settings › Business › Page (spec 0066, B4 lite): the business page's editor, as one held copy per workspace, loaded
// on first use (`data.businessPage.load()`), never in the first load. A draft change shows at once, is sent, and the
// server's view (the whole editor view, with what changed and what Publish needs) replaces it; refused, the copy goes
// back and the refusal comes back to the screen. The address, a place's slug, Publish and Discard wait for the
// server's answer before they show, since each changes what guests see or what is held for them. Gallery pictures go
// up one at a time through the upload route, then join the draft. Only managers change it, rarely, so no change
// event carries it: another tab sees a change the next time it holds the copy. The data layer loads this module lazily;
// `@crm/data/business-page/store` exposes it for the editor's browser tests, which drive the real store over a fake api.
//
// One page per business (spec 0065 H7, AC-6592): one held copy per workspace and business. The store follows the
// device's choice of business (`propertyOf`); a screen holds `at(property)`, bound to the business it shows, so a press
// made while a switch is on its way still lands on the business on screen, as the Menu store does.
import type { BusinessPageContent, BusinessPageView, UploadedBusinessPhoto } from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import { holder, type HospitalityHeld } from '../hospitality/store.ts';

type Options = { signal?: AbortSignal };
type Scoped = { workspace: string; property?: string };
/** The business a call names: nothing for the first. */
type InProperty = { property?: string };

/** The business page procedures the store calls, as the data layer's client answers them. */
export interface BusinessPageProcedures {
  readonly page: (input: Scoped, options: Options) => Promise<BusinessPageView>;
  readonly claimHandle: (
    input: Scoped & { handle: string; mutationId: string },
    options: Options,
  ) => Promise<BusinessPageView>;
  readonly save: (
    input: Scoped & { draft: BusinessPageContent; mutationId: string },
    options: Options,
  ) => Promise<BusinessPageView>;
  readonly setPlaceSlug: (
    input: Scoped & { placeId: string; slug: string; mutationId: string },
    options: Options,
  ) => Promise<BusinessPageView>;
  readonly publish: (input: Scoped & { mutationId: string }, options: Options) => Promise<BusinessPageView>;
  readonly discard: (input: Scoped & { mutationId: string }, options: Options) => Promise<BusinessPageView>;
}

/** A picture as the upload route answered it, or the refusal. */
export type PhotoUpload =
  { readonly ok: true; readonly photo: UploadedBusinessPhoto } | { readonly ok: false; readonly error: DataError };

/** The store, made once by the data layer the first time a screen asks (`data.businessPage.load()`). */
export function openBusinessPage(given: {
  readonly api: BusinessPageProcedures;
  /** The data layer's one call path (retries, the session's end, refusals as DataError). */
  readonly call: <T>(run: (options: Options) => Promise<T>) => Promise<T>;
  readonly mintId: () => string;
  /** Sends one picture's bytes to the gallery upload route of `workspace` and business, answering its id and size. */
  readonly upload: (workspace: string, property: string | undefined, body: Blob) => Promise<UploadedBusinessPhoto>;
  /** Our own origin, for the editor's copies of its pictures. */
  readonly origin: string;
  readonly now?: () => number;
  /**
   * The business each workspace works in on this device (the hospitality store's choice); undefined is the first,
   * which no call names. Left out, every call works in the first.
   */
  readonly propertyOf?: (workspace: string) => string | undefined;
}) {
  const { api, call, mintId } = given;
  const now = given.now ?? Date.now;
  const pages = new Map<string, ReturnType<typeof holder<BusinessPageView>>>();
  const bind = (propertyOf: (workspace: string) => string | undefined) => {
    const atOf = (workspace: string): InProperty => {
      const property = propertyOf(workspace);
      return property === undefined ? {} : { property };
    };
    /** The business's page: one held copy per workspace and business, so a switch shows the other's at once. */
    const pageOf = (workspace: string) => {
      const at = atOf(workspace);
      const key = `${workspace}:${at.property ?? ''}`;
      let found = pages.get(key);
      if (found === undefined) {
        found = holder(() => call((options) => api.page({ workspace, ...at }, options)), now);
        pages.set(key, found);
      }
      return found;
    };
    /** A write whose answer shows only once it lands (no guess laid over the copy first). */
    const settled = (
      workspace: string,
      send: (mutationId: string, options: Options, at: InProperty) => Promise<BusinessPageView>,
    ): Promise<DataError | undefined> => {
      const at = atOf(workspace);
      return pageOf(workspace).change(
        (view) => view,
        () => call((options) => send(mintId(), options, at)),
      );
    };
    return {
      /** The editor's view of `workspace`'s page. */
      held: (workspace: string): HospitalityHeld<BusinessPageView> => pageOf(workspace).held,
      /** Claims the page's address (at once for the first business; another's waits for its first Publish). */
      claimHandle: (workspace: string, handle: string) =>
        settled(workspace, (mutationId, options, at) =>
          api.claimHandle({ workspace, ...at, handle, mutationId }, options),
        ),
      /** Saves the draft, whole; shown at once, guests see nothing until Publish. */
      saveDraft: (workspace: string, draft: BusinessPageContent) => {
        const at = atOf(workspace);
        return pageOf(workspace).change(
          (view) => ({ ...view, draft, hasChanges: true }),
          () => call((options) => api.save({ workspace, ...at, draft, mutationId: mintId() }, options)),
        );
      },
      /**
       * Changes the draft from the copy as it stands now (not as a screen last drew it), so two changes made in the same
       * moment (a photo landing while a description saves) both keep; shown at once, sent in order, and Publish, queued
       * behind it, publishes it.
       */
      changeDraft: (workspace: string, edit: (draft: BusinessPageContent) => BusinessPageContent) => {
        const at = atOf(workspace);
        let draft: BusinessPageContent | undefined;
        return pageOf(workspace).change(
          (view) => {
            draft = edit(view.draft);
            return { ...view, draft, hasChanges: true };
          },
          () => {
            const sending = draft;
            if (sending === undefined) return Promise.reject(new Error('The draft was never made.'));
            return call((options) => api.save({ workspace, ...at, draft: sending, mutationId: mintId() }, options));
          },
        );
      },
      /** Gives a place its address on the page (at once; its old one keeps finding it). */
      setPlaceSlug: (workspace: string, placeId: string, slug: string) =>
        settled(workspace, (mutationId, options, at) =>
          api.setPlaceSlug({ workspace, ...at, placeId, slug, mutationId }, options),
        ),
      /** Publishes the draft: guests see it from now on. */
      publish: (workspace: string) =>
        settled(workspace, (mutationId, options, at) => api.publish({ workspace, ...at, mutationId }, options)),
      /** Discards the draft, back to what guests see. */
      discard: (workspace: string) =>
        settled(workspace, (mutationId, options, at) => api.discard({ workspace, ...at, mutationId }, options)),
      /** Uploads one gallery picture (already prepared by the screen); the screen then adds it to the draft. */
      uploadPhoto: async (workspace: string, body: Blob): Promise<PhotoUpload> => {
        try {
          return { ok: true, photo: await given.upload(workspace, propertyOf(workspace), body) };
        } catch (error) {
          return { ok: false, error: toDataError(error) };
        }
      },
      /** The editor's own copy of one of the business's pictures, drafted or published. */
      photoSrc: (workspace: string, photoId: string): string =>
        new URL(
          `/api/business/page/photos/${encodeURIComponent(photoId)}?${new URLSearchParams({ workspace }).toString()}`,
          given.origin,
        ).href,
    };
  };
  const following = bind((workspace) => given.propertyOf?.(workspace));
  return {
    ...following,
    /** The same store bound to one business (undefined is the first), for the screen that shows it. */
    at: (property: string | undefined): typeof following => bind(() => property),
  };
}

/** The business page's editor store, as `data.businessPage.load()` answers it: following the device's choice. */
export type BusinessPageStoreRoot = ReturnType<typeof openBusinessPage>;

/** The business page's editor store a screen holds: bound to the business on screen. */
export type BusinessPageStore = ReturnType<BusinessPageStoreRoot['at']>;
