import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { hoverFresh, shownTooltip } from '../../workbench/pointer.ts';
import { SettingsRow } from '../../modules/SettingsLayout/SettingsLayout.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SocialLinks, type SocialLinkItem } from './SocialLinks.tsx';

const ALL: readonly SocialLinkItem[] = [
  { network: 'linkedin', href: 'https://linkedin.com/in/ada-lovelace', label: 'ada-lovelace' },
  { network: 'x', href: 'https://x.com/ada', label: '@ada' },
  { network: 'instagram', href: 'https://instagram.com/ada.l', label: '@ada.l' },
  { network: 'github', href: 'https://github.com/ada', label: 'ada' },
  { network: 'facebook', href: 'https://facebook.com/ada.l', label: 'ada.l' },
  { network: 'youtube', href: 'https://youtube.com/@adamakes', label: '@adamakes' },
  { network: 'tiktok', href: 'https://tiktok.com/@adal', label: '@adal' },
  { network: 'threads', href: 'https://threads.com/@ada.l', label: '@ada.l' },
  { network: 'angellist', href: 'https://wellfound.com/u/ada', label: 'ada' },
  { network: 'website', href: 'https://ada.dev', label: 'ada.dev' },
];

const meta = {
  title: 'Molecules/SocialLinks',
  component: SocialLinks,
  args: { links: ALL.slice(0, 3), label: 'Ada Lovelace’s social links' },
} satisfies Meta<typeof SocialLinks>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A few links: each a named link that opens in a new tab as the person's own. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    const list = canvas.getByRole('list', { name: 'Ada Lovelace’s social links' });
    await expect(list).toBeVisible();
    const linkedin = canvas.getByRole('link', { name: 'LinkedIn, ada-lovelace' });
    await expect(linkedin).toHaveAttribute('href', 'https://linkedin.com/in/ada-lovelace');
    await expect(linkedin).toHaveAttribute('target', '_blank');
    await expect(linkedin).toHaveAttribute('rel', 'me nofollow noopener noreferrer');
  },
};

/** Hovering a mark shows the network and where it goes, after the tooltip's pause. */
export const Tooltip: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, userEvent }) => {
    await hoverFresh(userEvent, canvas.getByRole('link', { name: 'X, @ada' }));
    await expect(await shownTooltip()).toHaveTextContent('X · @ada');
  },
};

/** Inside text: a SettingsRow's description (the booking editor's card) holds the list as phrasing elements. */
export const Inline: Story = {
  args: { isInline: true },
  render: (args) => (
    <Stage width="narrow-fill">
      <SettingsRow title="Show on this page" description={<SocialLinks {...args} />} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const list = canvas.getByRole('list', { name: 'Ada Lovelace’s social links' });
    await expect(list.tagName).toBe('SPAN');
    await expect(canvas.getAllByRole('listitem')).toHaveLength(3);
  },
};

/** One link. */
export const One: Story = {
  args: { links: [{ network: 'website', href: 'https://ada.dev', label: 'ada.dev' }] },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('link')).toHaveLength(1);
    await expect(canvas.getByRole('link', { name: 'Website, ada.dev' })).toBeVisible();
  },
};

/** All ten: the row wraps rather than overflowing a narrow column (a phone). */
export const AllTen: Story = {
  args: { links: ALL },
  render: (args) => (
    <Stage width="phone">
      <SocialLinks {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('link')).toHaveLength(10);
  },
};

/** None: nothing draws, so a slot leaves no gap. */
export const Empty: Story = {
  args: { links: [] },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('ul')).toBeNull();
  },
};

/** A link `safeHref` refuses draws disabled, never a live `javascript:` link (the server never sends one). */
export const RefusedLink: Story = {
  args: { links: [{ network: 'website', href: 'javascript:alert(1)', label: 'nope' }] },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('a[href]')).toBeNull();
  },
};

/** Round: a link page's row under the person's card, centred circles with every mark in the text colour. */
export const Round: Story = {
  args: { links: [...ALL.slice(0, 3), ALL[9] as SocialLinkItem], variant: 'round' },
  render: (args) => (
    <Stage width="phone">
      <SocialLinks {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const linkedin = canvas.getByRole('link', { name: 'LinkedIn, ada-lovelace' });
    await expect(linkedin).toHaveAttribute('rel', 'me nofollow noopener noreferrer');
    await expect(linkedin.getBoundingClientRect().height).toBe(44);
  },
};
