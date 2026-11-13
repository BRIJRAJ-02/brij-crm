import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, spyOn, userEvent, waitFor } from 'storybook/test';
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
    // The test browsers grant no clipboard permission, so the write is stubbed, as CopyButton's own story does.
    const write = spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    // The panel eases in, and the test helpers hold that at its first frame (opacity 0) until settled.
    await settleAnimations();
    await userEvent.click(canvas.getByRole('button', { name: 'Copy link' }));
    await expect(write).toHaveBeenCalledWith(LINK);
    await expect(await canvas.findByRole('button', { name: 'Copied' })).toBeVisible();
    await expect(canvas.getByRole('status')).toHaveTextContent('Link copied');
    write.mockRestore();
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

/**
 * Inside a Modal that already titles it: no heading of its own (the dialog keeps one), a long link cut in the middle
 * so its host and its end both show, and a tall page drawn at half size from its top.
 */
export const Untitled: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    title: undefined,
    message: 'Anyone with the link can book.',
    link: 'https://timefix.com/ada-lovelace-and-partners/a-rather-long-intro-call-name',
    copyVariant: 'secondary',
    previewScale: 'shrunk',
    preview: <Skeleton lines={24} isStill />,
  },
  play: async ({ canvas }) => {
    await settleAnimations();
    await expect(canvas.queryByRole('heading')).toBeNull();
    const end = canvas.getByText('a-rather-long-intro-call-name', { exact: true });
    const field = canvas.getByRole('group', { name: 'Link' });
    // The end shows whole inside the address box, and the start gives way.
    const box = end.parentElement;
    if (box === null) throw new Error('no address box');
    await expect(end.getBoundingClientRect().right).toBeLessThanOrEqual(box.getBoundingClientRect().right);
    const start = end.previousElementSibling;
    if (start === null) throw new Error('no start');
    await expect(start.scrollWidth).toBeGreaterThan(start.clientWidth);
    await expect(field).toHaveTextContent(
      'https://timefix.com/ada-lovelace-and-partners/a-rather-long-intro-call-name',
    );
    // The picture starts at the slot's top, half size, and takes no tab stop.
    const preview = canvas.getByRole('group', { name: 'Preview' });
    const glimpse = preview.firstElementChild;
    if (glimpse === null) throw new Error('no glimpse');
    await expect(Math.abs(glimpse.getBoundingClientRect().top - preview.getBoundingClientRect().top)).toBeLessThan(2);
    await expect(glimpse).toHaveAttribute('inert');
  },
};

/** No preview and no Share: the link and its QR alone. */
export const Minimal: Story = {
  parameters: { crm: { screenshot: false } },
  args: { onShare: undefined },
};

/**
 * Inside a dialog whose footer has the primary button: Copy steps down to secondary, and a tall preview (a whole
 * phone) is cut at the slot's cap with its top in view.
 */
export const InDialog: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    copyVariant: 'secondary',
    preview: <Skeleton lines={24} isStill />,
  },
  play: async ({ canvas }) => {
    await settleAnimations();
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toHaveAttribute('data-variant', 'secondary');
    const cap = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--size-column'));
    const preview = canvas.getByRole('group', { name: 'Preview' });
    await expect(preview.getBoundingClientRect().height).toBeLessThanOrEqual(cap + 1);
    // The picture itself: its inert wrapper draws no box of its own at the actual size.
    const top = preview.firstElementChild?.firstElementChild?.getBoundingClientRect().top ?? 0;
    await expect(top).toBeGreaterThanOrEqual(preview.getBoundingClientRect().top);
  },
};

/**
 * Share, as a form's live dialog and Share tab draw it: the link with Copy link (the one primary), one row of equal
 * buttons under it, the QR code beside them on its light tile with Download under it, then the onward row.
 */
export const Share: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    title: undefined,
    variant: 'share',
    link: 'https://timefix.com/f/lead-qualification',
    shareTitle: 'Lead qualification',
    onDownloadQr: fn(() => Promise.resolve()),
    onward: { label: 'Put it on your site', href: '/forms/contact-us/share' },
  },
  play: async ({ canvas, args }) => {
    await settleAnimations();
    await expect(canvas.getByRole('group', { name: 'Link' })).toBeInTheDocument();
    await expect(canvas.getByText('lead-qualification')).toBeInTheDocument();
    await expect(canvas.getByRole('img', { name: 'QR code for the link' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Email' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:/),
    );
    await expect(canvas.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^https:\/\/wa\.me\//),
    );
    await expect(canvas.getByRole('link', { name: 'Put it on your site' })).toHaveAttribute(
      'href',
      '/forms/contact-us/share',
    );
    // One height and one width for the row: every way to pass it on is the same button.
    const ways = [...(canvas.getByRole('group', { name: 'Send the link' }).children as HTMLCollectionOf<HTMLElement>)];
    const sizes = new Set(ways.map((each) => String(Math.round(each.getBoundingClientRect().width))));
    await expect(sizes.size).toBe(1);
    // The link is the hero: Copy link is the one primary, as tall as the address beside it.
    const copy = canvas.getByRole('button', { name: 'Copy link' });
    await expect(copy).toHaveAttribute('data-variant', 'primary');
    const address = canvas.getByText('lead-qualification').parentElement;
    await expect(Math.round(copy.getBoundingClientRect().height)).toBe(
      Math.round(address?.getBoundingClientRect().height ?? 0),
    );
    // The code and its download are one thing: Download sits right under the code (wide) or beside it (narrow), never
    // in the row of ways.
    const code = canvas.getByRole('img', { name: 'QR code for the link' }).getBoundingClientRect();
    const save = canvas.getByRole('button', { name: /^PNG/ });
    const saved = save.getBoundingClientRect();
    const isUnder = saved.top >= code.bottom && saved.top - code.bottom < 24;
    const isBeside = saved.left >= code.right && saved.left - code.right < 24;
    await expect(isUnder || isBeside).toBe(true);
    await expect(canvas.getByRole('group', { name: 'Send the link' })).not.toContainElement(save);
    // The prototype's pair (AC-7428): the line saying what the code is for, then each file in one press, handed the
    // code's own SVG.
    await expect(canvas.getByText('For a card, a table, a poster or a slide.')).toBeInTheDocument();
    await userEvent.click(save);
    await expect(args.onDownloadQr).toHaveBeenCalledTimes(1);
    await expect(args.onDownloadQr).toHaveBeenLastCalledWith('png', expect.any(SVGSVGElement));
    await waitFor(() => expect(save).not.toHaveAttribute('data-pending'));
    const svg = canvas.getByRole('button', { name: /^SVG/ });
    await expect(svg).toHaveAttribute('data-variant', 'ghost');
    await expect(save).toHaveAttribute('data-variant', 'secondary');
    await userEvent.click(svg);
    await expect(args.onDownloadQr).toHaveBeenCalledTimes(2);
    await expect(args.onDownloadQr).toHaveBeenLastCalledWith('svg', expect.any(SVGSVGElement));
  },
};

/**
 * Share with the large code (spec 0074, AC-7427), as the link page's Share draws it: a code scanned from a screen
 * across a table is `size-menu` wide, under the link and the ways at every width, its Download centred under it.
 */
export const ShareLargeCode: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    title: undefined,
    variant: 'share',
    link: 'https://timefix.com/priya',
    shareTitle: '@priya',
    qrSize: 'lg',
    onDownloadQr: fn(() => Promise.resolve()),
  },
  play: async ({ canvas, canvasElement }) => {
    await settleAnimations();
    const code = canvas.getByRole('img', { name: 'QR code for the link' }).getBoundingClientRect();
    // As wide as size-menu, which a probe in the panel measures (the token differs between the app and full size).
    const probe = document.createElement('div');
    probe.style.inlineSize = 'var(--size-menu)';
    canvasElement.querySelector('[data-variant="share"]')?.append(probe);
    const menu = probe.getBoundingClientRect().width;
    probe.remove();
    await expect(menu).toBeGreaterThan(0);
    await expect(Math.round(code.width)).toBe(Math.round(menu));
    // Under the ways, not beside them, in the dialog's width too.
    const ways = canvas.getByRole('group', { name: 'Send the link' }).getBoundingClientRect();
    await expect(code.top).toBeGreaterThanOrEqual(ways.bottom);
    // The downloads right under the code (their line, then PNG and SVG), centred on the tile.
    const line = canvas.getByText('For a card, a table, a poster or a slide.').getBoundingClientRect();
    await expect(line.top).toBeGreaterThanOrEqual(code.bottom);
    await expect(line.top - code.bottom).toBeLessThan(24);
    const saved = canvas.getByRole('group', { name: 'Download the QR code' }).getBoundingClientRect();
    await expect(saved.top).toBeGreaterThanOrEqual(line.bottom);
    const tile = canvas.getByRole('img', { name: 'QR code for the link' }).parentElement?.getBoundingClientRect();
    await expect(Math.abs((tile?.left ?? 0) + (tile?.width ?? 0) / 2 - (saved.left + saved.width / 2))).toBeLessThan(2);
  },
};
