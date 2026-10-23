// A related side's page sizes (spec 0014, milestone 3), as plain TypeScript
// with no Zod, so the browser's lazily loaded section source reads them
// without loading a schema module.

/** The most related records one `links.page` answers. */
export const LINK_PAGE_MAX = 50;

/** How many related records a record page's section shows at first, and adds with each "Show more". */
export const LINK_PREVIEW = 20;
