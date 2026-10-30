import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { probeAlignment } from '../../lib/alignment-probe.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import { TileGrid } from '../../molecules/TileGrid/TileGrid.tsx';
import { ReadyPanel } from './ReadyPanel.tsx';

const LINK = 'https://timefix.com/b/intro-call';

const meta = {
  title: 'Modules/ReadyPanel',
  component: ReadyPanel,
  args: { title: 'Your booking page is ready', link: LINK, onShare: fn() },
  render: (args) => (
    <Stage width="dialog">
      <ReadyPanel {...args} />
    </Stage>
  ),
} satisfies Meta<typeof ReadyPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

function MiniPage() {
  return <Skeleton shape="block" />;
}

/** The link, Copy, Share, its QR code and a preview of the visitor's page. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  args: {
    message: 'Anyone with the link can book.',
    preview: <MiniPage />,
    actions: <Button variant="primary">Done</Button>,
  },
  play: async ({ canvas, args }) => {
    await settleAnimations();
    await expect(canvas.getByRole('heading', { name: 'Your booking page is ready' })).toBeVisible();
    await expect(canvas.getByRole('img', { name: 'QR code for the link' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Share' }));
    await expect(args.onShare).toHaveBeenCalled();
    const report = probeAlignment({ root: 'body', ignoreSpacing: '*' });
    await expect(report.failures).toEqual([]);
    await expect(report.checked['left-edge']).toBeGreaterThan(3);
  },
};

/** Copy puts the link on the clipboard, then says Copied with a tick. */
export const Copied: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Copy link' }));
    await expect(await canvas.findByRole('button', { name: 'Copied' })).toBeVisible();
    await expect(canvas.getByRole('status')).toHaveTextContent('Link copied');
  },
};

/** A form's first publish: the three embed choices below the link, as tiles. */
export const WithEmbedTiles: Story = {
  args: {
    title: 'Your form is live',
    link: 'https://timefix.com/f/contact-us',
    preview: <MiniPage />,
    children: (
      <TileGrid
        variant="choice"
        mode="action"
        label="Embed"
        onAction={fn()}
        tiles={[
          { id: 'inline', name: 'Inline', icon: 'layout-grid' },
          { id: 'popup', name: 'Popup', icon: 'panel-left-open' },
          { id: 'corner', name: 'Corner button', icon: 'message-square' },
        ]}
      />
    ),
  },
  render: (args) => (
    <Stage width="dialog">
      <ReadyPanel {...args} />
    </Stage>
  ),
};

/** No preview and no Share: the link and its QR alone. */
export const Minimal: Story = {
  parameters: { crm: { screenshot: false } },
  args: { onShare: undefined },
};
