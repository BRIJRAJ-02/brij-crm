// Settings › Business › Page (spec 0066, B4 lite): the business page's editor, as one held copy per workspace, loaded
// on first use (`data.businessPage.load()`), never in the first load. A draft change shows at once, is sent, and the
// server's view (the whole editor view, with what changed and what Publish needs) replaces it; refused, the copy goes
// back and the refusal comes back to the screen. The address, a place's slug, Publish and Discard wait for the
// server's answer before they show, since each changes what guests see or what is held for them. Gallery pictures go
// up one at a time through the upload route, then join the draft. Only managers change it, rarely, so no change
// event carries it: another tab sees a change the next time it holds the copy.
import type { BusinessPageContent, BusinessPageView, UploadedBusinessPhoto } from '@crm/contracts';
import { toDataError, type DataError } from '../errors.ts';
import { holder, type HospitalityHeld } from '../hospitality/store.ts';

type Options = { signal?: AbortSignal };
type Scoped = { workspace: string };

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
  /** Sends one picture's bytes to the gallery upload route of `workspace`, answering its id and size. */
  readonly upload: (workspace: string, body: Blob) => Promise<UploadedBusinessPhoto>;
  /** Our own origin, for the editor's copies of its pictures. */
  readonly origin: string;
  readonly now?: () => number;
}) {
  const { api, call, mintId } = given;
  const now = given.now ?? Date.now;
  const pages = new Map<string, ReturnType<typeof holder<BusinessPageView>>>();
  const pageOf = (workspace: string) => {
    let found = pages.get(workspace);
    if (found === undefined) {
      found = holder(() => call((options) => api.page({ workspace }, options)), now);
      pages.set(workspace, found);
    }
    return found;
  };
  /** A write whose answer shows only once it lands (no guess laid over the copy first). */
  const settled = (
    workspace: string,
    send: (mutationId: string, options: Options) => Promise<BusinessPageView>,
  ): Promise<DataError | undefined> =>
    pageOf(workspace).change(
      (view) => view,
      () => call((options) => send(mintId(), options)),
    );
  return {
    /** The editor's view of `workspace`'s page. */
    held: (workspace: string): HospitalityHeld<BusinessPageView> => pageOf(workspace).held,
    /** Claims the page's address (at once: held for the business from now on). */
    claimHandle: (workspace: string, handle: string) =>
      settled(workspace, (mutationId, options) => api.claimHandle({ workspace, handle, mutationId }, options)),
    /** Saves the draft, whole; shown at once, guests see nothing until Publish. */
    saveDraft: (workspace: string, draft: BusinessPageContent) =>
      pageOf(workspace).change(
        (view) => ({ ...view, draft, hasChanges: true }),
        () => call((options) => api.save({ workspace, draft, mutationId: mintId() }, options)),
      ),
    /** Gives a place its address on the page (at once; its old one keeps finding it). */
    setPlaceSlug: (workspace: string, placeId: string, slug: string) =>
      settled(workspace, (mutationId, options) => api.setPlaceSlug({ workspace, placeId, slug, mutationId }, options)),
    /** Publishes the draft: guests see it from now on. */
    publish: (workspace: string) =>
      settled(workspace, (mutationId, options) => api.publish({ workspace, mutationId }, options)),
    /** Discards the draft, back to what guests see. */
    discard: (workspace: string) =>
      settled(workspace, (mutationId, options) => api.discard({ workspace, mutationId }, options)),
    /** Uploads one gallery picture (already prepared by the screen); the screen then adds it to the draft. */
    uploadPhoto: async (workspace: string, body: Blob): Promise<PhotoUpload> => {
      try {
        return { ok: true, photo: await given.upload(workspace, body) };
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
}

/** The business page's editor store. */
export type BusinessPageStore = ReturnType<typeof openBusinessPage>;
