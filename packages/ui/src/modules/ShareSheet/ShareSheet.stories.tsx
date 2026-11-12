import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { settleAnimations } from '../../workbench/animations.ts';
import { ShareSheet, type ShareSheetProps } from './ShareSheet.tsx';

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
    await expect(sheet.getByRole('button', { name: /^Download QR code/ })).toBeInTheDocument();
    // Done is the only other button in the footer, and the dialog opens on it: Enter and Esc both close it.
    const done = sheet.getByRole('button', { name: 'Done' });
    await waitFor(() => expect(done).toHaveFocus());
    await expect(done).not.toHaveAttribute('data-variant', 'primary');
    // Nothing that embeds was named, so there is no "Put it on your site" row.
    await expect(sheet.queryByRole('link', { name: 'Put it on your site' })).toBeNull();
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
    invite: 'Pick a time that suits you:',
    embedHref: '/w/acme/bookings/discovery-call/embed',
    extra: (
      <>
        <Button icon="calendar-clock">Offer specific times</Button>
        <Button icon="link">One-time link</Button>
      </>
    ),
    footer: 'Bookings go to your calendar',
  },
  play: async ({ args, userEvent }) => {
    const sheet = within(await openSheet());
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
