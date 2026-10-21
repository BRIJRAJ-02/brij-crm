import { clearAnnouncer } from '@react-aria/live-announcer';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor, within } from 'storybook/test';
import { CustomiseSidebar } from './CustomiseSidebar.tsx';

const SECTIONS = [
  {
    id: 'records',
    title: 'Records',
    items: [
      { id: 'people', name: 'People', icon: 'user', hue: 'blue', isShown: true },
      { id: 'companies', name: 'Companies', icon: 'building', hue: 'green', isShown: true },
      { id: 'deals', name: 'Deals', icon: 'handshake', hue: 'orange', isShown: false },
    ],
  },
  {
    id: 'scheduling',
    title: 'Scheduling',
    items: [
      { id: 'bookings', name: 'Bookings', icon: 'calendar-days', isShown: true },
      { id: 'captures', name: 'Captures', icon: 'link', isShown: true },
    ],
  },
] as const;

const meta = {
  title: 'Modules/CustomiseSidebar',
  component: CustomiseSidebar,
  args: {
    isOpen: true,
    onOpenChange: fn(),
    onShownChange: fn(),
    onReset: fn(() => Promise.resolve()),
    sections: SECTIONS,
  },
} satisfies Meta<typeof CustomiseSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

const dialog = () =>
  waitFor(() => {
    const found = document.querySelector<HTMLElement>('[role="dialog"]');
    if (found === null) throw new Error('No dialog.');
    return found;
  });

/** Each section's items with a switch, Deals hidden; a switch applies at once. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ args, userEvent }) => {
    const open = within(await dialog());
    await expect(open.getByRole('switch', { name: 'Show Deals in the sidebar' })).not.toBeChecked();
    await userEvent.click(open.getByRole('switch', { name: 'Show Deals in the sidebar' }));
    await expect(args.onShownChange).toHaveBeenCalledWith('records', 'deals', true);
  },
};

/** Every item of a section hidden: its switches all off, still listed so each can come back. */
export const AllHidden: Story = {
  args: {
    sections: [{ ...SECTIONS[1], items: SECTIONS[1].items.map((item) => ({ ...item, isShown: false })) }],
  },
};

/** Nothing that can be hidden (a guest with no objects): it says so. */
export const Empty: Story = {
  args: { sections: [] },
  play: async () => {
    await expect(await dialog()).toHaveTextContent('Nothing here can be hidden.');
  },
};

/** The open confirm: an alert over the dialog. */
const confirm = () =>
  waitFor(() => {
    const found = document.querySelector<HTMLElement>('[role="alertdialog"]');
    if (found === null) throw new Error('No confirm.');
    return found;
  });

/** Reset to default asks first in a confirm; Cancel changes nothing. */
export const ResetCancelled: Story = {
  parameters: { crm: { screenshot: false } },
  args: { onReset: fn(() => Promise.resolve()) },
  play: async ({ args, userEvent }) => {
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Reset to default' }));
    const asked = within(await confirm());
    await expect(asked.getByRole('heading', { name: 'Reset your sidebar?' })).toBeInTheDocument();
    await userEvent.click(asked.getByRole('button', { name: /Cancel/ }));
    await waitFor(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull());
    await expect(args.onReset).not.toHaveBeenCalled();
  },
};

/** The confirm's Reset sidebar runs the reset once, busy until it lands, then closes. */
export const ConfirmingReset: Story = {
  args: { onReset: fn(() => new Promise<void>((resolve) => setTimeout(resolve, 200))) },
  play: async ({ args, userEvent }) => {
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Reset to default' }));
    const asked = within(await confirm());
    const commit = asked.getByRole('button', { name: 'Reset sidebar' });
    await userEvent.click(commit);
    await userEvent.click(commit);
    await expect(args.onReset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.querySelector('[role="alertdialog"]')).toBeNull());
    // The pending button React Aria announced is gone with its confirm, so the
    // announcement's label points at nothing for its 7 s; clear it for axe.
    clearAnnouncer('assertive');
  },
};

/** A refused reset says why inside the confirm, which stays open for another try. */
export const ResetRefused: Story = {
  args: { onReset: fn(() => Promise.reject(new Error('Your sidebar wasn’t changed. Check your connection.'))) },
  play: async ({ userEvent }) => {
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Reset to default' }));
    const asked = within(await confirm());
    await userEvent.click(asked.getByRole('button', { name: 'Reset sidebar' }));
    await expect(await asked.findByText('Your sidebar wasn’t changed. Check your connection.')).toBeInTheDocument();
    await expect(asked.getByRole('button', { name: 'Reset sidebar' })).toBeInTheDocument();
  },
};
