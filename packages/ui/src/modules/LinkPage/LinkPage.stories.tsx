import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { LinkPage, LinkPageTile, type LinkPageBlock } from './LinkPage.tsx';

const meta = {
  title: 'Modules/LinkPage',
  component: LinkPage,
  args: { claimHref: 'https://www.timefix.com/?utm_content=claim_link', onPress: fn() },
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
 * The contact card (AC-5109, AC-5115): the name and the line under it, and Save contact, a plain link to the card's
 * vCard that a phone offers to add to its contacts, from a QR code too.
 */
export const ContactCard: Story = {
  args: { person: PERSON },
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
    const save = canvas.getByRole('link', { name: /Anish Gupta.*Save contact/ });
    await expect(save).toBeVisible();
    await expect(save).toHaveAttribute('href', '/api/public/handles/anish/contact.vcf');
    await expect(save).not.toHaveAttribute('target');
  },
};
