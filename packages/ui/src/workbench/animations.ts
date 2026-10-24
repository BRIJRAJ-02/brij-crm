// Settles entrance animations in a story, so a play function can read an
// element that an animation would otherwise be holding invisible. Stories only.
//
// Storybook's test helpers pause every animation on the page with an injected
// <style>. A paused animation sits at its first frame, and an entrance written
// with `animation-fill-mode: both` has `opacity: 0` there, so the element reads
// as hidden however long the story waits for it. `preview.tsx`'s afterEach
// settles the page for the accessibility pass, but that runs after `play`, so
// anything a play function opens is still at frame 0 while it looks at it.
//
// It has to settle the whole document, not the element's own subtree: a dialog's
// `.ws-modal-root` and `.ws-modal-scrim` are ancestors of what the story asked
// for, and an invisible ancestor hides a settled child (MatchCalendar's Other
// Times, which failed in WebKit only when a story that had left its own
// animations behind ran just before it, 25 Oct 2026).

/**
 * Finishes every finite animation on the page, including the entrances above
 * `element`, and waits one frame so the finished styles are the ones a matcher reads.
 */
export async function settleAnimations(): Promise<void> {
  for (const animation of document.getAnimations()) {
    // An infinite one (a spinner, the matching dots) has no end to finish to.
    if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish();
  }
  await new Promise((resolve) => {
    requestAnimationFrame(resolve);
  });
}
