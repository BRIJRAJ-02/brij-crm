import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { BookingFoot } from '../BookingFrame/BookingFrame.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { LinkPage, LinkPageTile, type LinkPageBlock } from './LinkPage.tsx';

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
    theme: { ground: 'tint', hue: 'purple', mode: 'light', shape: 'pill', fill: 'solid', font: 'mono' },
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
    theme: { ground: 'ink', hue: 'blue', mode: 'dark', shape: 'square', fill: 'outline', font: 'sans' },
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
