// Spec 0068's bento (AC-6808): a link page's blocks as a grid of finished cards in every template, the new cards one
// by one, the same cards in a list page's column, and the rules the grid keeps (no holes, the owner's order).
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { BookingFoot } from '../BookingFrame/BookingFrame.tsx';
import { LinkPage, type LinkPageBlock, type LinkPagePicture, type PageLook } from './LinkPage.tsx';

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

const ORANGE_BRAND = [
  ['--brand-accent', '#e65708'],
  ['--brand-on-accent', '#000000'],
  ['--brand-link', '#b74300'],
  ['--brand-accent-dark', '#e8590c'],
  ['--brand-on-accent-dark', '#000000'],
  ['--brand-link-dark', '#fd6c2b'],
] as const;

/** A photo stood in for by a `data:` image: a sky, a sun and a hill, so a card reads as a photo in a screenshot. */
function photo(sky: string, ground: string, width = 1200, height = 900): LinkPagePicture {
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

/** A client's logo: a mark and a word, in one ink, as a wordmark reads on a card. */
function logo(word: string, ink: string): LinkPagePicture & { readonly alt: string } {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 60"><circle cx="26" cy="30" r="16" fill="${ink}"/>` +
    `<text x="52" y="40" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="${ink}">${word}</text></svg>`;
  return { src: `data:image/svg+xml,${encodeURIComponent(svg)}`, width: 220, height: 60, alt: word };
}

const SEA = photo('#bae6fd', '#1e3a8a');
const MOSS = photo('#d9f99d', '#166534');
const DUSK = photo('#c4b5fd', '#7c2d12');

const PERSON = {
  name: 'Ada Lindqvist',
  id: 'ada',
  bio: 'Product designer in Lisbon. Previously at Webflow.',
};

const WAVE = '4bhmqtvrlhd8cglpsvuqmid9fjnruvtpkfa7ejosvvrnjeb7';

/** Every card the bento draws, in an owner's order: the new ones and the ones a page already had. */
function bentoBlocks(): readonly LinkPageBlock[] {
  return [
    { kind: 'profile', id: 'me', line: 'I design tools for creative teams.', size: 'wide' },
    { kind: 'status', id: 'open', text: 'Available for work', state: 'open' },
    {
      kind: 'audio',
      id: 'intro',
      src: '/api/public/profiles/ada/audio/0190a0a0-0000-7000-8000-000000000001',
      title: 'Hi, I’m Ada',
      wave: WAVE,
    },
    {
      kind: 'timeline',
      id: 'xp',
      items: [
        { when: '2023 – now', title: 'Product designer', place: 'Webflow' },
        { when: '2021', title: 'Design lead', place: 'Producer’s Club' },
        { when: '2019', title: 'Designer', place: 'CRT Studio' },
      ],
    },
    {
      kind: 'steps',
      id: 'how',
      items: [
        { title: 'Discovery call', body: 'Thirty minutes, free, to learn what you need and whether I can help.' },
        { title: 'A written plan', body: 'Within a week: scope, timeline and a fixed price.' },
        { title: 'Design sprints', body: 'Two week sprints with a review at the end of each.' },
        { title: 'Handover', body: 'Files, a walkthrough, and a month of questions answered.' },
      ],
      size: 'wide',
    },
    {
      kind: 'logos',
      id: 'clients',
      images: [
        logo('Acme', '#1f2937'),
        logo('Globex', '#1f2937'),
        logo('Initech', '#1f2937'),
        logo('Hooli', '#1f2937'),
      ],
      size: 'wide',
    },
    {
      kind: 'work',
      id: 'work',
      items: [
        {
          image: SEA,
          title: 'Effy',
          body: 'A social platform with a twist: share thoughts by voice.',
          href: 'https://effy.example',
        },
        { image: MOSS, title: 'Trade', body: 'A fast growing logistics company, rebranded in six weeks.' },
      ],
    },
    {
      kind: 'times',
      id: 'book',
      title: 'Intro call',
      href: '/ada/intro-call',
      duration: 30,
      times: {
        status: 'ready',
        starts: ['2026-10-08T15:00:00.000Z', '2026-10-09T09:00:00.000Z', '2026-10-12T10:00:00.000Z'],
      },
    },
    {
      kind: 'location',
      id: 'studio',
      title: 'Studio',
      address: 'Rua Augusta 24, 1100-053 Lisbon',
      directions: 'https://www.google.com/maps/search/?api=1&query=Rua%20Augusta%2024%2C%201100-053%20Lisbon',
    },
    {
      kind: 'events',
      id: 'events',
      items: [
        { title: 'Old talk', at: '2026-09-01T18:00:00.000Z' },
        { title: 'Open studio', at: '2026-10-15T17:00:00.000Z', place: 'Lisbon', href: 'https://events.example/open' },
        { title: 'Config talk', at: '2026-11-03T16:00:00.000Z', place: 'San Francisco' },
      ],
    },
    {
      kind: 'testimonial',
      id: 'said',
      quote: 'Ada turned a messy brief into a product people love using.',
      author: 'Sam Rivera',
      role: 'Founder, Effy',
    },
    {
      kind: 'image',
      id: 'football',
      image: DUSK,
      alt: 'Teaching football on a Saturday',
      caption: 'I love teaching football',
    },
    { kind: 'link', id: 'site', title: 'Portfolio', href: 'https://ada.example', hue: 'blue', thumb: SEA },
    { kind: 'page', id: 'call', title: 'Intro call', href: '/ada/intro-call', facts: '30 min' },
  ];
}

const meta = {
  title: 'Modules/LinkPage/Bento',
  component: LinkPage,
  args: {
    person: PERSON,
    pageLayout: 'grid',
    share: <Button variant="secondary" size="touch" icon="upload" label="Share page" />,
    foot: <BookingFoot page="booking_profile" claimHref="https://www.timefix.com/?utm_content=claim_link" />,
    onPress: fn(),
    variables: ORANGE_BRAND,
  },
  render: (args) => (
    <Stage width="fill">
      <LinkPage {...args} blocks={bentoBlocks()} />
    </Stage>
  ),
} satisfies Meta<typeof LinkPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every cell's box, in the DOM's order, once the bento's chunk has drawn it. */
async function cellsOf(root: HTMLElement) {
  const grid = await waitFor(() => {
    const found = root.querySelector('ul[aria-label="Links"]');
    if (found === null) throw new Error('The bento draws');
    return found;
  });
  await settleAnimations();
  return {
    grid: grid.getBoundingClientRect(),
    cells: [...grid.querySelectorAll(':scope > li')].map((cell) => cell.getBoundingClientRect()),
  };
}

/** No holes: each row of cells spans the grid edge to edge, and every cell comes after the one before it. */
async function expectFilled(root: HTMLElement) {
  const { grid, cells } = await cellsOf(root);
  const rows = new Map<number, DOMRect[]>();
  for (const cell of cells) rows.set(Math.round(cell.top), [...(rows.get(Math.round(cell.top)) ?? []), cell]);
  for (const row of rows.values()) {
    const left = Math.min(...row.map((cell) => cell.left));
    const right = Math.max(...row.map((cell) => cell.right));
    await expect(Math.round(left)).toBe(Math.round(grid.left));
    await expect(Math.round(right)).toBe(Math.round(grid.right));
  }
  for (const [at, cell] of cells.entries()) {
    const before = cells[at - 1];
    if (before === undefined) continue;
    await expect(cell.top > before.top || (cell.top === before.top && cell.left > before.left)).toBe(true);
  }
}

/** Classic on a wide page: three columns, every row full, the owner's order kept. */
export const Classic: Story = {
  args: { theme: { ...PLAIN, template: 'classic' } },
  play: async ({ canvas, canvasElement }) => {
    await expectFilled(canvasElement);
    // The profile card says who the page is, with Book (the page's first booking page) and Share.
    const profile = canvas.getByText('I design tools for creative teams.');
    await expect(profile).toBeVisible();
    const card = within(profile.closest('section') ?? canvasElement);
    await expect(card.getByRole('link', { name: 'Book' })).toHaveAttribute('href', '/ada/intro-call');
    // A past event is left out; the rest are soonest first.
    await expect(canvas.queryByText('Old talk')).toBeNull();
    await expect(canvas.getByText('Open studio')).toBeVisible();
    // Directions open the map search in a new tab.
    await expect(canvas.getByRole('link', { name: /Directions/ })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=Rua%20Augusta%2024%2C%201100-053%20Lisbon',
    );
  },
};

/** Studio: the warm paper and its round, image led cards. */
export const Studio: Story = {
  args: { theme: { ...PLAIN, template: 'studio' } },
  play: async ({ canvasElement }) => {
    await settleAnimations();
    await expectFilled(canvasElement);
  },
};

/** Night: the cards on the ink ground, the accent only as a glow. */
export const Night: Story = {
  args: {
    theme: { ...PLAIN, template: 'night' },
    foot: (
      <BookingFoot page="booking_profile" scheme="dark" claimHref="https://www.timefix.com/?utm_content=claim_link" />
    ),
  },
  play: async ({ canvasElement }) => {
    await settleAnimations();
    await expectFilled(canvasElement);
  },
};

/** Split: who the page is in the sticky panel, led by its cover, Book wired to its booking page; the bento beside. */
export const Split: Story = {
  args: { theme: { ...PLAIN, template: 'split' }, photos: { cover: true }, openNow: 'Open now · until 6 PM' },
  play: async ({ canvas, canvasElement }) => {
    await settleAnimations();
    await expect(canvasElement.querySelector('[data-cover] > span[aria-hidden="true"]')).not.toBeNull();
    // The panel's Book is the page's first booking page, with nothing passed for it.
    const books = canvas.getAllByRole('link', { name: 'Book' });
    await expect(books[0]).toHaveAttribute('href', '/ada/intro-call');
    await expectFilled(canvasElement);
  },
};

/** On a phone every card takes the column, whatever span it asked for. */
export const Phone: Story = {
  args: { theme: { ...PLAIN, template: 'classic' } },
  render: (args) => (
    <Stage width="phone">
      <LinkPage {...args} blocks={bentoBlocks()} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await settleAnimations();
    const { grid, cells } = await cellsOf(canvasElement);
    for (const cell of cells) await expect(Math.round(cell.width)).toBe(Math.round(grid.width));
  },
};

/** How I work: the switcher shows one step at a time, by pointer and by the arrow keys. */
export const Steps: Story = {
  parameters: { crm: { screenshot: false } },
  args: { theme: { ...PLAIN, template: 'classic' } },
  play: async ({ canvas }) => {
    await settleAnimations();
    await expect(canvas.getByRole('heading', { name: /01 Discovery call/ })).toBeVisible();
    await userEvent.click(canvas.getByRole('radio', { name: 'Step 3: Design sprints' }));
    await waitFor(() => expect(canvas.getByRole('heading', { name: /03 Design sprints/ })).toBeVisible());
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(canvas.getByRole('heading', { name: /04 Handover/ })).toBeVisible());
  },
};

/** The new cards in a list page's column: each the same card, one after another. */
export const InAList: Story = {
  args: { theme: { ...PLAIN, template: 'classic' }, pageLayout: 'list' },
  render: (args) => (
    <Stage width="phone">
      <LinkPage {...args} blocks={bentoBlocks().slice(0, 6)} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await settleAnimations();
    await expect(await canvas.findByText('Available for work')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Play Hi, I’m Ada' })).toBeEnabled();
  },
};
