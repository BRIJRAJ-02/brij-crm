// The fill ticket's one shared cap, in a module of its own so both the submit
// body (`public.ts`) and the save and resume bodies (`partials.ts`) can read
// it without the two importing each other: `public.ts` needs `ResumedFill`
// from `partials.ts`, so nothing in `partials.ts` may reach back into it.
/** The longest fill ticket the endpoints read. */
export const FILL_TICKET_MAX = 200;
