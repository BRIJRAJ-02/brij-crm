import { clearAnnouncer } from '@react-aria/live-announcer';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, screen, spyOn, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import { ShareColumn, ShareSheet, type ShareSheetProps } from './ShareSheet.tsx';

const ADDRESS = 'https://timefix.com/priya/discovery-call';

/** The sheet open on a page, with a Share button that opens it again once it is closed. */
function Opened(
  props: Omit<ShareSheetProps, 'isOpen' | 'onOpenChange'> & { readonly onOpenChange?: (open: boolean) => void },
) {
  const [isOpen, setOpen] = useState(true);
  return (
    <Stage>
      <Button icon="share" onPress={() => setOpen(true)}>
        Share
      </Button>
      <ShareSheet
        {...props}
        isOpen={isOpen}
        onOpenChange={(open) => {
          setOpen(open);
          props.onOpenChange?.(open);
        }}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/ShareSheet',
  component: ShareSheet,
  args: {
    isOpen: true,
    onOpenChange: fn(),
    title: 'Share Discovery call',
    url: ADDRESS,
    name: 'Discovery call',
  },
  render: (args) => <Opened {...args} />,
} satisfies Meta<typeof ShareSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The sheet in the dialog it always opens in. */
async function openSheet(): Promise<HTMLElement> {
  const dialog = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('[role="dialog"]');
    if (found === null) throw new Error('the sheet did not open');
    return found;
  });
  await settleAnimations();
  return dialog;
}

/** Share: the QR code, the link with Copy link (the one primary), Email, WhatsApp and More, Download, and Done. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async () => {
    const sheet = within(await openSheet());
    await expect(sheet.getByRole('heading', { name: 'Share Discovery call' })).toBeInTheDocument();
    await expect(sheet.getByRole('img', { name: 'QR code for Discovery call' })).toBeInTheDocument();
    await expect(sheet.getByText('discovery-call')).toBeInTheDocument();
    await expect(sheet.getByRole('button', { name: 'Copy link' })).toHaveAttribute('data-variant', 'primary');
    await expect(sheet.getByRole('link', { name: 'Email' })).toHaveAttribute(
      'href',
      `mailto:?subject=Discovery%20call&body=${encodeURIComponent(ADDRESS)}`,
    );
    await expect(sheet.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
      'href',
      `https://wa.me/?text=${encodeURIComponent(ADDRESS)}`,
    );
    // Download under the code, a menu of PNG and SVG.
    await expect(sheet.getByRole('button', { name: /^Download QR code/ })).toBeInTheDocument();
    // Done is the only other button in the footer, and the dialog opens on it: Enter and Esc both close it.
    const done = sheet.getByRole('button', { name: 'Done' });
    await waitFor(() => expect(done).toHaveFocus());
    await expect(done).not.toHaveAttribute('data-variant', 'primary');
    // Nothing that embeds was named, so there is no "Put it on your site" row.
    await expect(sheet.queryByRole('link', { name: 'Put it on your site' })).toBeNull();
  },
};

/**
 * The link page's code in the owner's saved style (spec 0061, AC-6124; spec 0074, AC-7403): the modules' colour and
 * a framed label, drawn on the sheet's light tile as they are in what Download saves.
 */
export const Styled: Story = {
  args: {
    title: 'Share your link page',
    description: 'Your link page in Acme.',
    url: 'https://timefix.com/priya',
    name: '@priya',
    qrStyle: { colour: '#1d4ed8', frameLabel: 'Scan me' },
  },
  play: async () => {
    const sheet = within(await openSheet());
    const code = sheet.getByRole('img', { name: 'QR code for @priya' });
    await expect(code.style.getPropertyValue('--qr-modules')).toBe('#1d4ed8');
    await expect(code).toHaveAttribute('data-framed');
    await expect(within(code).getByText('Scan me')).toBeInTheDocument();
    await expect(sheet.getByText('Your link page in Acme.')).toBeInTheDocument();
  },
};

/** The link page's sheet (spec 0074, AC-7427): the large code under the ways, scanned from a screen across a table. */
export const LargeCode: Story = {
  parameters: { crm: { screenshot: false } },
  args: { qrSize: 'lg', title: 'Share your link page', url: 'https://timefix.com/priya', name: '@priya' },
  play: async () => {
    const sheet = within(await openSheet());
    const code = sheet.getByRole('img', { name: 'QR code for @priya' }).getBoundingClientRect();
    const ways = sheet.getByRole('group', { name: 'Send the link' }).getBoundingClientRect();
    await expect(code.top).toBeGreaterThanOrEqual(ways.bottom);
    // Larger than the small code beside the ways (size-column-narrow) by far.
    await expect(code.width).toBeGreaterThan(180);
  },
};

/** Done closes the sheet; Share opens it again. */
export const Closing: Story = {
  parameters: { crm: { screenshot: false } },
  args: { onOpenChange: fn() },
  play: async ({ args, canvas, userEvent }) => {
    const sheet = within(await openSheet());
    await userEvent.click(sheet.getByRole('button', { name: 'Done' }));
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await userEvent.click(canvas.getByRole('button', { name: 'Share' }));
    await openSheet();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  },
};

/**
 * A booking page after its first publish: the invite before the link in Email and WhatsApp, "Put it on your site"
 * (which closes the sheet on its way), the page's own ways in a row, and the footer's quiet line beside Done.
 */
export const Everything: Story = {
  args: {
    title: 'Discovery call is live',
    description: 'Anyone with the link can book a time with you.',
    invite: 'Pick a time that suits you:',
    embedHref: '/w/acme/bookings/discovery-call/embed',
    extra: (
      <>
        <Button variant="ghost" icon="calendar-clock">
          Offer specific times
        </Button>
        <Button variant="ghost" icon="link">
          One-time link
        </Button>
      </>
    ),
    footer: 'Bookings go to your calendar',
  },
  play: async ({ args, userEvent }) => {
    const dialog = await openSheet();
    const sheet = within(dialog);
    await expect(dialog).toHaveAccessibleDescription('Anyone with the link can book a time with you.');
    const message = encodeURIComponent(`Pick a time that suits you: ${ADDRESS}`);
    await expect(sheet.getByRole('link', { name: 'Email' })).toHaveAttribute(
      'href',
      `mailto:?subject=Discovery%20call&body=${message}`,
    );
    await expect(sheet.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
      'href',
      `https://wa.me/?text=${message}`,
    );
    const ways = sheet.getByRole('group', { name: 'More ways to share' });
    await expect(
      within(ways)
        .getAllByRole('button')
        .map((each) => each.textContent),
    ).toEqual(['Offer specific times', 'One-time link']);
    await expect(sheet.getByText('Bookings go to your calendar')).toBeInTheDocument();
    const onSite = sheet.getByRole('link', { name: 'Put it on your site' });
    await expect(onSite).toHaveAttribute('href', '/w/acme/bookings/discovery-call/embed');
    await userEvent.click(onSite);
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
  },
};

/** Download saves the code as a PNG; when the browser refuses, a toast says so and the sheet stays open. */
export const DownloadFails: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ userEvent }) => {
    const sheet = within(await openSheet());
    // The browser refusing the file: the saved code is made through a `blob:` address, so refuse making one.
    const refuse = spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('Blocked.');
    });
    try {
      await userEvent.click(sheet.getByRole('button', { name: /^Download QR code/ }));
      await settleAnimations();
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Download PNG' }));
      await expect(await screen.findByText('The QR code didn’t save. Try again.')).toBeInTheDocument();
      await expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    } finally {
      refuse.mockRestore();
    }
  },
};

/**
 * A download in flight holds the sheet open (spec 0074): Done pressed while the file is being made closes the sheet
 * only once it is saved, so the code is never read after it has gone.
 */
export const DownloadHoldsOpen: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ args, userEvent }) => {
    const sheet = within(await openSheet());
    // Hold the PNG's drawing step until the story lets it go.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const decode = spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(() => held);
    const save = spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      await userEvent.click(sheet.getByRole('button', { name: /^Download QR code/ }));
      await settleAnimations();
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Download PNG' }));
      await userEvent.click(sheet.getByRole('button', { name: 'Done' }));
      await expect(args.onOpenChange).not.toHaveBeenCalledWith(false);
      await expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      release();
      await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
      await expect(save).toHaveBeenCalled();
      await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
      // The pending Download React Aria announced is gone with the sheet, so the announcement's label points at
      // nothing for its 7 s; clear it for axe.
      clearAnnouncer('assertive');
    } finally {
      decode.mockRestore();
      save.mockRestore();
    }
  },
};

/** Each address that could run script, refused before anything is drawn, copied, shared or encoded (AC-7318). */
async function expectRefused(): Promise<void> {
  const sheet = within(await openSheet());
  await expect(sheet.getByText('This link can’t be shared, because it isn’t a web address.')).toBeInTheDocument();
  await expect(sheet.queryByRole('img')).toBeNull();
  await expect(sheet.queryByRole('button', { name: 'Copy link' })).toBeNull();
  await expect(sheet.queryByRole('link')).toBeNull();
  await expect(sheet.queryByRole('button', { name: /^Download/ })).toBeNull();
  // Done is still there, so the sheet closes the usual way.
  await expect(sheet.getByRole('button', { name: 'Done' })).toBeInTheDocument();
}

/** A `javascript:` address: one line says it can't be shared, and nothing else is drawn. */
export const RefusedScript: Story = {
  args: { url: 'javascript:alert(document.cookie)', invite: 'Have a look:', footer: 'Bookings go to your calendar' },
  play: async () => {
    await expectRefused();
    // Its footer is left out too: it would describe a share that isn't there.
    await expect(within(await openSheet()).queryByText('Bookings go to your calendar')).toBeNull();
  },
};

/** A `data:` address, refused the same way. */
export const RefusedData: Story = {
  parameters: { crm: { screenshot: false } },
  args: { url: 'data:text/html,<script>alert(1)</script>' },
  play: expectRefused,
};

/** A `vbscript:` address, refused the same way. */
export const RefusedVbscript: Story = {
  parameters: { crm: { screenshot: false } },
  args: { url: 'vbscript:msgbox(1)' },
  play: expectRefused,
};

/**
 * ShareColumn: the sheet's ways to share on a page of its own, a Share tab's card (spec 0074, AC-7402). No dialog;
 * the same code, link, ways and download, and "Put it on your site" as a routed row.
 */
export const Column: Story = {
  render: () => (
    <Stage>
      <ShareColumn url={ADDRESS} name="Discovery call" embedHref="/w/acme/bookings/discovery-call/embed" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(document.querySelector('[role="dialog"]')).toBeNull();
    await expect(canvas.getByRole('img', { name: 'QR code for Discovery call' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Copy link' })).toHaveAttribute('data-variant', 'primary');
    await expect(canvas.getByRole('button', { name: /^Download QR code/ })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: 'Put it on your site' })).toHaveAttribute(
      'href',
      '/w/acme/bookings/discovery-call/embed',
    );
  },
};

/** ShareColumn refuses an address that could run script the same way the sheet does (AC-7318). */
export const ColumnRefused: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage>
      <ShareColumn url="javascript:alert(1)" name="Discovery call" extra={<Button>Offer specific times</Button>} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('This link can’t be shared, because it isn’t a web address.')).toBeInTheDocument();
    await expect(canvas.queryByRole('img')).toBeNull();
    await expect(canvas.queryByRole('button')).toBeNull();
    await expect(canvas.queryByRole('link')).toBeNull();
  },
};
