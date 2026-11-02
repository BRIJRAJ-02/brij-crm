// Spec 0017, AC-380: the record timeline scrolled through 2,000 entries at a
// brisk scroll (300 px a frame, about 18,000 px a second) keeps its frames
// within one 60 Hz frame (16.7 ms), and never holds more than a screenful and
// the overscan in the DOM. A frame is the time between two animation frames,
// so a frame on time reads 16.7 ms give or take the timer's resolution (up to
// 1 ms is allowed for it) and a dropped one 33 ms. Chromium only, on React's
// production build (the perf project). It logs its numbers on every run, so
// the budget can be read against real data; changing a threshold is a spec
// change.
//
// The scroll is measured against an idle pass of the same loop on the same
// page, before and after, rather than against the clock alone. A shared CI
// runner misses vsyncs of its own: on one green run of main's own code the
// first attempt missed 38 frames of 406 and the retry 6, which is the whole
// width of a p95 that flips between 16.7 ms and 33.3 ms the moment more than
// one frame in twenty is missed (2 November 2026). An absolute p95 therefore
// measured the runner, not the timeline, and passed or failed by luck. What we
// actually promise is that scrolling the whole list costs no more than sitting
// still, so that is what is asserted, and it holds however busy the host is.
// The median frame is still read against the clock, and the DOM count, the
// claim virtualisation really makes, is unchanged.
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { arraySource } from '../../lib/list-source.ts';
import { createFixedClock } from '../../provider/clock.ts';
import { createToasts } from '../../provider/toasts.tsx';
import { UiProvider } from '../../provider/UiProvider.tsx';
import { SAMPLE_STAGES } from '../../workbench/field-samples.ts';
import { ADA, GRACE, SAMPLE_LINK_ACTIVITY, STAGE } from '../../workbench/record-samples.ts';
import { ActivityFeed, type ActivityEntry } from './ActivityFeed.tsx';

const ENTRIES = 2_000;
const PX_PER_FRAME = 300;
const FRAME_BUDGET_MS = 16.7;
/** The animation frame clock's own jitter: a frame on time can read 16.8 ms. */
const TIMER_SLACK_MS = 1;
/** Frames in each idle pass, enough for a drop rate but short beside the scroll. */
const IDLE_FRAMES = 100;
/**
 * How many more frames, as a share, scrolling may miss than doing nothing. Two passes of the same
 * nothing differ by a frame or two on a busy runner, so the comparison needs a little room; the
 * cost we are looking for, a timeline that renders too much per frame, is far larger than this.
 */
const ADDED_DROP_RATE = 0.02;

/** 2,000 entries, newest first, an hour apart: changes, with a links entry every fifth. */
function entries(): readonly ActivityEntry[] {
  const start = Date.parse('2026-10-08T13:00:00.000Z');
  const links = SAMPLE_LINK_ACTIVITY[0];
  return Array.from({ length: ENTRIES }, (_, index): ActivityEntry => {
    const at = new Date(start - index * 3_600_000).toISOString();
    if (index % 5 === 4 && links !== undefined) return { ...links, id: `p-${String(index)}`, at };
    return {
      id: `p-${String(index)}`,
      kind: 'change',
      at,
      actor: index % 2 === 0 ? ADA : GRACE,
      attribute: STAGE,
      from: SAMPLE_STAGES[index % 3]?.id ?? null,
      to: SAMPLE_STAGES[(index + 1) % 3]?.id ?? null,
    };
  });
}

let root: Root | undefined;
let host: HTMLElement | undefined;

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

/** The share of frames that missed a vsync. */
const dropRate = (frames: readonly number[]): number =>
  frames.length === 0 ? 0 : frames.filter((ms) => ms > FRAME_BUDGET_MS * 1.5).length / frames.length;

/** Sit on the page for a while, touching nothing, to read what the host itself is costing us. */
async function idlePass(): Promise<readonly number[]> {
  const frames: number[] = [];
  let last = await frame();
  for (let taken = 0; taken < IDLE_FRAMES; taken += 1) {
    const now = await frame();
    frames.push(now - last);
    last = now;
  }
  return frames;
}

const report = (what: string, frames: readonly number[]) =>
  `${what}: ${String(frames.length)} frames, p50 ${percentile(frames, 50).toFixed(1)} ms, p95 ${percentile(frames, 95).toFixed(1)} ms, max ${Math.max(...frames).toFixed(1)} ms, ${(dropRate(frames) * 100).toFixed(1)}% dropped`;

describe('the timeline at 2,000 entries (spec 0017, AC-380)', () => {
  beforeAll(async () => {
    await page.viewport(1280, 800);
  });

  afterEach(() => {
    root?.unmount();
    host?.remove();
    root = undefined;
    host = undefined;
  });

  it('scrolls through every entry costing no frames over idle, with a screenful in the DOM', async () => {
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;display:flex';
    document.body.append(host);
    root = createRoot(host);
    root.render(
      <UiProvider
        locale="en-US"
        timeZone="Europe/London"
        navigate={() => undefined}
        toasts={createToasts()}
        clock={createFixedClock(Date.UTC(2026, 9, 8, 14, 30))}
        platform="mac"
      >
        <ActivityFeed label="Activity" entries={arraySource(entries(), (entry) => entry.id)} />
      </UiProvider>,
    );
    while (document.querySelector('[role="feed"] [role="article"]') === null) await frame();
    const feed = document.querySelector<HTMLElement>('[role="feed"]');
    if (feed === null) throw new Error('No feed rendered.');
    await frame();
    const idleBefore = await idlePass();
    const frames: number[] = [];
    let mostInDom = 0;
    let last = await frame();
    while (feed.scrollTop + feed.clientHeight < feed.scrollHeight - 1) {
      feed.scrollTop += PX_PER_FRAME;
      const now = await frame();
      frames.push(now - last);
      last = now;
      mostInDom = Math.max(mostInDom, feed.querySelectorAll('[role="article"]').length);
    }
    const idleAfter = await idlePass();
    // The busier of the two idle passes, so a burst of host noise that caught only one of them
    // can't be billed to the scroll.
    const idle = Math.max(dropRate(idleBefore), dropRate(idleAfter));
    console.warn(
      [
        report('timeline scroll', frames),
        report('idle before', idleBefore),
        report('idle after', idleAfter),
        `at most ${String(mostInDom)} entries in the DOM`,
      ].join('; '),
    );
    expect(document.querySelector(`[role="article"][aria-posinset="${String(ENTRIES)}"]`)).not.toBeNull();
    expect(percentile(frames, 50)).toBeLessThan(FRAME_BUDGET_MS + TIMER_SLACK_MS);
    expect(dropRate(frames)).toBeLessThanOrEqual(idle + ADDED_DROP_RATE);
    expect(mostInDom).toBeLessThan(40);
  });
});
