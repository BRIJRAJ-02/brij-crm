// The edge cache in front of the public answers (spec 0058, AC-23): what a cached answer is filed under, and how a
// change of mind deletes every copy at once. On Vercel it is the platform's cache tags (`vercel/platform.ts`); on
// any other host both calls do nothing, and the answers' short `s-maxage` alone bounds how long a copy lives.

/** Files cached answers under tags, and deletes every answer under a tag. */
export interface EdgeCache {
  /** Files the answer being made under `tags`. Never throws, never waits. */
  readonly tag: (tags: readonly string[]) => void;
  /**
   * Deletes every cached answer under `tags`, outright rather than marking it stale, so no visitor is answered
   * from the old copy again. Never rejects: a failed purge is logged by the platform and the `s-maxage` still holds.
   */
  readonly forget: (tags: readonly string[]) => Promise<void>;
}

/** No edge cache to tell: the long running server, and tests that don't watch. */
export const NO_EDGE_CACHE: EdgeCache = {
  tag: () => undefined,
  forget: () => Promise.resolve(),
};
