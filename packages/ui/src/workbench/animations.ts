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

/** Resolves on the next frame. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/** The finite animations still playing; an endless one (a spinner) never ends, so it never counts. */
function running(): readonly Animation[] {
  return document
    .getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity && animation.playState !== 'finished');
}

/**
 * Waits until no finite animation is playing, as the screenshot harness does after a theme swap, so the matcher
 * compares settled frames. A transition replaced mid flight (a new end value, or a colour inherited from a parent
 * that is itself tweening, which restarts the child's transition every frame) is cancelled, and its `finished`
 * rejects with an AbortError: that counts as over, and the wait goes on with whatever replaced it. It looks again
 * one frame after the page seems still, since an inherited tween starts a child's transition only on the next
 * frame. It gives up after `timeoutMs`, so a page that never settles reaches the matcher, which reports it.
 */
export async function waitForAnimations(timeoutMs = 5_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const playing = running();
    if (playing.length === 0) {
      await nextFrame();
      if (running().length === 0) return;
      continue;
    }
    await Promise.race([
      Promise.allSettled(playing.map((animation) => animation.finished)),
      new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - performance.now()))),
    ]);
  }
}
