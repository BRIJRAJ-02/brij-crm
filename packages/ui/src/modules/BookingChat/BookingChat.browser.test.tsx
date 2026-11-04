// Book by chat in a real browser (4 November 2026). Two things the owner's team hit on the live page:
// - While the times loaded, the chat's place showed two grey bars in an empty card. Its loading shape is now the
//   chat's own: the greeting's bubble, a day's times and the prompt box, each where the loaded chat puts it.
// - On an iPhone the prompt box sat below Safari's toolbar, at the foot of a card taller than the screen. It now
//   keeps to the foot of the window while the card is on it, and the host's face sits beside their name, so the
//   chat starts on the first screen.
// The library's layers first, as every page loads them: a module's CSS loaded ahead would declare its layer first.
import '../../styles/index.css';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { createToasts } from '../../provider/toasts.tsx';
import { UiProvider } from '../../provider/UiProvider.tsx';
import { BookingFrame } from '../BookingFrame/BookingFrame.tsx';
import { Button } from '../../atoms/Button/Button.tsx';
import { MonthTiles } from '../MonthTiles/MonthTiles.tsx';
import { SlotList } from '../SlotList/SlotList.tsx';
import { BookingChat, type BookingChatLine } from './BookingChat.tsx';
import { BookingChatGhost } from './BookingChatGhost.tsx';

/** How far apart a loading region and the loaded one may stand, in pixels. */
const TOLERANCE = 4;

let host: HTMLElement;
let view: Root | undefined;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  view = createRoot(host);
});

afterEach(async () => {
  act(() => {
    view?.unmount();
  });
  view = undefined;
  host.remove();
  globalThis.scrollTo(0, 0);
  await page.viewport(1280, 800);
});

function draw(children: ReactNode): void {
  act(() => {
    view?.render(
      <UiProvider locale="en-GB" timeZone="Asia/Dubai" toasts={createToasts()} navigate={() => undefined}>
        {children}
      </UiProvider>,
    );
  });
}

const GREETING: BookingChatLine = {
  id: 'greeting',
  role: 'assistant',
  text: 'Hi, I’m Brijraj. When suits you for a 30 min meeting?',
  days: [
    {
      day: 'Wed, Nov 4',
      times: ['13:00', '13:30', '14:00', '14:30', '15:00', '15:30'].map((label) => ({
        id: label,
        label,
        name: label,
      })),
    },
  ],
  suggestions: ['Something later', 'Next week'],
  prompt: 'When works for you?',
};

const ignore = () => undefined;
const HOST = { name: 'Brijraj Rana', label: 'Brijraj' };
const BOOK = 'Book';

/** The chat (or its ghost) in a box the size the booking card gives it. */
function inCard(children: ReactNode) {
  host.style.display = 'flex';
  host.style.flexDirection = 'column';
  host.style.inlineSize = '360px';
  host.style.blockSize = '640px';
  return children;
}

/** Where `element` stands, relative to the box it was drawn in. */
function placeOf(element: Element | null | undefined): { top: number; bottom: number; height: number } {
  const box = host.getBoundingClientRect();
  const rect = element?.getBoundingClientRect();
  if (rect === undefined) throw new Error('Nothing drawn there.');
  return { top: rect.top - box.top, bottom: rect.bottom - box.top, height: rect.height };
}

describe('Book by chat while its times load', () => {
  it('holds the host’s name and face, the greeting’s, the times’ and the prompt box’s places, not two bars', async () => {
    // A wide page, where the card keeps the month's height and the prompt box stands at its foot.
    await page.viewport(1280, 800);
    draw(inCard(<BookingChatGhost />));
    const ghost = host.querySelector('[aria-busy="true"]');
    // The host's name, their face, the bubble, the day's six times: more than two shapes.
    expect(ghost?.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(9);
    const said = ghost?.children[1];
    const ghostPlaces = {
      who: placeOf(ghost?.firstElementChild),
      face: placeOf(said?.firstElementChild),
      bubble: placeOf(said?.lastElementChild),
      time: placeOf(ghost?.querySelector('li')),
      // The prompt box's place stands after the thread, at the foot.
      composer: placeOf(host.lastElementChild),
    };

    draw(inCard(<BookingChat lines={[GREETING]} host={HOST} onSend={ignore} onPickTime={ignore} />));
    const loaded = {
      who: placeOf(host.querySelector('[class*="who"]')),
      face: placeOf(host.querySelector('[class*="face"]')),
      bubble: placeOf(host.querySelector('[role="log"] p')),
      time: placeOf(host.querySelector('[role="log"] button')),
      composer: placeOf(host.querySelector('textarea, input')?.closest('[class*="composer"]')),
    };

    expect(Math.abs(ghostPlaces.who.top - loaded.who.top)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(ghostPlaces.face.bottom - loaded.face.bottom)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(ghostPlaces.bubble.top - loaded.bubble.top)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(ghostPlaces.time.top - loaded.time.top)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(ghostPlaces.time.height - loaded.time.height)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(ghostPlaces.composer.bottom - loaded.composer.bottom)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(ghostPlaces.composer.height - loaded.composer.height)).toBeLessThanOrEqual(TOLERANCE);
  });
});

describe('Book by chat on a phone', () => {
  const frame = (lines: readonly BookingChatLine[] = [GREETING]) => (
    <BookingFrame
      host={{ name: 'Brijraj Rana' }}
      title="meeting"
      facts={[
        { id: 'meeting', icon: 'video', children: '30 min · Video call' },
        { id: 'zone', icon: 'globe', children: 'Dubai time GMT+4' },
      ]}
      heading="Choose a time"
      // As the page draws it: the month, the day's times under it on a phone, and the Book bar, all under the chat.
      aside={<SlotList heading="" slots={[]} value={undefined} onChange={ignore} layout="column" isLoading />}
      footer={
        <Button variant="primary" size="lg" isFullWidth="center" isDisabled>
          {BOOK}
        </Button>
      }
      view="chat"
      cover={<BookingChat lines={lines} host={HOST} onSend={ignore} onPickTime={ignore} />}
    >
      <MonthTiles
        month="2026-11"
        today="2026-11-04"
        openDays={new Set(['2026-11-04'])}
        value="2026-11-04"
        onChange={ignore}
        onMonthChange={ignore}
        canPrevious={false}
        canNext
      />
    </BookingFrame>
  );

  it('brings a later reply’s times into view above the prompt box, the page the only scroller', async () => {
    await page.viewport(375, 667);
    draw(frame());
    globalThis.scrollTo(0, 0);
    const reply: BookingChatLine = {
      id: 'a1',
      role: 'assistant',
      text: 'Here’s when I’m free Thursday.',
      days: [
        { day: 'Thu, Nov 5', times: (GREETING.days?.[0]?.times ?? []).map((time) => ({ ...time, id: `t${time.id}` })) },
      ],
    };
    draw(frame([GREETING, { id: 'v1', role: 'visitor', text: 'thursday' }, reply]));
    await new Promise((resolve) => globalThis.setTimeout(resolve, 900));
    const thread = host.querySelector('[role="log"]');
    // The thread scrolls nothing itself: the page does.
    expect(thread?.scrollHeight).toBeLessThanOrEqual((thread?.clientHeight ?? 0) + 1);
    const times = [...host.querySelectorAll('[role="log"] > :last-child li button')];
    expect(times).toHaveLength(6);
    const lastTime = times.at(-1)?.getBoundingClientRect();
    const composer = host.querySelector('textarea, input')?.closest('[class*="composer"]')?.getBoundingClientRect();
    expect(lastTime).toBeDefined();
    expect(lastTime?.bottom ?? Infinity).toBeLessThanOrEqual(composer?.top ?? 0);
    expect(lastTime?.top ?? -1).toBeGreaterThan(0);
  });

  for (const [width, height] of [
    [390, 844],
    [375, 667],
  ] as const) {
    it(`keeps the prompt box on the first screen at ${String(width)} × ${String(height)}`, async () => {
      await page.viewport(width, height);
      draw(frame());
      globalThis.scrollTo(0, 0);
      const field = host.querySelector('textarea, input[type="text"]');
      const composer = field?.closest('[class*="composer"]');
      const rect = composer?.getBoundingClientRect();
      expect(rect).toBeDefined();
      // On screen, at the window's foot, not below it.
      expect(rect?.bottom ?? Infinity).toBeLessThanOrEqual(globalThis.innerHeight);
      expect(rect?.top ?? -1).toBeGreaterThan(0);
      // The face beside the name: the name starts level with the picture, not under it.
      const name = host.querySelector('aside p');
      const face = host.querySelector('aside [aria-hidden="true"], aside img');
      const nameTop = name?.getBoundingClientRect().top ?? 0;
      const faceBox = face?.getBoundingClientRect();
      expect(nameTop).toBeLessThan(faceBox?.bottom ?? 0);
      // The greeting starts on the first screen too.
      const bubble = host.querySelector('[role="log"] p');
      expect(bubble?.getBoundingClientRect().top ?? Infinity).toBeLessThan(height);
    });
  }
});
