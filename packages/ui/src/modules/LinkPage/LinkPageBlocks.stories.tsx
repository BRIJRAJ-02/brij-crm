// Spec 0061's blocks on a link page: thumbnails and featured cards, the grid, the socials row, media behind its
// facade, a picture, a gallery and its viewer, next times, the banner, the notice sheet and further contact cards.
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { probeAlignment } from '../../lib/alignment-probe.ts';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { BookingFoot } from '../BookingFrame/BookingFrame.tsx';
import { LinkPage, LinkPageHold, type LinkPageBlock, type LinkPagePicture, type PageLook } from './LinkPage.tsx';

/** The look a page has never touched. */
const PLAIN: PageLook = {
  ground: 'plain',
  hue: 'blue',
  mode: 'light',
  shape: 'soft',
  fill: 'plain',
  font: 'sans',
  gradient: 'dawn',
  pattern: 'dots',
  header: 'centred',
  avatar: 'circle',
};

/**
 * A picture on our origin as the api would serve it, stood in for by a `data:` image: two tints, a horizon and a
 * sun, so a thumbnail, a poster or a gallery reads as a photo in the screenshots without one.
 */
function photo(sky: string, ground: string, width = 1200, height = 800): LinkPagePicture {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(height)}">` +
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/>` +
    `<stop offset="1" stop-color="${ground}"/></linearGradient></defs>` +
    `<rect width="${String(width)}" height="${String(height)}" fill="url(#s)"/>` +
    `<circle cx="${String(width * 0.7)}" cy="${String(height * 0.35)}" r="${String(height * 0.12)}" fill="#fff8e7" opacity="0.9"/>` +
    `<path d="M0 ${String(height * 0.75)} Q ${String(width * 0.3)} ${String(height * 0.55)} ${String(width * 0.6)} ${String(height * 0.72)} T ${String(width)} ${String(height * 0.68)} V ${String(height)} H 0 Z" fill="#1f2937" opacity="0.35"/>` +
    `</svg>`;
  return { src: `data:image/svg+xml,${encodeURIComponent(svg)}`, width, height };
}

const DAWN = photo('#fbcfe8', '#fde68a');
const SEA = photo('#bae6fd', '#1e3a8a');
const MOSS = photo('#d9f99d', '#166534');
const DUSK = photo('#c4b5fd', '#7c2d12');
const TALL = photo('#e0e7ff', '#312e81', 800, 1200);

/** Waits until every picture on the page has decoded (or failed), so a screenshot never catches one mid load. */
async function picturesDrawn(root: HTMLElement) {
  await Promise.all(
    [...root.ownerDocument.querySelectorAll('img')].map((image) => image.decode().catch(() => undefined)),
  );
}

const PERSON = {
  name: 'Anish Gupta',
  id: 'anish',
  bio: 'Cofounder at Timefix. Ask me about scheduling that books itself.',
};

const meta = {
  title: 'Modules/LinkPage/Blocks',
  component: LinkPage,
  args: {
    person: PERSON,
    foot: <BookingFoot page="booking_profile" claimHref="https://www.timefix.com/?utm_content=claim_link" />,
    onPress: fn(),
  },
  render: (args) => (
    <Stage width="fill" height="page">
      <LinkPage {...args} />
    </Stage>
  ),
} satisfies Meta<typeof LinkPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Rows with their own pictures, and two featured cards: one with a picture, one without (AC-6101, AC-6102). */
function featuredBlocks(): readonly LinkPageBlock[] {
  return [
    {
      kind: 'link',
      id: 'launch',
      title: 'Timefix 2.0 is out',
      href: 'https://www.timefix.com/blog/two',
      note: 'What changed, in two minutes',
      hue: 'blue',
      thumb: DAWN,
      style: 'featured',
    },
    {
      kind: 'link',
      id: 'podcast',
      title: 'On the Founders podcast',
      href: 'https://example.com/ep/12',
      hue: 'purple',
      thumb: SEA,
    },
    {
      kind: 'link',
      id: 'deck',
      title: 'Our deck',
      href: 'https://example.com/deck',
      note: 'Ten slides',
      hue: 'green',
      thumb: MOSS,
    },
    {
      kind: 'link',
      id: 'broken',
      title: 'A picture that fails',
      href: 'https://example.com/b',
      hue: 'orange',
      thumb: { src: '/does-not-exist.png', width: 40, height: 40 },
    },
    {
      kind: 'link',
      id: 'newsletter',
      title: 'The Friday letter',
      href: 'https://example.com/letter',
      note: 'One email a week, nothing else',
      hue: 'sky',
      style: 'featured',
    },
  ];
}

/** Thumbnails in their tiles, a broken one falling back to its letter, and featured cards that never animate in. */
export const ThumbnailsAndFeatured: Story = {
  args: { blocks: featuredBlocks() },
  play: async ({ canvas, canvasElement }) => {
    await settleAnimations();
    const launch = canvas.getByRole('link', { name: /Timefix 2\.0 is out/ });
    await expect(launch).toHaveAttribute('data-featured', '');
    // Emphasis by size and place only: no animation of its own on the first paint (AC-6102).
    await expect(getComputedStyle(launch).animationName).toBe('none');
    const row = canvas.getByRole('link', { name: /On the Founders podcast/ });
    await expect(launch.getBoundingClientRect().height).toBeGreaterThan(row.getBoundingClientRect().height * 2);
    // The picture that fails gives way to the link's letter, never a broken image.
    await waitFor(() =>
      expect(
        canvas.getByRole('link', { name: /A picture that fails/ }).querySelector('[data-tile="letter"]'),
      ).not.toBeNull(),
    );
    const report = probeAlignment({ root: 'main', ignoreSpacing: '*' });
    await expect(report.failures).toEqual([]);
    await picturesDrawn(canvasElement);
  },
};

/** A grid page's blocks: tiles of three sizes, with headings, writing and a form across the whole row (AC-6103). */
function gridBlocks(): readonly LinkPageBlock[] {
  return [
    {
      kind: 'link',
      id: 'site',
      title: 'timefix.com',
      href: 'https://www.timefix.com',
      hue: 'sky',
      icon: 'globe',
      size: 'small',
    },
    { kind: 'link', id: 'x', title: 'X', href: 'https://x.com/anish', mark: 'x', hue: 'gray', size: 'small' },
    {
      kind: 'link',
      id: 'launch',
      title: 'Timefix 2.0 is out',
      href: 'https://www.timefix.com/blog/two',
      note: 'What changed',
      hue: 'blue',
      thumb: DAWN,
      size: 'large',
    },
    {
      kind: 'page',
      id: 'intro',
      title: 'Intro call',
      href: '/anish/intro-call',
      facts: '15 min · 30 min',
      size: 'wide',
    },
    { kind: 'heading', id: 'work', title: 'Work' },
    { kind: 'text', id: 'about', body: 'I help sales teams stop playing calendar tennis.' },
    {
      kind: 'link',
      id: 'deck',
      title: 'Our deck',
      href: 'https://example.com/deck',
      hue: 'green',
      thumb: MOSS,
      size: 'wide',
    },
    {
      kind: 'link',
      id: 'podcast',
      title: 'Podcast',
      href: 'https://example.com/ep',
      hue: 'purple',
      thumb: SEA,
      size: 'small',
    },
    { kind: 'link', id: 'blog', title: 'Blog', href: 'https://example.com/blog', hue: 'orange', size: 'small' },
    { kind: 'form', id: 'ask', title: 'Ask me anything', href: '/f/ask', line: 'Three questions' },
  ];
}

/** Every tile's top left corner, in the DOM's order. */
function cornersOf(root: HTMLElement) {
  return [...root.querySelectorAll(':scope > li')].map((tile) => {
    const box = tile.getBoundingClientRect();
    return { top: Math.round(box.top), left: Math.round(box.left), width: Math.round(box.width) };
  });
}

/** In reading order: each tile below the one before it, or on its row and to its right. */
async function expectReadingOrder(root: HTMLElement) {
  const corners = cornersOf(root);
  for (const [index, corner] of corners.entries()) {
    const before = corners[index - 1];
    if (before === undefined) continue;
    await expect(corner.top > before.top || (corner.top === before.top && corner.left > before.left)).toBe(true);
  }
}

/** A grid page at a phone's width: two columns, the tiles in the owner's order, a heading and writing across. */
export const Grid: Story = {
  args: { blocks: gridBlocks(), pageLayout: 'grid' },
  render: (args) => (
    <Stage width="phone">
      <LinkPage {...args} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await settleAnimations();
    const lists = canvasElement.querySelectorAll('ul');
    const first = lists[0];
    if (first === undefined) throw new Error('The tiles draw');
    // Two columns: the second small tile sits beside the first, the large one under them both.
    const [site, x, launch] = cornersOf(first);
    await expect(x?.top).toBe(site?.top);
    await expect(launch?.top).toBeGreaterThan(site?.top ?? 0);
    await expect(launch?.width).toBe((site?.width ?? 0) * 2 + 8);
    await expectReadingOrder(first);
    // The focus order is the DOM's: Tab walks the tiles exactly in the order they show.
    const tiles = [...first.querySelectorAll('a')];
    tiles[0]?.focus();
    for (const tile of tiles.slice(1)) {
      await userEvent.tab();
      await expect(document.activeElement).toBe(tile);
    }
    await expect(canvas.getByRole('heading', { name: 'Work' })).toBeVisible();
  },
};

/** The same grid with room for four columns: a tablet or a laptop. */
export const GridWide: Story = {
  args: { blocks: gridBlocks(), pageLayout: 'grid' },
  play: async ({ canvasElement }) => {
    await settleAnimations();
    const first = canvasElement.querySelector('ul');
    if (first === null) throw new Error('The tiles draw');
    const [site, x, launch, intro] = cornersOf(first);
    // Four columns: the two small tiles and the large one share the first row, the wide one goes beside them.
    await expect(x?.top).toBe(site?.top);
    await expect(launch?.top).toBe(site?.top);
    await expect(intro?.top).toBeGreaterThan(site?.top ?? 0);
    await expectReadingOrder(first);
    await picturesDrawn(canvasElement);
  },
};

/** The grid on a dark look, with every tile's picture and fallbacks. */
export const GridDark: Story = {
  args: {
    blocks: gridBlocks(),
    pageLayout: 'grid',
    theme: { ...PLAIN, ground: 'ink', mode: 'dark', fill: 'outline', shape: 'square' },
  },
  render: (args) => (
    <Stage width="phone">
      <LinkPage {...args} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await settleAnimations();
    await picturesDrawn(canvasElement);
  },
};

const SOCIAL_LINKS = [
  { network: 'linkedin', href: 'https://www.linkedin.com/in/anish', label: '@anish' },
  { network: 'x', href: 'https://x.com/anish', label: '@anish' },
  { network: 'instagram', href: 'https://www.instagram.com/anish', label: '@anish' },
  { network: 'website', href: 'https://anish.dev', label: 'anish.dev' },
] as const;

/** The socials row where the owner put it, between two links; the header's own row steps aside (AC-6104). */
export const SocialsRow: Story = {
  args: {
    socials: <p>The header’s own row</p>,
    blocks: [
      { kind: 'link', id: 'site', title: 'timefix.com', href: 'https://www.timefix.com', hue: 'sky', icon: 'globe' },
      { kind: 'socials', id: 'socials', links: SOCIAL_LINKS },
      { kind: 'link', id: 'deck', title: 'Our deck', href: 'https://example.com/deck', hue: 'green' },
    ],
  },
  play: async ({ canvas }) => {
    await settleAnimations();
    await expect(canvas.queryByText('The header’s own row')).toBeNull();
    const linkedin = canvas.getByRole('link', { name: 'LinkedIn, @anish' });
    await expect(linkedin).toHaveAttribute('href', 'https://www.linkedin.com/in/anish');
    // Placed where the owner put it: after the first link, before the deck.
    const site = canvas.getByRole('link', { name: /timefix\.com/ });
    const deck = canvas.getByRole('link', { name: /Our deck/ });
    await expect(linkedin.getBoundingClientRect().top).toBeGreaterThan(site.getBoundingClientRect().bottom);
    await expect(deck.getBoundingClientRect().top).toBeGreaterThan(linkedin.getBoundingClientRect().bottom);
  },
};

/** Media behind its facade (AC-6106): a video with its poster, a song without one. Nothing loads until Play. */
export const Media: Story = {
  args: {
    blocks: [
      {
        kind: 'media',
        id: 'talk',
        provider: 'youtube',
        title: 'Scheduling that books itself',
        frame: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0',
        poster: SEA,
      },
      {
        kind: 'media',
        id: 'song',
        provider: 'spotify',
        title: 'Focus playlist',
        frame: 'https://open.spotify.com/embed/playlist/37i9dQZF1DX0XUsuxWHRQd',
      },
    ],
  },
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Play Scheduling that books itself' })).toBeVisible(),
    );
    await expect(canvas.getByText('Plays from YouTube')).toBeVisible();
    await expect(canvas.getByText('Plays from Spotify')).toBeVisible();
    await expect(canvasElement.querySelector('iframe')).toBeNull();
    // A video's stage is 16 by 9, once the block's own stylesheet has arrived with its chunk.
    await waitFor(() => {
      const stage = canvas
        .getByRole('button', { name: 'Play Scheduling that books itself' })
        .closest('[role="presentation"]')
        ?.getBoundingClientRect() ?? { width: 0, height: 1 };
      return expect(Math.abs(stage.width / stage.height - 16 / 9)).toBeLessThan(0.02);
    });
    await picturesDrawn(canvasElement);
  },
};

/** One picture with its caption and link, and one with neither (AC-6108). */
export const Picture: Story = {
  args: {
    blocks: [
      {
        kind: 'image',
        id: 'stage',
        image: DUSK,
        alt: 'Anish on stage at SaaStr',
        caption: 'Talking calendars at SaaStr',
        href: 'https://example.com/talk',
      },
      { kind: 'image', id: 'tall', image: TALL, alt: 'The view from the office' },
    ],
  },
  play: async ({ canvas, canvasElement }) => {
    const picture = await canvas.findByRole('img', { name: 'Anish on stage at SaaStr' });
    await expect(picture).toHaveAttribute('width', '1200');
    await expect(picture).toHaveAttribute('loading', 'lazy');
    await expect(canvas.getByRole('link', { name: /Anish on stage/ })).toHaveAttribute(
      'rel',
      'noopener noreferrer nofollow',
    );
    await expect(canvas.getByText('Talking calendars at SaaStr')).toBeVisible();
    await picturesDrawn(canvasElement);
  },
};

const GALLERY = [
  { ...DAWN, alt: 'Morning at the offsite' },
  { ...SEA, alt: 'The team by the sea' },
  { ...MOSS, alt: 'A walk in the woods' },
  { ...DUSK, alt: 'Dinner at dusk' },
  { ...TALL, alt: 'The view from the office' },
];

/** A gallery as a swipe row: Previous and Next under it, each picture opening large in the viewer (AC-6109). */
export const GalleryRow: Story = {
  args: { blocks: [{ kind: 'gallery', id: 'offsite', images: GALLERY, display: 'row' }] },
  play: async ({ canvas, canvasElement }) => {
    const second = await canvas.findByRole('button', { name: 'The team by the sea, open large' });
    await userEvent.click(second);
    await settleAnimations();
    const viewer = within(document.body).getByRole('dialog', { name: 'The team by the sea' });
    await expect(within(viewer).getByText('2 of 5')).toBeVisible();
    // The arrow keys move through the pictures, and wrap.
    await userEvent.keyboard('{ArrowRight}');
    await expect(within(document.body).getByRole('dialog', { name: 'A walk in the woods' })).toBeVisible();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    await expect(within(document.body).getByRole('dialog', { name: 'The view from the office' })).toBeVisible();
    // Escape closes it, and focus goes back to the picture it was showing, the row scrolled to it.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'The view from the office, open large' })).toHaveFocus(),
    );
    await picturesDrawn(canvasElement);
  },
};

/** The same gallery as a grid of squares. */
export const GalleryGrid: Story = {
  args: { blocks: [{ kind: 'gallery', id: 'offsite', images: GALLERY, display: 'grid' }] },
  play: async ({ canvas, canvasElement }) => {
    const first = await canvas.findByRole('button', { name: 'Morning at the offsite, open large' });
    const second = canvas.getByRole('button', { name: 'The team by the sea, open large' });
    await expect(Math.round(first.getBoundingClientRect().top)).toBe(Math.round(second.getBoundingClientRect().top));
    await expect(Math.round(first.getBoundingClientRect().width)).toBe(
      Math.round(first.getBoundingClientRect().height),
    );
    await picturesDrawn(canvasElement);
  },
};

/** The viewer open over the page, as a visitor sees it. */
export const GalleryViewer: Story = {
  args: { blocks: [{ kind: 'gallery', id: 'offsite', images: GALLERY, display: 'row' }] },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Dinner at dusk, open large' }));
    await settleAnimations();
    const viewer = within(document.body).getByRole('dialog', { name: 'Dinner at dusk' });
    await expect(viewer).toBeVisible();
    await expect(within(viewer).getByRole('button', { name: 'Next picture' })).toBeVisible();
    await picturesDrawn(canvasElement);
  },
};

const TIMES_BLOCK = {
  kind: 'times',
  id: 'next',
  title: 'Intro call',
  href: '/anish/intro-call',
  duration: 30,
} as const;

/** Next open times (AC-6110): chips in the visitor's zone, each opening the booking page at that time. */
export const Times: Story = {
  args: {
    blocks: [
      {
        ...TIMES_BLOCK,
        times: {
          status: 'ready',
          starts: [
            '2026-10-08T15:00:00.000Z',
            '2026-10-08T15:30:00.000Z',
            '2026-10-09T09:00:00.000Z',
            '2026-10-09T13:30:00.000Z',
            '2026-10-12T10:00:00.000Z',
            '2026-10-12T16:00:00.000Z',
          ],
        },
      },
    ],
  },
  play: async ({ canvas, canvasElement }) => {
    const list = await canvas.findByRole('list', { name: 'Next open times for Intro call' });
    await settleAnimations();
    const chips = within(list).getAllByRole('link');
    await expect(chips).toHaveLength(6);
    // The stories read in London, in English (US): 15:00 UTC on 8 October is 4:00 PM there.
    await expect(chips[0]).toHaveAccessibleName(/Oct 8, 4:00.PM/);
    await expect(chips[0]).toHaveAttribute('href', '/anish/intro-call?at=2026-10-08T15%3A00%3A00.000Z&len=30');
    await expect(canvas.getByRole('link', { name: 'More times' })).toHaveAttribute('href', '/anish/intro-call');
    // The length is said once, under the title, for everyone.
    await expect(canvas.getByText('30 min')).toBeVisible();
    const report = probeAlignment({ root: '[aria-labelledby]', ignoreSpacing: '*' });
    await expect(report.failures).toEqual([]);
    await expect(canvasElement.querySelector('[aria-busy="true"]')).toBeNull();
  },
};

/** Before its times are read: chips hold their places, and the block asks for them as it nears the screen. */
export const TimesLoading: Story = {
  args: { blocks: [TIMES_BLOCK], onTimesNear: fn() },
  play: async ({ args, canvas }) => {
    await waitFor(() => expect(args.onTimesNear).toHaveBeenCalledWith('next'));
    await settleAnimations();
    await expect(canvas.getByText('Loading open times…')).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'More times' })).toBeVisible();
  },
};

/** No open times in the next two weeks: it says so, and More times stays. */
export const TimesEmpty: Story = {
  args: { blocks: [{ ...TIMES_BLOCK, times: { status: 'ready', starts: [] } }] },
  play: async ({ canvas }) => {
    const none = await canvas.findByText('No open times in the next two weeks');
    await settleAnimations();
    await expect(none).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'More times' })).toBeVisible();
  },
};

/** The times couldn't be read: More times alone, which still books. */
export const TimesError: Story = {
  parameters: { crm: { screenshot: false } },
  args: { blocks: [{ ...TIMES_BLOCK, times: { status: 'error' } }] },
  play: async ({ canvas }) => {
    const more = await canvas.findByRole('link', { name: 'More times' });
    await settleAnimations();
    await expect(more).toBeVisible();
    await expect(canvas.queryByRole('list', { name: /Next open times/ })).toBeNull();
  },
};

/** The banner at the very top, above the person, put away for the visit by its Close (AC-6112). */
export const Banner: Story = {
  args: {
    blocks: [
      {
        kind: 'banner',
        id: 'news',
        text: 'Timefix 2.0 is out: read what changed',
        href: 'https://www.timefix.com/blog/two',
      },
      { kind: 'link', id: 'site', title: 'timefix.com', href: 'https://www.timefix.com', hue: 'sky', icon: 'globe' },
    ],
  },
  play: async ({ canvas, args }) => {
    await settleAnimations();
    const banner = canvas.getByRole('region', { name: 'Announcement' });
    const name = canvas.getByRole('heading', { level: 1, name: 'Anish Gupta' });
    await expect(banner.getBoundingClientRect().bottom).toBeLessThanOrEqual(name.getBoundingClientRect().top);
    const link = within(banner).getByRole('link', { name: /Timefix 2\.0 is out/ });
    await expect(link).toHaveAttribute('target', '_blank');
    await userEvent.click(canvas.getByRole('button', { name: 'Close banner' }));
    await expect(canvas.queryByRole('region', { name: 'Announcement' })).toBeNull();
    // Focus moves on to the page's first control rather than to nothing.
    await waitFor(() => expect(document.activeElement?.tagName).toMatch(/^(A|BUTTON)$/));
    await expect(args.onPress).not.toHaveBeenCalled();
  },
};

/** Keeps a test's press on a link from opening a tab: the press is what is tested, not the browser's navigation. */
function holdNavigation(): () => void {
  const hold = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('a[href]') !== null) event.preventDefault();
  };
  document.addEventListener('click', hold);
  return () => {
    document.removeEventListener('click', hold);
  };
}

/** A link with an age notice (AC-6113): the sheet first; Go back opens and counts nothing, Continue does both. */
export const Notice: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    blocks: [
      { kind: 'link', id: 'shop', title: 'The wine club', href: 'https://example.com/wine', hue: 'red', notice: '18' },
      { kind: 'link', id: 'site', title: 'timefix.com', href: 'https://www.timefix.com', hue: 'sky', icon: 'globe' },
    ],
  },
  play: async ({ canvas, args }) => {
    const release = holdNavigation();
    try {
      await settleAnimations();
      const wine = await canvas.findByRole('link', { name: /The wine club/ });
      await expect(wine).toHaveAttribute('rel', 'noopener noreferrer nofollow');
      await userEvent.click(wine);
      await settleAnimations();
      const sheet = await within(document.body).findByRole('dialog', {
        name: 'You need to be 18 or older to open this.',
      });
      await userEvent.click(within(sheet).getByRole('button', { name: 'Go back' }));
      await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull());
      await expect(args.onPress).not.toHaveBeenCalled();
      await userEvent.click(wine);
      await settleAnimations();
      const again = await within(document.body).findByRole('dialog');
      await userEvent.click(within(again).getByRole('link', { name: 'Continue' }));
      await expect(args.onPress).toHaveBeenCalledWith('shop');
      // Remembered for the visit: the next press opens at once and counts.
      await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull());
      await userEvent.click(wine);
      await expect(within(document.body).queryByRole('dialog')).toBeNull();
      await expect(args.onPress).toHaveBeenCalledTimes(2);
    } finally {
      release();
    }
  },
};

/** The notice sheet open, as a visitor first sees it. */
export const NoticeSheet: Story = {
  args: {
    blocks: [
      {
        kind: 'link',
        id: 'shop',
        title: 'The wine club',
        href: 'https://example.com/wine',
        hue: 'red',
        notice: 'sensitive',
      },
    ],
  },
  play: async ({ canvas }) => {
    await settleAnimations();
    await userEvent.click(await canvas.findByRole('link', { name: /The wine club/ }));
    await settleAnimations();
    await expect(
      await within(document.body).findByRole('dialog', { name: 'This link may show sensitive content.' }),
    ).toBeVisible();
  },
};

/** A first card as the header's Save contact, and a second and third as rows that each save their own (AC-6114). */
export const ContactCards: Story = {
  args: {
    blocks: [
      {
        kind: 'contact',
        id: 'work',
        title: 'Anish Gupta',
        line: 'Cofounder · Timefix',
        href: '/api/public/handles/anish/contact.vcf',
      },
      { kind: 'link', id: 'site', title: 'timefix.com', href: 'https://www.timefix.com', hue: 'sky', icon: 'globe' },
      {
        kind: 'contact',
        id: 'home',
        title: 'Anish at home',
        line: 'Personal',
        href: '/api/public/handles/anish/contact.vcf?card=home',
      },
    ],
  },
  play: async ({ canvas }) => {
    await settleAnimations();
    await expect(canvas.getByRole('link', { name: 'Save contact' })).toHaveAttribute(
      'href',
      '/api/public/handles/anish/contact.vcf',
    );
    await expect(canvas.getByRole('link', { name: /Anish at home.*Save contact/ })).toHaveAttribute(
      'href',
      '/api/public/handles/anish/contact.vcf?card=home',
    );
  },
};

/** Every new kind on one dark page with a brand look, in a phone's column: the look reaches each of them. */
export const AllKindsDark: Story = {
  args: {
    theme: {
      ...PLAIN,
      ground: 'gradient',
      gradient: 'grape',
      mode: 'dark',
      shape: 'pill',
      fill: 'soft',
      font: 'grotesk',
    },
    blocks: [
      { kind: 'banner', id: 'news', text: 'New talk out this week' },
      ...featuredBlocks().slice(0, 2),
      { kind: 'socials', id: 'socials', links: SOCIAL_LINKS },
      {
        kind: 'media',
        id: 'talk',
        provider: 'vimeo',
        title: 'Scheduling that books itself',
        frame: 'https://player.vimeo.com/video/76979871?autoplay=1&dnt=1',
        poster: DUSK,
      },
      { ...TIMES_BLOCK, times: { status: 'ready', starts: ['2026-10-09T09:00:00.000Z', '2026-10-09T13:30:00.000Z'] } },
      { kind: 'gallery', id: 'offsite', images: GALLERY.slice(0, 3), display: 'grid' },
    ],
  },
  render: (args) => (
    <Stage width="phone">
      <LinkPage {...args} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    // Every lazy part landed, so the screenshot is the page and not its held boxes.
    await canvas.findByRole('button', { name: /Play Scheduling/ });
    await canvas.findByRole('list', { name: /Next open times/ });
    await canvas.findByRole('button', { name: /Morning at the offsite/ });
    await settleAnimations();
    await picturesDrawn(canvasElement);
  },
};

/** A media block whose player address the check refused: its poster and "Can’t play here", never a dead Play. */
export const MediaRefused: Story = {
  args: {
    blocks: [
      {
        kind: 'media',
        id: 'talk',
        provider: 'youtube',
        title: 'Scheduling that books itself',
        frame: 'https://elsewhere.example/embed/x',
        poster: SEA,
      },
    ],
  },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByText('Can’t play here');
    await expect(canvas.queryByRole('button', { name: /Play/ })).toBeNull();
    await picturesDrawn(canvasElement);
  },
};

/** A picture whose address isn't ours: its alt text in its place, on the page's own card colours. */
export const PictureRefused: Story = {
  args: {
    theme: { ...PLAIN, ground: 'ink', mode: 'light' },
    // The foot's own colours on ink are another story's (ThemedDark); this one is the picture's alt text.
    foot: undefined,
    blocks: [
      {
        kind: 'image',
        id: 'stage',
        image: { src: 'https://elsewhere.example/x.png', width: 1200, height: 800 },
        alt: 'Anish on stage at SaaStr',
        caption: 'Talking calendars at SaaStr',
      },
    ],
  },
  play: async ({ canvas }) => {
    await settleAnimations();
    await expect(await canvas.findByText('Anish on stage at SaaStr')).toBeVisible();
    await expect(canvas.queryByRole('img', { name: 'Anish on stage at SaaStr' })).toBeNull();
  },
};

/** The blocks each lazy part draws, the same blocks' held boxes after them. */
function heldBlocks() {
  return [
    {
      kind: 'media',
      id: 'talk',
      provider: 'youtube',
      title: 'Scheduling that books itself',
      frame: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      poster: SEA,
    },
    { kind: 'image', id: 'stage', image: DUSK, alt: 'Anish on stage', caption: 'Talking calendars at SaaStr' },
    { kind: 'gallery', id: 'offsite', images: GALLERY, display: 'grid' },
    { kind: 'gallery', id: 'row', images: GALLERY, display: 'row' },
    TIMES_BLOCK,
  ] as const satisfies readonly LinkPageBlock[];
}

/**
 * Each lazy block beside the box it holds while its chunk loads (AC-6126): the same height, so the page doesn't move
 * when a chunk lands.
 */
export const Holds: Story = {
  args: {
    blocks: heldBlocks(),
    onTimesNear: fn(),
    after: (
      <>
        {heldBlocks().map((block) => (
          <LinkPageHold key={block.id} block={block} />
        ))}
      </>
    ),
  },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('button', { name: /Play Scheduling/ });
    await canvas.findByRole('img', { name: 'Anish on stage' });
    await canvas.findByRole('region', { name: 'Intro call' });
    await settleAnimations();
    const height = (element: Element | null | undefined) => Math.round(element?.getBoundingClientRect().height ?? -1);
    const held = (kind: string) => canvasElement.querySelectorAll(`[data-hold-for="${kind}"]`);
    // Wait for each chunk's own stylesheet, then hold every block to its box.
    await waitFor(async () => {
      const media = canvas.getByRole('button', { name: /Play Scheduling/ }).closest('figure');
      await expect(height(media)).toBe(height(held('media')[0]));
    });
    await expect(height(canvas.getByRole('img', { name: 'Anish on stage' }).closest('figure'))).toBe(
      height(held('image')[0]),
    );
    const galleries = canvas.getAllByRole('list', { name: 'Pictures' });
    await expect(height(galleries[0]?.parentElement)).toBe(height(held('gallery')[0]));
    await expect(height(galleries[1]?.parentElement)).toBe(height(held('gallery')[1]));
    await expect(height(canvas.getByRole('region', { name: 'Intro call' }))).toBe(height(held('times')[0]));
    await picturesDrawn(canvasElement);
  },
};
