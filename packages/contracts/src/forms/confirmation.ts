// The visitor's copy's limits, with no Zod, so the builder's browser bundle can name them (forms fix b1).

/** How long a confirmation's own subject and line may be. */
export const CONFIRMATION_SUBJECT_MAX = 120;
/** How long a confirmation's own line may be. */
export const CONFIRMATION_LINE_MAX = 500;

/** How long a closed form's own message may be (forms fix b2). */
export const CLOSED_MESSAGE_MAX = 300;

/** The most answers a form may be set to close after (forms fix b2): counted on every page load, so kept small. */
export const CLOSE_AFTER_MAX = 10_000;
