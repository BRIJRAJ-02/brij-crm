// The public pages' loading shape, measured in a real browser (24 October
// 2026, the owner: "no flash no nothing"): what a visitor sees before the
// page's facts arrive has to be the shape of what arrives, or the page moves
// under them. These hold the loading rail and the loading profile card to the
// loaded ones, so a change to either side that parts them fails here rather
// than on a visitor's phone.
// The library's layers first, as every page loads them: a module's CSS loaded ahead would declare its layer first.
import '../../styles/index.css';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { createToasts } from '../../provider/toasts.tsx';
import { UiProvider } from '../../provider/UiProvider.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { MonthTiles } from '../MonthTiles/MonthTiles.tsx';
import { BookingFrame, BookingProfile, type BookingFact } from './BookingFrame.tsx';

/** How far apart a loading region and the loaded one may stand, in pixels. */
const TOLERANCE = 8;

let host: HTMLElement;
let view: Root | undefined;

beforeEach(() => {
  host = document.createElement('div');
  // A page's width, so the rail and the card take the page layout, not the stacked one.
  host.style.inlineSize = '1280px';
  document.body.append(host);
  view = createRoot(host);
});

afterEach(() => {
  act(() => {
    view?.unmount();
  });
  view = undefined;
  host.remove();
});

/** Draws `children` inside the public pages' provider. */
function draw(children: ReactNode): void {
  act(() => {
    view?.render(
      <UiProvider locale="en-GB" timeZone="Europe/London" toasts={createToasts()} navigate={() => undefined}>
        {children}
      </UiProvider>,
    );
  });
}

/** The height of the one region `selector` names, or 0 when it isn't there. */
function heightOf(selector: string): number {
  return host.querySelector(selector)?.getBoundingClientRect().height ?? 0;
}

/** What a booking page's rail says while its times show: the meeting, the zone, then its rules, quietly. */
const FACTS: readonly BookingFact[] = [
  { id: 'meeting', icon: 'video', children: '30 min · Video call' },
  { id: 'zone', icon: 'globe', children: 'London time GMT+1' },
  { id: 'rules', icon: 'clock', isQuiet: true, children: 'Up to 60 days ahead' },
];

describe('a booking page before its facts arrive', () => {
  it('draws the name, the meeting and the facts in the rows they will take', () => {
    // The description is left out on purpose: how many lines a host's own words wrap to is not knowable before
    // they arrive, so the loading rail draws the two lines most of them take and no test can hold it tighter.
    draw(<BookingFrame heading="Choose a time" />);
    const ghost = { names: heightOf('aside > div > div'), facts: heightOf('aside ul') };
    draw(<BookingFrame host={{ name: 'Ada Lovelace' }} title="Intro call" facts={FACTS} heading="Choose a time" />);
    const real = { names: heightOf('aside > div > div'), facts: heightOf('aside ul') };
    expect(ghost.names).toBeGreaterThan(0);
    expect(ghost.facts).toBeGreaterThan(0);
    expect(Math.abs(ghost.names - real.names)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(ghost.facts - real.facts)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('draws the picture at the size the picture will be', () => {
    draw(<BookingFrame heading="Choose a time" />);
    const ghost = heightOf('aside [data-shape="circle"]');
    draw(<BookingFrame host={{ name: 'Ada Lovelace' }} title="Intro call" heading="Choose a time" />);
    // The identity's first child is the host's picture.
    const avatar = heightOf('aside > div > :first-child');
    expect(ghost).toBeGreaterThan(0);
    expect(Math.abs(ghost - avatar)).toBeLessThanOrEqual(1);
  });

  it('closes the host’s block with their social links, moving nothing above them', () => {
    const socials = [
      { network: 'linkedin', href: 'https://linkedin.com/in/ada', label: 'ada' },
      { network: 'website', href: 'https://ada.dev', label: 'ada.dev' },
    ] as const;
    draw(<BookingFrame host={{ name: 'Ada Lovelace' }} title="Intro call" facts={FACTS} heading="Choose a time" />);
    const before = {
      names: heightOf('aside > div > div'),
      facts: host.querySelector('aside ul')?.getBoundingClientRect().top,
    };
    draw(
      <BookingFrame
        host={{ name: 'Ada Lovelace', socials: [...socials] }}
        title="Intro call"
        facts={FACTS}
        heading="Choose a time"
      />,
    );
    const identity = host.querySelector('aside > div');
    const row = identity?.lastElementChild;
    expect(row?.getAttribute('aria-label')).toBe('Ada Lovelace’s social links');
    expect(row?.querySelectorAll('a')).toHaveLength(2);
    // Every link's hit area is at least 32px, and the first mark starts where the block's lines do: stacked (this
    // project's phone sized window), the facts' edge, since the name now sits beside the face (4 November 2026).
    for (const link of row?.querySelectorAll('a') ?? []) {
      expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(30);
    }
    const edge = host.querySelector('aside ul')?.getBoundingClientRect().left ?? 0;
    const mark = row?.querySelector('img, svg')?.getBoundingClientRect().left ?? 0;
    expect(Math.abs(mark - edge)).toBeLessThanOrEqual(1);
    expect(heightOf('aside > div > div')).toBe(before.names);
    expect(host.querySelector('aside ul')?.getBoundingClientRect().top).toBe(before.facts);
  });

  it('draws no social links on a team page, whatever it is given (AC-754)', () => {
    draw(
      <BookingFrame
        host={{
          name: 'Acme',
          team: { people: [{ id: 'a', name: 'A' }], total: 1, label: 'Team of 1' },
          socials: [{ network: 'x', href: 'https://x.com/ada', label: '@ada' }],
        }}
        title="Intro call with Acme"
        heading="Choose a time"
      />,
    );
    expect(host.querySelector('aside a[href="https://x.com/ada"]')).toBeNull();
  });

  it('draws no entrance on the rail or the card, so the frame is simply there', () => {
    draw(<BookingFrame host={{ name: 'Ada Lovelace' }} title="Intro call" heading="Choose a time" />);
    for (const part of host.querySelectorAll('aside > div, section')) {
      expect(part.getAnimations()).toHaveLength(0);
    }
  });
});

describe('a profile before its person arrives', () => {
  it('draws a card the height the person’s card will be', () => {
    draw(<BookingProfile />);
    const loading = heightOf('header');
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    // The picture's place and two rows of text: the page adds the links' own rows under it.
    expect(host.querySelectorAll('[data-shape]')).toHaveLength(3);
    draw(<BookingProfile person={{ name: 'Ada Lovelace', id: 'ada', bio: 'Engineer, and I like short meetings.' }} />);
    const loaded = heightOf('header');
    expect(loading).toBeGreaterThan(0);
    expect(Math.abs(loading - loaded)).toBeLessThanOrEqual(TOLERANCE);
  });
});

describe('a wide booking page in the window', () => {
  const month = { aside: <p>Times</p>, footer: <button type="button">Book</button> };
  const tall = <Skeleton shape="block" lines={8} />;
  const rect = (selector: string) => host.querySelector(selector)?.getBoundingClientRect();
  /** The room above and below the block, inside the page. */
  const gaps = () => {
    const main = rect('main');
    const layout = rect('main > div');
    return { above: (layout?.top ?? 0) - (main?.top ?? 0), below: (main?.bottom ?? 0) - (layout?.bottom ?? 0) };
  };

  afterEach(async () => {
    await page.viewport(414, 896);
  });

  it('sits in the middle of a tall window, and a step moves nothing', async () => {
    await page.viewport(1280, 1000);
    draw(
      <BookingFrame heading="Choose a time" view="month" {...month}>
        {tall}
      </BookingFrame>,
    );
    const atMonth = rect('section');
    expect(gaps().above).toBeGreaterThan(48);
    expect(Math.abs(gaps().above - gaps().below)).toBeLessThanOrEqual(1);
    draw(
      <BookingFrame heading="Choose a time" view="details" coverPlace="card" {...month} cover={<p>Your details</p>}>
        {tall}
      </BookingFrame>,
    );
    expect(rect('section')?.height).toBe(atMonth?.height);
    expect(rect('section')?.y).toBe(atMonth?.y);
    // The heading row stays in the layout, out of sight under the step.
    expect(host.querySelector('section h2')?.checkVisibility({ visibilityProperty: true })).toBe(false);
  });

  it('stands still paging from a five week month to a six week one', async () => {
    await page.viewport(1280, 1000);
    const atMonth = (shown: string) => (
      <BookingFrame heading="Choose a time" view="month" {...month}>
        <MonthTiles
          month={shown}
          today="2026-11-05"
          openDays={new Set()}
          value={undefined}
          onChange={() => undefined}
          onMonthChange={() => undefined}
          canPrevious
          canNext
          holdsHeight
        />
      </BookingFrame>
    );
    draw(atMonth('2026-11'));
    const five = rect('section');
    draw(atMonth('2027-01'));
    expect(rect('section')?.y).toBe(five?.y);
    expect(rect('section')?.height).toBe(five?.height);
  });

  it('grows the card for a step taller than the month, rather than clipping it', async () => {
    await page.viewport(1280, 1000);
    draw(
      <BookingFrame heading="Choose a time" view="month" {...month}>
        {tall}
      </BookingFrame>,
    );
    const atMonth = rect('section');
    draw(
      <BookingFrame
        heading="Choose a time"
        view="details"
        coverPlace="card"
        {...month}
        cover={
          <>
            {tall}
            {tall}
            {tall}
            {tall}
          </>
        }
      >
        {tall}
      </BookingFrame>,
    );
    expect(rect('section')?.height ?? 0).toBeGreaterThan(atMonth?.height ?? 0);
    expect(rect('.ws-booking-frame-cover')?.bottom ?? Infinity).toBeLessThanOrEqual(rect('section')?.bottom ?? 0);
  });

  it('starts at its padding and scrolls when taller than the window', async () => {
    await page.viewport(1280, 300);
    draw(
      <BookingFrame heading="Choose a time" view="month" {...month}>
        {tall}
      </BookingFrame>,
    );
    expect(gaps().above).toBe(48);
    expect(gaps().below).toBe(48);
    expect(rect('main')?.height ?? 0).toBeGreaterThan(300);
  });

  it('keeps the bar out of the column: the card starts level with the rail, with or without it', async () => {
    await page.viewport(1280, 1000);
    draw(
      <BookingFrame heading="Choose a time" view="month" {...month}>
        {tall}
      </BookingFrame>,
    );
    const without = rect('section');
    draw(
      <BookingFrame heading="Choose a time" view="month" {...month} bar={<button type="button">Connect</button>}>
        {tall}
      </BookingFrame>,
    );
    expect(rect('section')?.y).toBe(without?.y);
    expect(rect('section')?.y).toBe(rect('aside')?.y);
    expect(
      host.querySelector('section')?.previousElementSibling?.getBoundingClientRect().bottom ?? Infinity,
    ).toBeLessThanOrEqual(rect('section')?.y ?? 0);
  });

  it.each([
    ['a site’s embed', 1280, 1000, true],
    ['a phone', 390, 844, false],
  ] as const)('leaves %s starting from the top, the step hugging its content', async (_, width, height, isEmbedded) => {
    await page.viewport(width, height);
    draw(
      <BookingFrame heading="Choose a time" view="month" {...month} isEmbedded={isEmbedded}>
        {tall}
      </BookingFrame>,
    );
    const atMonth = rect('section');
    const above = gaps().above;
    expect(above).toBeLessThanOrEqual(32);
    draw(
      <BookingFrame
        heading="Choose a time"
        view="details"
        coverPlace="card"
        {...month}
        isEmbedded={isEmbedded}
        cover={<p>Your details</p>}
      >
        {tall}
      </BookingFrame>,
    );
    expect(gaps().above).toBe(above);
    expect(rect('section')?.height ?? Infinity).toBeLessThan(atMonth?.height ?? 0);
  });
});

describe('a booking card switching views', () => {
  /** The card's month: a tall pane, the times beside it, and the Book bar. */
  const month = { aside: <p>Times</p>, footer: <button type="button">Book</button> };
  // Eight blocks, about 440 px: a month's height.
  const tall = (
    <div>
      Month
      <Skeleton shape="block" lines={8} />
    </div>
  );
  const card = () => host.querySelector('section')?.getBoundingClientRect();

  it('keeps the card the month’s size whichever view covers it, on a wide page', async () => {
    await page.viewport(1280, 900);
    draw(
      <BookingFrame heading="Choose a time" view="month" {...month}>
        {tall}
      </BookingFrame>,
    );
    const atMonth = card();
    // A short List and a long chat: neither sets the card's size.
    draw(
      <BookingFrame heading="Choose a time" view="list" {...month} cover={<p>Days</p>} coverFooter={month.footer}>
        {tall}
      </BookingFrame>,
    );
    const atList = card();
    draw(
      <BookingFrame heading="Choose a time" view="chat" {...month} cover={<Skeleton shape="block" lines={20} />}>
        {tall}
      </BookingFrame>,
    );
    const atChat = card();
    expect(atMonth?.height).toBeGreaterThan(200);
    expect(atList?.height).toBe(atMonth?.height);
    expect(atChat?.height).toBe(atMonth?.height);
    expect(atChat?.y).toBe(atMonth?.y);
    await page.viewport(414, 896);
  });

  it('lets Book by chat set the card’s height on a phone, so the page is the one scroller', async () => {
    await page.viewport(390, 844);
    draw(
      <BookingFrame heading="Choose a time" view="month" {...month}>
        {tall}
      </BookingFrame>,
    );
    const atMonth = card();
    draw(
      <BookingFrame heading="Choose a time" view="chat" {...month} cover={<p>Hi</p>}>
        {tall}
      </BookingFrame>,
    );
    const atChat = card();
    // A one line chat: a short card, not the month's tall one.
    expect(atChat?.height ?? Infinity).toBeLessThan((atMonth?.height ?? 0) / 2);
    await page.viewport(414, 896);
  });

  it('hides the month under a cover from the reading order and from the keyboard', () => {
    draw(
      <BookingFrame heading="Choose a time" view="list" {...month} cover={<p>Days</p>}>
        {tall}
      </BookingFrame>,
    );
    const under = host.querySelector('[inert]');
    expect(under?.textContent).toContain('Month');
    expect(getComputedStyle(under ?? document.body).visibility).toBe('hidden');
  });

  it('fades only a view chosen after the first paint', () => {
    draw(
      <BookingFrame heading="Choose a time" view="list" {...month} cover={<p>Days</p>}>
        {tall}
      </BookingFrame>,
    );
    expect(host.querySelector('[data-moved]')).toBeNull();
    draw(
      <BookingFrame heading="Choose a time" view="chat" {...month} cover={<p>Chat</p>}>
        {tall}
      </BookingFrame>,
    );
    expect(host.querySelector('[data-moved]')).not.toBeNull();
  });
});
