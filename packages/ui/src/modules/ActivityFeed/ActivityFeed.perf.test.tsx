// Spec 0017, AC-380: the record timeline scrolled through 2,000 entries at a
// brisk scroll (300 px a frame, about 18,000 px a second) keeps its frames
// within one 60 Hz frame (16.7 ms) at p95, and never holds more than a
// screenful and the overscan in the DOM. A frame is the time between two
// animation frames, so a frame on time reads 16.7 ms give or take the
// timer's resolution (up to 1 ms is allowed for it) and a dropped one 33 ms. Chromium only, on React's production build (the perf
// project). It logs its numbers on every run, so the budget can be read
// against real data; changing a threshold is a spec change.
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

  it('scrolls through every entry with p95 frames under 16.7 ms and a screenful in the DOM', async () => {
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
    const p95 = percentile(frames, 95);
    const dropped = frames.filter((ms) => ms > FRAME_BUDGET_MS * 1.5).length;
    console.warn(
      `timeline scroll: ${String(frames.length)} frames, p50 ${percentile(frames, 50).toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${Math.max(...frames).toFixed(1)} ms, ${String(dropped)} dropped, at most ${String(mostInDom)} entries in the DOM`,
    );
    expect(document.querySelector(`[role="article"][aria-posinset="${String(ENTRIES)}"]`)).not.toBeNull();
    expect(p95).toBeLessThan(FRAME_BUDGET_MS + TIMER_SLACK_MS);
    expect(mostInDom).toBeLessThan(40);
  });
});
