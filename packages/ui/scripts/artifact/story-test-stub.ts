// Stands in for `storybook/test` in artifact previews. Previews drop play
// functions, so only `fn` (a spy in args) is ever called; it becomes a plain
// function. Anything else throws, which would mean a preview ran a play.
const notInPreviews = () => {
  throw new Error('Play functions do not run in artifact previews.');
};

/** A no op in place of a spy, so args like `onPress: fn()` still hold a function. */
export const fn = () => () => undefined;
export const expect = notInPreviews;
export const waitFor = notInPreviews;
export const within = notInPreviews;
export const userEvent = { setup: notInPreviews };
