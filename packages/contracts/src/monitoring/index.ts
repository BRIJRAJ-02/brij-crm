// `@crm/contracts/monitoring`: what monitoring shares between the browser and
// the server (spec 0010), with no Zod and no vendor, so the browser's lazy
// Sentry chunk can import it.
export { EMAIL_MARK, KEPT_HEADERS, MAX_TEXT, scrub, scrubText } from './scrub.ts';
