// The x axis in a real browser (T7, 4 November 2026: "numbers are overlapping"): over every range a screen offers and
// at every width from a phone's to a wide page, the drawn labels never touch, measured from their real boxes.
import '../../styles/index.css';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { createToasts } from '../../provider/toasts.tsx';
import { UiProvider } from '../../provider/UiProvider.tsx';
import type { ChartPoint } from './Chart.tsx';
import { ChartPlot } from './ChartPlot.tsx';

const mounted: (() => void)[] = [];

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
});

const frame = () => new Promise((resolve) => setTimeout(resolve, 30));

async function render(node: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <UiProvider locale="en-US" timeZone="Europe/London" navigate={() => undefined} toasts={createToasts()}>
      {node}
    </UiProvider>,
  );
  mounted.push(() => {
    root.unmount();
    host.remove();
  });
  await frame();
  await document.fonts.ready;
  await frame();
}

const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dayOnly = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'UTC' });

/** `days` daily points from 7 August 2026, labelled as the screens label them ("Aug 7", or the day alone). */
function days(count: number, format: Intl.DateTimeFormat): readonly ChartPoint[] {
  return Array.from({ length: count }, (_, at) => {
    const when = new Date(Date.UTC(2026, 7, 7 + at));
    return {
      id: String(at),
      label: monthDay.format(when),
      axisLabel: format.format(when),
      value: (at * 37) % 23,
      valueText: String((at * 37) % 23),
    };
  });
}

/** The drawn x labels' boxes, left to right. */
function labelBoxes(): readonly DOMRect[] {
  return [...document.querySelectorAll('svg text[text-anchor="middle"]')]
    .filter((each) => each.getAttribute('y') === String(240 - 12))
    .map((each) => each.getBoundingClientRect())
    .sort((a, b) => a.left - b.left);
}

describe('the x axis never runs its labels together (T7)', () => {
  for (const kind of ['bar', 'line'] as const) {
    for (const [name, format] of [
      ['month and day', monthDay],
      ['day alone', dayOnly],
    ] as const) {
      for (const count of [7, 30, 89, 365]) {
        for (const width of [280, 520, 1100, 2400]) {
          it(`${kind}, ${name}, ${String(count)} days at ${String(width)}px`, async () => {
            await page.viewport(Math.max(width + 40, 400), 600);
            await render(
              <ChartPlot kind={kind} label="Views" points={days(count, format)} width={width} formatTick={String} />,
            );
            const boxes = labelBoxes();
            expect(boxes.length).toBeGreaterThan(0);
            for (let at = 1; at < boxes.length; at += 1) {
              const before = boxes[at - 1];
              const box = boxes[at];
              if (before === undefined || box === undefined) continue;
              // At least a few pixels of air between neighbours.
              expect(box.left - before.right).toBeGreaterThanOrEqual(2);
            }
          });
        }
      }
    }
  }
});
