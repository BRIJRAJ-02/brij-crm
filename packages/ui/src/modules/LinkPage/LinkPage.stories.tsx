import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { TileGrid } from '../../molecules/TileGrid/TileGrid.tsx';
import { BookingFoot } from '../BookingFrame/BookingFrame.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { LinkPage, LinkPageThumbnail, LinkPageTile, type LinkPageBlock, type PageLook } from './LinkPage.tsx';

/** The look a page has never touched (spec 0054), with the four keys spec 0060 added at their defaults. */
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

/** The fourteen looks of the gallery (spec 0060, AC-8), as `PAGE_THEME_PRESETS` in the contracts writes them. */
const LOOKS: readonly (readonly [string, string, PageLook])[] = [
  ['plain', 'Plain', PLAIN],
  ['paper', 'Paper', { ...PLAIN, ground: 'paper' }],
  ['bold', 'Bold', { ...PLAIN, ground: 'tint', shape: 'pill', fill: 'solid' }],
  ['ink', 'Ink', { ...PLAIN, ground: 'ink', mode: 'dark', fill: 'outline' }],
  ['quiet', 'Quiet', { ...PLAIN, ground: 'paper', shape: 'square', font: 'mono' }],
  ['dawn', 'Dawn', { ...PLAIN, ground: 'gradient', gradient: 'dawn', shape: 'pill', fill: 'plain', font: 'friendly' }],
  ['ocean', 'Ocean', { ...PLAIN, ground: 'gradient', gradient: 'ocean', fill: 'solid', font: 'geometric' }],
  ['mint', 'Mint', { ...PLAIN, ground: 'gradient', gradient: 'mint', fill: 'outline', font: 'grotesk' }],
  [
    'studio',
    'Studio',
    { ...PLAIN, ground: 'pattern', pattern: 'grid', shape: 'square', fill: 'outline', font: 'grotesk' },
  ],
  ['editorial', 'Editorial', { ...PLAIN, ground: 'paper', header: 'left', font: 'editorial' }],
  ['night', 'Night', { ...PLAIN, ground: 'ink', mode: 'dark', fill: 'outline', font: 'display' }],
  [
    'peach',
    'Peach',
    { ...PLAIN, ground: 'gradient', gradient: 'peach', shape: 'pill', fill: 'solid', font: 'friendly' },
  ],
  ['graphite', 'Graphite', { ...PLAIN, ground: 'gradient', gradient: 'graphite', mode: 'dark', font: 'mono' }],
  ['gallery', 'Gallery', { ...PLAIN, ground: 'image', header: 'cover', avatar: 'rounded', font: 'classic' }],
];

/** An orange brand, as `brandProperties(brandVariables({ accent: '#e8590c' }))` makes it (spec 0060, AC-7). */
const ORANGE_BRAND = [
  ['--brand-accent', '#e65708'],
  ['--brand-on-accent', '#000000'],
  ['--brand-link', '#b74300'],
  ['--brand-accent-dark', '#e8590c'],
  ['--brand-on-accent-dark', '#000000'],
  ['--brand-link-dark', '#fd6c2b'],
] as const;

const meta = {
  title: 'Modules/LinkPage',
  component: LinkPage,
  args: {
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

/** Anish's page at an event: his booking pages, his site, his networks, under two headings. */
function anishBlocks(): readonly LinkPageBlock[] {
  return [
    { kind: 'page', id: 'intro', title: 'Intro call', href: '/anish/intro-call', facts: '15 min · 30 min' },
    { kind: 'page', id: 'demo', title: 'Product demo', href: '/anish/demo', facts: '45 min · Team' },
    { kind: 'heading', id: 'find', title: 'Find me' },
    {
      kind: 'link',
      id: 'linkedin',
      title: 'LinkedIn',
      href: 'https://www.linkedin.com/in/anish',
      note: 'Where I post about sales',
      mark: 'linkedin',
      hue: 'blue',
    },
    { kind: 'link', id: 'x', title: 'X', href: 'https://x.com/anish', mark: 'x', hue: 'gray' },
    { kind: 'link', id: 'site', title: 'timefix.com', href: 'https://www.timefix.com', icon: 'globe', hue: 'sky' },
    { kind: 'heading', id: 'read', title: 'Read' },
    {
      kind: 'link',
      id: 'deck',
      title: 'Our deck for founders',
      href: 'https://example.com/deck',
      note: 'Ten slides, two minutes',
      hue: 'purple',
    },
  ];
}

/**
 * The blocks rise in with `both` fill, and the test runner pauses animations, which holds that entrance at its first
 * frame (opacity 0) until the hook after the play settles it. A play that reads the blocks settles it first, as a
 * visitor sees them a moment after the page draws.
 */
function settleEntrance(root: HTMLElement) {
  for (const entrance of root.getAnimations({ subtree: true })) entrance.finish();
}

const PERSON = {
  name: 'Anish Gupta',
  id: 'anish',
  bio: 'Cofounder at Timefix. Ask me about scheduling that books itself.',
};

/** The page a visitor scans to at an event: the person, then their blocks in their order, the foot. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  args: { person: PERSON },
  render: (args) => (
    <Stage width="fill" height="page">
      <LinkPage {...args} blocks={anishBlocks()} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement, args }) => {
    settleEntrance(canvasElement);
    await expect(canvas.getByRole('heading', { level: 1, name: 'Anish Gupta' })).toBeVisible();
    await expect(canvas.getByRole('heading', { level: 2, name: 'Find me' })).toBeVisible();
    // A booking page opens in this tab; an outside link in a new one, never sending where it came from.
    await expect(canvas.getByRole('link', { name: /Intro call/ })).toHaveAttribute('href', '/anish/intro-call');
    const linkedin = canvas.getByRole('link', { name: /LinkedIn/ });
    await expect(linkedin).toHaveAttribute('target', '_blank');
    await expect(linkedin).toHaveAttribute('rel', 'me noopener noreferrer nofollow');
    // A site that isn't the person's own profile carries no `me`.
    await expect(canvas.getByRole('link', { name: /Our deck/ })).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    await expect(linkedin).toHaveAccessibleName(/opens in a new tab/);
    linkedin.addEventListener('click', (event) => event.preventDefault(), { once: true });
    await userEvent.click(linkedin);
    await expect(args.onPress).toHaveBeenCalledWith('linkedin');
  },
};

/** A stand in wordmark, wide on purpose, so the lockup's cap on a logo's width is drawn. */
const LOGO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 60"><circle cx="30" cy="30" r="24" fill="#e8590c"/><rect x="66" y="18" width="160" height="24" rx="6" fill="#e8590c"/></svg>',
)}`;

/**
 * Who the page belongs to (3 Nov 2026): the company's name above the person, linking to its site in a new tab, the
 * person's job title under their name, and their own line above the foot.
 */
export const Identity: Story = {
  args: {
    person: { ...PERSON, role: 'Head of partnerships' },
    brand: { name: 'Timefix', href: 'https://www.timefix.com/', logo: LOGO },
    footLine: 'Replies within a day, Monday to Friday.',
  },
  render: (args) => (
    <Stage width="fill" height="page">
      <LinkPage {...args} blocks={anishBlocks()} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    settleEntrance(canvasElement);
    const lockup = canvas.getByRole('link', { name: /^Timefix/ });
    await expect(lockup).toHaveAttribute('href', 'https://www.timefix.com/');
    await expect(lockup).toHaveAttribute('target', '_blank');
    await expect(lockup).toHaveAccessibleName(/opens in a new tab/);
    await expect(canvas.getByText('Head of partnerships')).toBeVisible();
    await expect(canvas.getByText('Replies within a day, Monday to Friday.')).toBeVisible();
  },
};

/** A lockup whose address isn't https draws the name alone, with no link. */
export const IdentityUnlinked: Story = {
  parameters: { crm: { screenshot: false } },
  args: { person: PERSON, brand: { name: 'Timefix', href: 'javascript:alert(1)' } },
  render: (args) => (
    <Stage width="fill" height="page">
      <LinkPage {...args} blocks={[]} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Timefix')).toBeVisible();
    await expect(canvas.queryByRole('link', { name: /^Timefix/ })).toBeNull();
  },
};

/** While the page loads: the face, the name and five block shaped places, so nothing moves when they arrive. */
export const Loading: Story = {};

/** The person is known but their blocks are still on their way (a later page of them, a search). */
export const BlocksLoading: Story = { args: { person: PERSON } };

/** A page with no blocks yet: the person, and a quiet line in place of the list. */
export const Empty: Story = {
  args: {
    person: { name: 'Ada Lovelace', id: 'ada' },
    blocks: [],
    empty: (
      <EmptyState title="Nothing here yet" icon="link">
        Ada hasn’t added any links.
      </EmptyState>
    ),
  },
};

/** One link: the smallest page that is still a link page. */
export const OneBlock: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    person: { name: 'Ada Lovelace', id: 'ada' },
    blocks: [{ kind: 'link', id: 'site', title: 'ada.dev', href: 'https://ada.dev', hue: 'green' }],
  },
};

/** Writing between the rows: the person's own words, with their line breaks kept and nothing to press. */
export const Writing: Story = {
  args: {
    person: { name: 'Ada Lovelace', id: 'ada', bio: 'Numbers, engines and the odd poem.' },
    blocks: [
      { kind: 'heading', id: 'about', title: 'About' },
      {
        kind: 'text',
        id: 'who',
        title: 'Before you book',
        body: 'I work on analytical engines.\n\nBring the problem, not the solution. Half an hour is usually enough.',
      },
      { kind: 'page', id: 'chat', title: 'Quick chat', href: '/ada/quick-chat', facts: '30 min' },
      { kind: 'text', id: 'ps', body: 'Mornings are better for me, London time.' },
    ],
  },
  play: async ({ canvas }) => {
    // The words are text, not a row: nothing in them is a link or a button.
    const words = canvas.getByText(/analytical engines/);
    await expect(words.closest('a')).toBeNull();
    await expect(words.closest('button')).toBeNull();
    // The page keeps its one list of pressable rows; writing is not in it.
    await expect(canvas.getAllByRole('listitem')).toHaveLength(1);
  },
};

/** The questions, answered: folds that start closed, several open at once, and nothing counted. */
export const Questions: Story = {
  args: {
    person: { name: 'Ada Lovelace', id: 'ada', bio: 'Numbers, engines and the odd poem.' },
    blocks: [
      { kind: 'page', id: 'chat', title: 'Quick chat', href: '/ada/quick-chat', facts: '30 min' },
      {
        kind: 'faq',
        id: 'asked',
        items: [
          { question: 'Do you travel to me?', answer: 'Yes, anywhere inside the M25, for no extra charge.' },
          { question: 'How far ahead should I book?', answer: 'A week is plenty.\nSooner is fine if I am free.' },
        ],
      },
    ],
  },
  play: async ({ canvas }) => {
    const first = canvas.getByRole('button', { name: 'Do you travel to me?' });
    // Every question starts closed, so the page stays short.
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(first);
    await settleAnimations();
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByText(/inside the M25/)).toBeVisible();
    // A second question opens beside the first: a visitor comparing two answers keeps both.
    const second = canvas.getByRole('button', { name: 'How far ahead should I book?' });
    await userEvent.click(second);
    await settleAnimations();
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await expect(second).toHaveAttribute('aria-expanded', 'true');
  },
};

/** A Timefix form: a row that opens the form on our own origin, in the same tab. */
export const FormBlock: Story = {
  args: {
    person: { name: 'Ada Lovelace', id: 'ada', bio: 'Numbers, engines and the odd poem.' },
    blocks: [
      { kind: 'page', id: 'chat', title: 'Quick chat', href: '/ada/quick-chat', facts: '30 min' },
      { kind: 'form', id: 'brief', title: 'Tell me about your project', href: '/f/work-with-me' },
    ],
  },
  play: async ({ canvas }) => {
    const row = canvas.getByRole('link', { name: /Tell me about your project/ });
    await expect(row).toHaveAttribute('href', '/f/work-with-me');
    // The same tab, on our own origin: no target, and nothing to open a window with.
    await expect(row).not.toHaveAttribute('target');
    await expect(row).not.toHaveAttribute('rel');
  },
};

/** The owner's own look (spec 0054): six names, six data attributes, and one stylesheet block each. */
export const Themed: Story = {
  args: {
    person: { name: 'Ada Lovelace', id: 'ada', bio: 'Numbers, engines and the odd poem.' },
    theme: { ...PLAIN, ground: 'tint', hue: 'purple', shape: 'pill', fill: 'solid', font: 'mono' },
    blocks: [
      { kind: 'page', id: 'chat', title: 'Quick chat', href: '/ada/quick-chat', facts: '30 min' },
      { kind: 'link', id: 'site', title: 'ada.dev', href: 'https://ada.dev', hue: 'purple' },
    ],
  },
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector('[data-page-ground]');
    // The look is attributes only: no inline style reaches the page, in any theme.
    await expect(root).toHaveAttribute('data-page-ground', 'tint');
    await expect(root).toHaveAttribute('data-page-fill', 'solid');
    // Light or dark is the owner's call, pinned here so a visitor's own setting never decides it.
    await expect(root).toHaveAttribute('data-theme', 'light');
    await expect(root?.getAttribute('style')).toBeNull();
  },
};

/** The same page in the owner's dark, which a visitor sees whatever their phone is set to. */
export const ThemedDark: Story = {
  args: {
    person: { name: 'Ada Lovelace', id: 'ada', bio: 'Numbers, engines and the odd poem.' },
    theme: { ...PLAIN, ground: 'ink', mode: 'dark', shape: 'square', fill: 'outline' },
    blocks: [{ kind: 'link', id: 'site', title: 'ada.dev', href: 'https://ada.dev', hue: 'blue' }],
  },
};

/** Long words wrap inside their card rather than pushing the page sideways at 390 wide. */
export const LongWords: Story = {
  args: {
    person: {
      name: 'Maximiliana Konstantinopoulou-Abernathy',
      id: 'max',
      bio: 'A bio that runs the full hundred and sixty characters a bio may hold, to see it wrap neatly under the name.',
    },
    blocks: [
      {
        kind: 'link',
        id: 'long',
        title: 'Supercalifragilisticexpialidocious newsletter archive',
        href: 'https://example.com/a/very/long/path',
        note: 'Every issue since 2019, searchable, with the best ones pinned to the top of the list for you',
        hue: 'orange',
      },
    ],
  },
  render: (args) => (
    <Stage width="phone" height="page">
      <LinkPage {...args} />
    </Stage>
  ),
};

/** After the blocks: a refusal's note and Show more, in the page's own slot. */
export const WithMore: Story = {
  parameters: { crm: { screenshot: false } },
  args: { person: PERSON, after: <Button>Show more</Button> },
  render: (args) => (
    <Stage width="fill" height="page">
      <LinkPage {...args} blocks={anishBlocks().slice(0, 3)} />
    </Stage>
  ),
};

/** In the editor's phone: a plain region its content's height, inert, so a press never leaves the editor. */
export const Preview: Story = {
  args: { person: PERSON, isPreview: true },
  render: (args) => (
    <Stage width="phone">
      <LinkPage {...args} blocks={anishBlocks()} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.queryByRole('main')).toBeNull();
    await expect(canvasElement.querySelector('[inert]')).not.toBeNull();
  },
};

/** Each block's tile on its own, as the editor's rows show it: a mark, an icon, a letter, a page, a heading. */
export const Tiles: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      {anishBlocks().map((block) => (
        <LinkPageTile key={block.id} block={block} />
      ))}
    </Stage>
  ),
};

/**
 * The fourteen looks in miniature, as the Design panel's gallery draws them (spec 0058, AC-10; spec 0060, AC-8):
 * each the real ground, header, face, typeface, shape and fill, at a tile's size. Gallery's photos stand in until
 * there are some.
 */
export const Thumbnails: Story = {
  render: () => (
    <Stage width="fill">
      <TileGrid
        variant="choice"
        label="Look"
        defaultValue="plain"
        tiles={LOOKS.map(([id, name, theme]) => ({ id, name, thumbnail: <LinkPageThumbnail theme={theme} /> }))}
      />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const thumbs = canvasElement.querySelectorAll('[data-thumbnail]');
    await expect(thumbs).toHaveLength(14);
    await expect(thumbs[0]).toHaveAttribute('aria-hidden', 'true');
  },
};

/**
 * Customise's rows draw only the detail they change (spec 0060, AC-9), so the tiles in a row tell apart: each font in
 * its own face, each corner on one button, and Follow visitor light and dark at once.
 */
export const ThumbnailDetails: Story = {
  render: () => (
    <Stage width="fill">
      {(
        [
          [
            'font',
            [
              ['sans', 'Modern'],
              ['mono', 'Mono'],
              ['editorial', 'Editorial'],
              ['display', 'Display'],
            ],
          ],
          [
            'shape',
            [
              ['soft', 'Soft'],
              ['pill', 'Round'],
              ['square', 'Square'],
            ],
          ],
          [
            'mode',
            [
              ['light', 'Light'],
              ['dark', 'Dark'],
              ['system', 'Follow visitor'],
            ],
          ],
        ] as const
      ).map(([detail, choices]) => (
        <TileGrid
          key={detail}
          variant="choice"
          label={detail}
          defaultValue={choices[0][0]}
          tiles={choices.map(([value, name]) => ({
            id: value,
            name,
            thumbnail: (
              <LinkPageThumbnail
                detail={detail}
                theme={
                  detail === 'font'
                    ? { ...PLAIN, font: value as PageLook['font'] }
                    : detail === 'shape'
                      ? { ...PLAIN, shape: value as PageLook['shape'] }
                      : { ...PLAIN, mode: value as PageLook['mode'] }
                }
              />
            ),
          }))}
        />
      ))}
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    // Follow visitor draws two pages, light and dark; every other tile one.
    await expect(canvasElement.querySelectorAll('[data-thumbnail]')).toHaveLength(11);
  },
};

/** The same gallery in the owner's own colour: every fill and the solid rows take the brand (spec 0060, AC-14). */
export const ThumbnailsBranded: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <TileGrid
        variant="choice"
        label="Look"
        defaultValue="bold"
        tiles={LOOKS.map(([id, name, theme]) => ({
          id,
          name,
          thumbnail: <LinkPageThumbnail theme={theme} variables={ORANGE_BRAND} />,
        }))}
      />
    </Stage>
  ),
};

/** A brand's accent on the page (spec 0060, AC-5, AC-14): Save contact, the solid rows and the focus ring. */
export const Branded: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    person: PERSON,
    theme: { ...PLAIN, shape: 'pill', fill: 'solid' },
    variables: ORANGE_BRAND,
  },
  render: (args) => (
    <Stage width="fill" height="page">
      <LinkPage {...args} blocks={anishBlocks()} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector<HTMLElement>('[data-page-ground]');
    // Only the checked names reach the root, and the rows draw in the brand, not the product's blue.
    await expect(root?.style.getPropertyValue('--brand-accent')).toBe('#e65708');
    const row = canvasElement.querySelector('a[href^="/"]');
    await expect(row === null ? '' : getComputedStyle(row).backgroundColor).toBe('rgb(230, 87, 8)');
  },
};

/** Anything but a brand name and a checked value is dropped before it reaches the page (spec 0060, AC-22). */
export const BrandRefused: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    person: PERSON,
    theme: PLAIN,
    variables: [
      ['--brand-accent', 'red;}body{display:none'],
      ['color', '#000000'],
      ['--page-cover-image', 'url("https://elsewhere.example/x.png")'],
    ],
  },
  render: (args) => (
    <Stage width="fill" height="page">
      <LinkPage {...args} blocks={anishBlocks().slice(0, 2)} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-page-ground]')?.getAttribute('style')).toBeNull();
  },
};

/** The left header (spec 0060, AC-13): the face, then the name and bio beside it, in the Editorial pack. */
export const HeaderLeft: Story = {
  parameters: { crm: { screenshot: false } },
  args: { person: PERSON, theme: { ...PLAIN, ground: 'paper', header: 'left', font: 'editorial' } },
  render: (args) => (
    <Stage width="phone" height="page">
      <LinkPage {...args} blocks={anishBlocks().slice(0, 3)} />
    </Stage>
  ),
};

/**
 * The cover header and a photo ground (spec 0060, AC-11, AC-13): the band the rounded face overlaps, and the column
 * on a solid sheet so no word sits on the photo. The stand in draws where a story has no photo route.
 */
export const HeaderCoverOnPhoto: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    person: PERSON,
    theme: { ...PLAIN, ground: 'image', header: 'cover', avatar: 'rounded', font: 'classic', mode: 'dark' },
    photos: { cover: true, ground: true },
  },
  render: (args) => (
    <Stage width="phone" height="page">
      <LinkPage {...args} blocks={anishBlocks().slice(0, 3)} />
    </Stage>
  ),
};

/** A photo look with no photo yet draws as the plain, centred page, never an empty band (spec 0060, AC-10). */
export const PhotoLookWithoutPhotos: Story = {
  parameters: { crm: { screenshot: false } },
  args: { person: PERSON, theme: { ...PLAIN, ground: 'image', header: 'cover' } },
  render: (args) => (
    <Stage width="phone" height="page">
      <LinkPage {...args} blocks={anishBlocks().slice(0, 2)} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector('[data-page-ground]');
    await expect(root).toHaveAttribute('data-page-ground', 'plain');
    await expect(root).toHaveAttribute('data-page-header', 'centred');
  },
};

/** A gradient, a pattern and no face (spec 0060, AC-10, AC-13), following the visitor's light or dark (AC-15). */
export const GradientFollowsVisitor: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    person: PERSON,
    theme: { ...PLAIN, ground: 'gradient', gradient: 'dusk', mode: 'system', avatar: 'none', font: 'display' },
  },
  render: (args) => (
    <Stage width="phone" height="page">
      <LinkPage {...args} blocks={anishBlocks().slice(0, 3)} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    // Follow the visitor pins nothing, so the page takes whichever theme it is read in.
    await expect(canvasElement.querySelector('[data-page-ground]')).not.toHaveAttribute('data-theme');
  },
};

/** The Studio pattern in the Grotesk pack. */
export const Pattern: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    person: PERSON,
    theme: { ...PLAIN, ground: 'pattern', pattern: 'waves', shape: 'square', fill: 'outline', font: 'grotesk' },
  },
  render: (args) => (
    <Stage width="phone" height="page">
      <LinkPage {...args} blocks={anishBlocks().slice(0, 3)} />
    </Stage>
  ),
};

/** A one pixel PNG, as our own origin's icon route would answer one. `data:` is in the pages' `img-src`. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * A site's own icon, which our origin serves (26 October 2026): a link with no network mark and no picked icon
 * draws the site's favicon, and falls back to its letter the moment the image fails, so a site with no icon (most
 * of them, sooner or later) never leaves a gap.
 */
export const SiteIcons: Story = {
  args: { person: PERSON },
  render: (args) => (
    <Stage width="phone" height="page">
      <LinkPage
        {...args}
        blocks={[
          { kind: 'link', id: 'works', title: 'Ada’s notes', href: 'https://ada.dev', siteIcon: PIXEL, hue: 'sky' },
          {
            kind: 'link',
            id: 'fails',
            title: 'Burnt out',
            href: 'https://gone.example',
            siteIcon: '/does-not-exist.png',
            hue: 'purple',
          },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const rows = canvas.getAllByRole('link');
    await expect(rows[0]?.querySelector('img')).toBeTruthy();
    // The one that fails draws its letter instead, and never a broken picture.
    await waitFor(async () => {
      await expect(rows[1]?.querySelector('img')).toBeFalsy();
    });
    await expect(rows[1]?.textContent).toContain('B');
  },
};

/** Only the blocks, inert, under their caption: an editor's "How it looks" for the block being typed. */
export const BlocksOnly: Story = {
  args: { layout: 'blocks', caption: 'How it looks' },
  render: (args) => (
    <Stage width="dialog">
      <LinkPage {...args} blocks={anishBlocks().slice(3, 4)} />
    </Stage>
  ),
};

/** An address the rule refuses (`javascript:`) draws as words, never as a link; an email and a call open in place. */
export const Schemes: Story = {
  args: { person: PERSON },
  render: (args) => (
    <Stage width="phone" height="page">
      <LinkPage
        {...args}
        blocks={[
          { kind: 'link', id: 'bad', title: 'Not a link', href: 'javascript:alert(1)', hue: 'red' },
          { kind: 'link', id: 'mail', title: 'Email me', href: 'mailto:anish@timefix.com', hue: 'blue' },
          { kind: 'link', id: 'call', title: 'Call me', href: 'tel:+919999999999', hue: 'green' },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    settleEntrance(canvasElement);
    await expect(canvas.queryByRole('link', { name: /Not a link/ })).toBeNull();
    await expect(canvas.getByText('Not a link')).toBeVisible();
    const mail = canvas.getByRole('link', { name: /Email me/ });
    await expect(mail).toHaveAttribute('href', 'mailto:anish@timefix.com');
    await expect(mail).not.toHaveAttribute('target');
    await expect(canvas.getByRole('link', { name: /Call me/ })).toHaveAttribute('href', 'tel:+919999999999');
  },
};

/**
 * The header the owner's design draws (25 October 2026): the address as a pill that copies it, then Save contact
 * as the page's one primary action, with Share beside it, then the networks. The contact card never takes a row:
 * wherever the owner keeps it in their order, a visitor meets it as Save contact.
 */
export const Header: Story = {
  args: {
    person: PERSON,
    address: { label: 'timefix.com/anish', value: 'https://timefix.com/anish' },
    share: <Button variant="secondary" size="touch" icon="qr-code" label="Share this page" />,
  },
  render: (args) => (
    <Stage width="phone" height="page">
      <LinkPage
        {...args}
        blocks={[
          {
            kind: 'contact',
            id: 'card',
            title: 'Anish Gupta',
            line: 'Cofounder · Timefix',
            href: '/api/public/handles/anish/contact.vcf',
          },
          ...anishBlocks(),
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    settleEntrance(canvasElement);
    const save = canvas.getByRole('link', { name: 'Save contact' });
    await expect(save).toHaveAttribute('href', '/api/public/handles/anish/contact.vcf');
    // In place, never a new tab: a phone offers to add the card it downloads.
    await expect(save).not.toHaveAttribute('target');
    // The pill says what pressing it does, over the address it shows (WCAG 2.5.3).
    await expect(canvas.getByRole('button', { name: 'timefix.com/anish, copy link' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Share this page' })).toBeVisible();
    // The card is the header's button, so nothing in the list repeats it.
    await expect(canvas.queryByRole('link', { name: /Anish Gupta/ })).toBeNull();
  },
};

/**
 * The same header with a pass to keep (26 October 2026): Add to Apple Wallet under Save contact and Share, as a
 * quieter second save on a row of its own. Another story already screenshots the header, so this one checks the
 * link alone.
 */
export const Wallet: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    person: PERSON,
    address: { label: 'timefix.com/anish', value: 'https://timefix.com/anish' },
    share: <Button variant="secondary" size="touch" icon="qr-code" label="Share this page" />,
    walletHref: '/api/public/handles/anish/pass.pkpass',
  },
  render: (args) => (
    <Stage width="phone" height="page">
      <LinkPage
        {...args}
        blocks={[
          {
            kind: 'contact',
            id: 'card',
            title: 'Anish Gupta',
            line: 'Cofounder · Timefix',
            href: '/api/public/handles/anish/contact.vcf',
          },
          ...anishBlocks(),
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    settleEntrance(canvasElement);
    const pass = canvas.getByRole('link', { name: 'Add to Apple Wallet' });
    await expect(pass).toHaveAttribute('href', '/api/public/handles/anish/pass.pkpass');
    // In place, never a new tab: the phone opens Wallet from the file it downloads.
    await expect(pass).not.toHaveAttribute('target');
    await expect(canvas.getByRole('link', { name: 'Save contact' })).toBeVisible();
  },
};

/** An address that isn't this site's own path never becomes the wallet link. */
export const WalletElsewhere: Story = {
  parameters: { crm: { screenshot: false } },
  args: { person: PERSON, walletHref: 'https://example.com/pass.pkpass' },
  render: (args) => (
    <Stage width="phone" height="page">
      <LinkPage {...args} blocks={anishBlocks()} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    settleEntrance(canvasElement);
    await expect(canvas.queryByRole('link', { name: 'Add to Apple Wallet' })).toBeNull();
  },
};

/** No contact card, and a card whose address isn't this site's own path: neither draws a Save contact. */
export const WithoutContactCard: Story = {
  parameters: { crm: { screenshot: false } },
  args: { person: PERSON },
  render: (args) => (
    <Stage width="phone" height="page">
      <LinkPage
        {...args}
        blocks={[{ kind: 'contact', id: 'elsewhere', title: 'Not ours', href: 'https://example.com/card.vcf' }]}
        empty={<EmptyState title="Nothing here yet" icon="link" />}
      />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    settleEntrance(canvasElement);
    await expect(canvas.queryByRole('link', { name: 'Save contact' })).toBeNull();
    await expect(canvas.queryByText('Not ours')).toBeNull();
  },
};

/**
 * A heading set to fold (spec 0054, AC-5416): one row in the page's own shape, carrying its words, how many blocks
 * are under it and the quiet chevron. It is a real button, so the state is announced and the keyboard reaches it.
 * The second heading has nothing under it, so it draws as the plain heading it was (AC-5419).
 */
export const Folders: Story = {
  args: { person: PERSON },
  render: (args) => (
    <Stage width="phone" height="page">
      <LinkPage
        {...args}
        blocks={[
          { kind: 'page', id: 'intro', title: 'Intro call', href: '/anish/intro-call', facts: '15 min · 30 min' },
          { kind: 'heading', id: 'find', title: 'Find me', group: 'folder' },
          { kind: 'link', id: 'x', title: 'X', href: 'https://x.com/anish', mark: 'x', hue: 'gray' },
          {
            kind: 'link',
            id: 'site',
            title: 'timefix.com',
            href: 'https://www.timefix.com',
            icon: 'globe',
            hue: 'sky',
          },
          { kind: 'heading', id: 'empty-fold', title: 'Coming soon', group: 'folder' },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    settleEntrance(canvasElement);
    const fold = canvas.getByRole('button', { name: /Find me/ });
    // The count is read as words, so the row never reads as a bare number.
    await expect(fold).toHaveAccessibleName(/2 links inside/);
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    // Closed, the blocks under it are out of the page: not hidden by a colour, gone from the tree.
    await expect(canvas.queryByRole('link', { name: /timefix\.com/ })).toBeNull();
    // And not drawn either: the role query reads the hidden attribute, but a panel's own display once overrode it.
    await expect(canvasElement.querySelector('a[href="https://www.timefix.com"]')).not.toBeVisible();
    await userEvent.click(fold);
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('link', { name: /timefix\.com/ })).toBeVisible();
    // The heading keeps the page's outline: the row is a button inside the h2 it names.
    await expect(canvas.getByRole('heading', { level: 2, name: /Find me/ })).toBeVisible();
    // A folder with nothing under it is a plain heading, never a row that opens onto nothing.
    await expect(canvas.queryByRole('button', { name: /Coming soon/ })).toBeNull();
    await expect(canvas.getByRole('heading', { level: 2, name: 'Coming soon' })).toBeVisible();
    // Pressing it again closes it, and one at a time: the page holds exactly one open.
    await userEvent.click(fold);
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
  },
};

/**
 * Something a customer said (spec 0052, AC-5220): a quiet quote in the reading measure, who said it under it. No
 * border, no quotation mark graphic and nothing to press — it is the page talking, not one more thing to tap.
 */
export const Testimonials: Story = {
  args: { person: PERSON },
  render: (args) => (
    <Stage width="phone" height="page">
      <LinkPage
        {...args}
        blocks={[
          { kind: 'page', id: 'intro', title: 'Intro call', href: '/anish/intro-call', facts: '15 min · 30 min' },
          {
            kind: 'testimonial',
            id: 'priya',
            quote: 'Booking went from three emails to one link.\nOur reps stopped chasing times.',
            author: 'Priya Raman',
            role: 'Head of Sales, Northwind',
          },
          { kind: 'testimonial', id: 'sam', quote: 'It just books itself.', author: 'Sam Oyelaran' },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    settleEntrance(canvasElement);
    // The words keep their line breaks, as a piece of writing does.
    await expect(canvas.getByText(/Booking went from three emails/)).toBeVisible();
    await expect(canvas.getByText('Priya Raman')).toBeVisible();
    await expect(canvas.getByText('Head of Sales, Northwind')).toBeVisible();
    // A testimonial without a role says only the name, and neither is a thing to press.
    await expect(canvas.getByText('Sam Oyelaran')).toBeVisible();
    await expect(canvas.queryByRole('link', { name: /Sam Oyelaran/ })).toBeNull();
    await expect(canvas.queryByRole('button', { name: /Priya Raman/ })).toBeNull();
  },
};

/**
 * `ghosts`: places for blocks that aren't on the page yet, under the ones
 * that are (first run's preview of a page still being made). The page itself
 * never draws them.
 */
export const WithGhosts: Story = {
  render: () => (
    <Stage width="fill">
      <LinkPage
        isPreview
        person={{ name: 'Ada Lovelace', id: 'ada' }}
        address={{ label: 'timefix.com/ada', value: 'https://timefix.com/ada' }}
        blocks={[{ kind: 'page', id: 'intro', title: 'Intro call', href: '/ada/intro', facts: '30 min' }]}
        ghosts={3}
      />
    </Stage>
  ),
};

/** Anish's page in one of the four templates (spec 0068, AC-6801), in the orange brand. */
function templated(template: NonNullable<PageLook['template']>): Story {
  return {
    args: { person: PERSON, theme: { ...PLAIN, template }, variables: ORANGE_BRAND },
    render: (args) => (
      <Stage width="fill" height="page">
        <LinkPage {...args} blocks={anishBlocks()} />
      </Stage>
    ),
    play: async ({ canvasElement }) => {
      settleEntrance(canvasElement);
      const root = canvasElement.querySelector('[data-template]');
      // The template is one attribute, and the names it fixes come with it, whatever the stored look holds.
      await expect(root).toHaveAttribute('data-template', template);
      await expect(root?.getAttribute('style') ?? '').not.toContain('background');
    },
  };
}

/** Classic: the visitor's light or dark, a clean grotesk, rows that lift a touch under the pointer. */
export const TemplateClassic: Story = templated('classic');
/** Studio: warm off white, an editorial serif, round cards and the cover header (centred with no cover photo). */
export const TemplateStudio: Story = templated('studio');
/** Night: a deep dark ground, bold type and the accent as a glow. */
export const TemplateNight: Story = templated('night');
/** Split: a sticky panel with who the page is beside the blocks, from the page breakpoint; one column below it. */
export const TemplateSplit: Story = templated('split');

/** The template picker's large miniatures (spec 0068, AC-6804): the four side by side, each the page in it. */
export const TemplateThumbnails: Story = {
  render: () => (
    <Stage width="fill">
      <TileGrid
        variant="choice"
        label="Template"
        defaultValue="classic"
        showsDescription
        keepsPicture
        pictureSize="large"
        tiles={(['classic', 'studio', 'night', 'split'] as const).map((template) => ({
          id: template,
          name: template,
          description: template,
          thumbnail: <LinkPageThumbnail theme={{ ...PLAIN, template }} variables={ORANGE_BRAND} size="large" />,
        }))}
      />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-size="large"]')).toHaveLength(4);
  },
};

/** A navy brand, as `brandProperties(brandVariables({ accent: '#1f2a5a' }))` makes it: dark, lifted for dark pages. */
const NAVY_BRAND = [
  ['--brand-accent', '#1f2a5a'],
  ['--brand-on-accent', '#ffffff'],
  ['--brand-link', '#1f2a5a'],
  ['--brand-accent-dark', '#6878af'],
  ['--brand-on-accent-dark', '#000000'],
  ['--brand-link-dark', '#8597d0'],
] as const;

/** A yellow brand, as `brandProperties(brandVariables({ accent: '#f5c518' }))` makes it: darkened for light pages. */
const YELLOW_BRAND = [
  ['--brand-accent', '#a38100'],
  ['--brand-on-accent', '#000000'],
  ['--brand-link', '#806600'],
  ['--brand-accent-dark', '#f5c518'],
  ['--brand-on-accent-dark', '#000000'],
  ['--brand-link-dark', '#f5c518'],
] as const;

/**
 * A template in a hard accent (spec 0068, AC-6802): navy, which sinks into a dark ground, or yellow, which vanishes
 * on a light one. The contrast rule (spec 0060) adjusts the accent where it carries text, and axe checks AA in light
 * and dark on every one.
 */
function accented(template: NonNullable<PageLook['template']>, variables: typeof NAVY_BRAND | typeof YELLOW_BRAND) {
  return {
    parameters: { crm: { screenshot: false } },
    args: {
      person: { ...PERSON, role: 'Head of partnerships' },
      brand: { name: 'Acme', logo: LOGO, href: 'https://acme.example' },
      theme: { ...PLAIN, template },
      variables,
    },
    render: (args) => (
      <Stage width="fill">
        <LinkPage {...args} blocks={anishBlocks()} />
      </Stage>
    ),
    play: async ({ canvasElement }) => {
      settleEntrance(canvasElement);
      await expect(canvasElement.querySelector('[data-template]')).toHaveAttribute('data-template', template);
    },
  } satisfies Story;
}

/** Classic in navy. */
export const ClassicNavy: Story = accented('classic', NAVY_BRAND);
/** Classic in yellow. */
export const ClassicYellow: Story = accented('classic', YELLOW_BRAND);
/** Studio in navy: the paper takes a touch of the navy. */
export const StudioNavy: Story = accented('studio', NAVY_BRAND);
/** Studio in yellow: the paper takes a touch of the yellow. */
export const StudioYellow: Story = accented('studio', YELLOW_BRAND);
/** Night in navy: the lifted navy glows; titles stay light. */
export const NightNavy: Story = accented('night', NAVY_BRAND);
/** Night in yellow. */
export const NightYellow: Story = accented('night', YELLOW_BRAND);
/** Split in navy. */
export const SplitNavy: Story = accented('split', NAVY_BRAND);
/** Split in yellow. */
export const SplitYellow: Story = accented('split', YELLOW_BRAND);

/** Night's titles are the card's own light text, and the accent only marks each row's end (spec 0068). */
export const NightTitlesStayLight: Story = {
  ...accented('night', NAVY_BRAND),
  play: async ({ canvas, canvasElement }) => {
    settleEntrance(canvasElement);
    const title = canvas.getByText('Intro call');
    const name = canvas.getByRole('heading', { level: 1 });
    // The title takes the page's text colour, never the accent's.
    await expect(getComputedStyle(title).color).toBe(getComputedStyle(name).color);
  },
};

/** A stand in cover photo: a soft landscape, drawn as an SVG so the story needs no photo route. */
const COVER_PHOTO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 240" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6d6b8"/><stop offset="1" stop-color="#e9a77f"/></linearGradient></defs><rect width="600" height="240" fill="url(#s)"/><circle cx="450" cy="90" r="38" fill="#fff4e0"/><path d="M0 190 Q150 120 300 175 T600 160 V240 H0Z" fill="#b5654a"/><path d="M0 215 Q200 170 380 210 T600 205 V240 H0Z" fill="#7d3f33"/></svg>',
)}`;

/**
 * Sets the cover photo the way the page's own stylesheet does (`--page-cover-image`), through the CSSOM on a wrapper
 * the page inherits it from: `variables` takes only our own api's photos, which a story has no route for.
 */
function withCover(element: HTMLElement | null) {
  element?.style.setProperty('--page-cover-image', `url("${COVER_PHOTO}")`);
}

/** Studio with its cover photo: the band across the top the face overlaps, on the accent warmed paper. */
export const StudioWithCover: Story = {
  args: {
    person: { ...PERSON, role: 'Head of partnerships' },
    theme: { ...PLAIN, template: 'studio' },
    photos: { cover: true },
    variables: ORANGE_BRAND,
  },
  render: (args) => (
    <Stage width="fill" height="page">
      <div ref={withCover}>
        <LinkPage {...args} blocks={anishBlocks()} />
      </div>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    settleEntrance(canvasElement);
    await expect(canvasElement.querySelector('[data-template]')).toHaveAttribute('data-page-header', 'cover');
  },
};

/**
 * Classic and Night with a cover photo (spec 0068, AC-6802): their cover is optional, so each draws the cover header
 * once the page has one, Classic as a modest band and Night as the usual one, and its own centred header without.
 */
function withCoverIn(template: 'classic' | 'night'): Story {
  return {
    parameters: { crm: { screenshot: false } },
    args: { person: PERSON, theme: { ...PLAIN, template }, photos: { cover: true }, variables: ORANGE_BRAND },
    render: (args) => (
      <Stage width="fill" height="page">
        <div ref={withCover}>
          <LinkPage {...args} blocks={anishBlocks()} />
        </div>
      </Stage>
    ),
    play: async ({ canvasElement }) => {
      settleEntrance(canvasElement);
      const root = canvasElement.querySelector('[data-template]');
      await expect(root).toHaveAttribute('data-page-header', 'cover');
      const band = root?.querySelector('header > [class*="-cover"]');
      await expect(band).not.toBeNull();
      // A band the width of the column and shorter than it is wide: Classic's 4:1, Night's 3:1.
      const box = band?.getBoundingClientRect();
      const ratio = (box?.width ?? 0) / Math.max(1, box?.height ?? 0);
      await expect(Math.round(ratio)).toBe(template === 'classic' ? 4 : 3);
    },
  };
}

/** Classic with a cover photo: a modest band above the centred face. */
export const ClassicWithCover: Story = withCoverIn('classic');
/** Night with a cover photo: the cover header on the ink ground. */
export const NightWithCover: Story = withCoverIn('night');

/** Classic with no cover photo keeps its own centred header, with no band. */
export const ClassicWithoutCover: Story = {
  parameters: { crm: { screenshot: false } },
  args: { person: PERSON, theme: { ...PLAIN, template: 'classic' }, photos: {}, variables: ORANGE_BRAND },
  render: (args) => (
    <Stage width="fill" height="page">
      <LinkPage {...args} blocks={anishBlocks().slice(0, 2)} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    settleEntrance(canvasElement);
    const root = canvasElement.querySelector('[data-template]');
    await expect(root).toHaveAttribute('data-page-header', 'centred');
    await expect(root?.querySelector('header > [class*="-cover"]')).toBeNull();
  },
};

/**
 * Split with everything its panel holds (spec 0068): the logo, the name, whether the place is open and Book, on the
 * page's own ground with no card around them; the blocks beside it on a wide page, under it on a phone.
 */
export const SplitPanel: Story = {
  args: {
    person: { ...PERSON, role: 'Head of partnerships' },
    brand: { name: 'Acme', logo: LOGO, href: 'https://acme.example' },
    theme: { ...PLAIN, template: 'split' },
    variables: ORANGE_BRAND,
    openNow: 'Open now · until 6 PM',
    book: { label: 'Book a call', href: '/anish/intro-call' },
  },
  render: (args) => (
    <Stage width="fill" height="page">
      <LinkPage {...args} blocks={anishBlocks()} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    settleEntrance(canvasElement);
    await expect(canvas.getByText('Open now · until 6 PM')).toBeVisible();
    await expect(canvas.getByRole('link', { name: /Book a call/ })).toHaveAttribute('href', '/anish/intro-call');
  },
};

/** Book only takes a path on this site: an outside address draws no button. */
export const BookRefusesOutside: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    person: PERSON,
    theme: { ...PLAIN, template: 'split' },
    book: { label: 'Book a call', href: 'https://elsewhere.example/book' },
  },
  render: (args) => (
    <Stage width="phone" height="page">
      <LinkPage {...args} blocks={anishBlocks().slice(0, 2)} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('link', { name: /Book a call/ })).toBeNull();
  },
};

/** A stand in face: a round portrait, as an SVG. */
const FACE_PHOTO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#c9d7e8"/><circle cx="40" cy="32" r="15" fill="#8a5a44"/><path d="M12 80 Q40 44 68 80Z" fill="#2f4a6d"/></svg>',
)}`;

/**
 * The template picker's large miniatures with the owner's own page (spec 0068, AC-6804): their name, face or
 * initials, logo, cover where the template wears one, and their first three rows, in their accent.
 */
export const TemplateThumbnailsReal: Story = {
  render: () => (
    <Stage width="fill">
      <TileGrid
        variant="choice"
        label="Template"
        defaultValue="studio"
        showsDescription
        keepsPicture
        pictureSize="large"
        tiles={(['classic', 'studio', 'night', 'split'] as const).map((template, index) => ({
          id: template,
          name: template,
          description: template,
          thumbnail: (
            <LinkPageThumbnail
              theme={{ ...PLAIN, template }}
              variables={NAVY_BRAND}
              size="large"
              profile={{
                name: 'Anish Gupta',
                cover: COVER_PHOTO,
                rows: ['Intro call', 'Product demo', 'LinkedIn', 'X'],
                // A picture, the company's logo in the face's place, a picture, then initials on the accent.
                ...(index % 2 === 0 ? { picture: FACE_PHOTO } : {}),
                ...(index === 1 ? { logo: LOGO } : {}),
              }}
            />
          ),
        }))}
      />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-size="large"]')).toHaveLength(4);
    // The owner's rows, three of them, in every miniature.
    await expect(canvasElement.querySelectorAll('[data-profile]')).toHaveLength(4);
    await expect([...canvasElement.querySelectorAll('[data-profile]')][0]).toHaveTextContent(
      /Anish Gupta.*Intro call.*Product demo.*LinkedIn/,
    );
  },
};
