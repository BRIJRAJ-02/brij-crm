// Focus that moves on after a change made from a menu: a closing menu hands
// focus back to its trigger once its exit animation ends, so moving focus
// elsewhere has to wait for that.

/** Frames to wait at most for closing overlays, so a stuck animation never holds focus back for long. */
const MAX_FRAMES = 60;

/**
 * Focuses what `pick` returns once no overlay is still closing (React Aria
 * marks it `data-exiting`) and the trigger has had its focus back.
 */
export function focusLater(pick: () => HTMLElement | null | undefined): void {
  let frames = 0;
  const step = () => {
    frames += 1;
    if (frames < MAX_FRAMES && document.querySelector('[data-exiting]') !== null) {
      requestAnimationFrame(step);
      return;
    }
    // One more frame: the overlay's focus return runs as it unmounts.
    requestAnimationFrame(() => {
      pick()?.focus();
    });
  };
  requestAnimationFrame(step);
}
