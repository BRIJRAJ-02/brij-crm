// Inter arriving late (merge B, 21 October 2026): Inter is font-display: swap, so on a cold visit text can paint in
// the fallback face first. A list React Aria's Virtualizer measures (a record's notes) measured its rows in the
// fallback and kept those heights when Inter swapped in, and the rows overlapped. On a cold cache, with Inter held
// back until the notes' rows are drawn (so they are measured in the fallback face), the rows must not overlap once
// Inter is in, and the layout shift is recorded beside it (the "fonts" annotation): the fix is the index.html
// preload and the lists measuring again when the fonts finish loading (useFontsSettled).
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, newWorkspace } from './people.ts';

const RECORD_URL = /\/w\/[^/]+\/objects\/people\/([0-9a-f-]{36})\/overview$/;

/** A UUID v7: the time first, then random bits, as the API asks of a new note's id. */
function uuidV7(): string {
  const hex = Date.now().toString(16).padStart(12, '0');
  const random = randomUUID().replaceAll('-', '');
  const variant = ((Number.parseInt(random.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${random.slice(13, 16)}-${variant}${random.slice(17, 20)}-${random.slice(20, 32)}`;
}

/** Calls one oRPC procedure as the page's signed in person, from the app's own origin. */
async function rpc(page: Page, procedure: string, input: unknown): Promise<void> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(`/api/rpc/${procedure}`, { data: { json: input }, headers: { origin } });
  expect(response.ok(), `${procedure}: ${await response.text()}`).toBe(true);
}

/** A note's body: one paragraph `length` characters long, of words of mixed length. */
const body = (length: number) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'They want forty seats by March, and a call with legal on the renewal terms first. '
            .repeat(4)
            .slice(0, length),
        },
      ],
    },
  ],
});

test('a record’s notes never overlap when Inter arrives after they are drawn', async ({ page, browser }, info) => {
  test.skip(
    process.env.FLOW_FONTS_ANY_WIDTH === undefined && (page.viewportSize()?.width ?? 0) < 1000,
    'The record page runs at desktop width.',
  );
  test.setTimeout(240_000);
  const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
  const slug = `fonts-${tag}`;
  await newWorkspace(page, `fonts-${tag}@example.com`, slug);
  await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
  await page
    .getByRole('rowheader', { name: /Grace Hopper/ })
    .getByText('Grace Hopper')
    .click();
  await expect(page).toHaveURL(RECORD_URL);
  const recordId = RECORD_URL.exec(page.url())?.[1] ?? '';
  // Twenty notes whose excerpts run, three characters at a time, from inside a line to past it, so some wrap to a
  // second line in one face and not the other: their rows change height when Inter swaps in.
  for (let index = 0; index < 20; index += 1) {
    await rpc(page, 'notes/save', {
      workspace: slug,
      id: uuidV7(),
      recordId,
      title: `Kickoff call ${String(index + 1)}`,
      content: body(70 + 3 * index),
      mutationId: uuidV7(),
    });
  }

  // A cold cache: a new context, signed in with the same cookies, Inter held back.
  const cold = await browser.newContext({ storageState: await page.context().storageState() });
  const fresh = await cold.newPage();
  // Inter waits until the rows are drawn, so they are measured in the fallback face first.
  let releaseFont: () => void = () => undefined;
  const fontGate = new Promise<void>((resolve) => {
    releaseFont = resolve;
  });
  await fresh.route(/Inter-Variable-latin[^/]*\.woff2$/, async (route) => {
    await fontGate;
    await route.continue();
  });
  await fresh.addInitScript(() => {
    const shifts: number[] = [];
    (window as unknown as { __shifts: number[] }).__shifts = shifts;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number }[]) shifts.push(entry.value);
    }).observe({ type: 'layout-shift', buffered: true });
  });
  // Not waiting for the load event: with the preload, the held font is part of it.
  await fresh.goto(`/w/${slug}/objects/people/${recordId}/notes`, { waitUntil: 'commit' });
  const rows = fresh.getByRole('grid', { name: 'Notes' }).getByRole('row');
  // The rows in view (the list is virtualised): at least eight of the twelve.
  await expect(rows.nth(7)).toBeVisible();
  await fresh.waitForTimeout(300);
  // Whether Inter is still on its way (Chromium's fonts.check answers true while a face loads, so ask the face).
  const isInterIn = () => [...document.fonts].some((face) => face.family === 'Inter' && face.status === 'loaded');
  const inFallback = !(await fresh.evaluate(isInterIn));
  // Each row's text box in the fallback face, to see which change size when Inter arrives.
  const textHeights = () =>
    fresh.evaluate(() =>
      [...document.querySelectorAll('[role="grid"][aria-label="Notes"] [role="row"]')].map((row) =>
        Math.round(
          [...row.querySelectorAll('span, p')].reduce((sum, part) => sum + part.getBoundingClientRect().height, 0),
        ),
      ),
    );
  const before = await textHeights();
  releaseFont();
  await fresh.waitForFunction(isInterIn);
  await fresh.waitForTimeout(500);
  const result = await fresh.evaluate(() => {
    const boxes = [...document.querySelectorAll('[role="grid"][aria-label="Notes"] [role="row"]')]
      .map((row) => row.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);
    const overlaps = boxes.slice(1).filter((box, index) => box.top < (boxes[index]?.bottom ?? 0) - 1).length;
    const shift = (window as unknown as { __shifts: number[] }).__shifts.reduce((sum, value) => sum + value, 0);
    return { overlaps, shift: Number(shift.toFixed(4)), rows: boxes.length };
  });
  const after = await textHeights();
  const textChanged = after.filter((height, index) => height !== before[index]).length;
  // The race was run: the rows were drawn before Inter arrived.
  expect(inFallback).toBe(true);
  info.annotations.push({ type: 'fonts', description: JSON.stringify({ ...result, textChanged }) });
  await cold.close();
  expect(result.overlaps).toBe(0);
});
