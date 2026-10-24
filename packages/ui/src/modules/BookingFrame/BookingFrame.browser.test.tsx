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
import { createToasts } from '../../provider/toasts.tsx';
import { UiProvider } from '../../provider/UiProvider.tsx';
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

const FACTS: readonly BookingFact[] = [
  { id: 'meeting', icon: 'video', children: '30 min · Video call' },
  { id: 'zone', icon: 'globe', children: 'London time GMT+1' },
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
    // Every link's hit area is at least 32px, and the first mark starts where the name does.
    for (const link of row?.querySelectorAll('a') ?? []) {
      expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(30);
    }
    const name = host.querySelector('aside p')?.getBoundingClientRect().left ?? 0;
    const mark = row?.querySelector('img, svg')?.getBoundingClientRect().left ?? 0;
    expect(Math.abs(mark - name)).toBeLessThanOrEqual(1);
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
