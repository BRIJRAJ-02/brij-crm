// The one network primitive the data layer uses: `fetch`, passed in so tests
// can put a fake API behind it.

/** A `fetch`: the browser's by default, a fake API's in tests. */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
