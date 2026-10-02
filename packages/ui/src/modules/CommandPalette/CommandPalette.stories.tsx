import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { arraySource } from '../../lib/list-source.ts';
import { CommandPalette, type PaletteItem } from './CommandPalette.tsx';

const ITEMS: readonly PaletteItem[] = [
  { id: 'new-company', name: 'Create a company', kind: 'Action', icon: 'plus', kbd: '⌘N' },
  { id: 'northwind', name: 'Northwind Traders', description: 'northwind.com', kind: 'Company', icon: 'building' },
  { id: 'globex', name: 'Globex', description: 'globex.com', kind: 'Company', icon: 'building' },
  { id: 'ada', name: 'Ada Lovelace', description: 'ada@northwind.com', kind: 'Person', icon: 'user' },
];

interface SampleProps {
  readonly onAction?: (item: PaletteItem) => void;
  /** Every row still loading. */
  readonly isLoadingRows?: boolean;
  readonly searchStatus?: 'ready' | 'searching' | 'failed';
}

/** The palette searching its own rows, as the app searches records and actions. */
function SamplePalette({ onAction, isLoadingRows = false, searchStatus = 'ready' }: SampleProps) {
  const [isOpen, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  const matching = ITEMS.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <CommandPalette
      isOpen={isOpen}
      onOpenChange={setOpen}
      items={
        isLoadingRows
          ? { count: 5, getItem: () => undefined, getKey: (item) => item.id }
          : arraySource(searchStatus === 'ready' ? matching : [], (item) => item.id)
      }
      searchStatus={searchStatus}
      onSearch={setQuery}
      onAction={(item) => onAction?.(item)}
    />
  );
}

const meta = {
  title: 'Modules/CommandPalette',
  component: SamplePalette,
} satisfies Meta<typeof SamplePalette>;

export default meta;
type Story = StoryObj<typeof meta>;

const dialog = () =>
  waitFor(() => {
    const found = document.querySelector('[role="dialog"]');
    if (found === null) throw new globalThis.Error('No dialog.');
    return found;
  });

/** Open at once, the search field focused: rows show their name, identifier and kind. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async () => {
    await expect(await dialog()).toHaveAccessibleName('Quick actions');
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', 'Search records and actions'));
  },
};

/** Typing narrows the rows; the arrows move; Enter chooses, and the palette closes. */
export const SearchAndChoose: Story = {
  args: { onAction: fn() },
  parameters: { crm: { screenshot: false } },
  play: async ({ args, userEvent }) => {
    await dialog();
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', 'Search records and actions'));
    await userEvent.keyboard('glob');
    await waitFor(() => expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(1));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'globex' }));
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  },
};

/** Nothing matches: the list says so. */
export const NoResults: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ userEvent }) => {
    await dialog();
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', 'Search records and actions'));
    await userEvent.keyboard('zzz');
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toHaveTextContent('Nothing matches'));
  },
};

/** Rows still loading draw as skeletons. */
export const LoadingRows: Story = {
  args: { isLoadingRows: true },
  play: async () => {
    const found = await dialog();
    await waitFor(() => expect(found.querySelectorAll('[role="menuitem"]')).toHaveLength(5));
  },
};

/** A search under way says so, rather than "Nothing matches". */
export const Searching: Story = {
  args: { searchStatus: 'searching' },
  parameters: { crm: { screenshot: false } },
  play: async () => {
    const found = await dialog();
    await waitFor(() => expect(found).toHaveTextContent('Searching…'));
  },
};

/** A search that failed says so. */
export const SearchFailed: Story = {
  args: { searchStatus: 'failed' },
  play: async () => {
    const found = await dialog();
    await waitFor(() => expect(found).toHaveTextContent('The search didn’t finish. Try again.'));
  },
};
