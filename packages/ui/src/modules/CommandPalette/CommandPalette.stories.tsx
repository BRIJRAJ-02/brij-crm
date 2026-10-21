import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { arraySource } from '../../lib/list-source.ts';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { CommandPalette, type PaletteItem, type PaletteSection } from './CommandPalette.tsx';

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

/** The command menu's sections (spec 0039), built in a function so the preview carries no list at module level. */
function sectionsOf(query: string, status: 'ready' | 'searching' | 'failed'): readonly PaletteSection[] {
  const matches = (item: PaletteItem) => item.name.toLowerCase().includes(query.toLowerCase());
  const records: readonly PaletteItem[] = [
    {
      id: 'record:northwind',
      name: 'Northwind Traders',
      description: 'northwind.com',
      kind: 'Company',
      leading: <Avatar name="Northwind Traders" shape="square" size="xs" isDecorative />,
    },
    {
      id: 'record:ada',
      name: 'Ada Lovelace',
      description: 'ada@northwind.com',
      kind: 'Person',
      leading: <Avatar name="Ada Lovelace" size="xs" isDecorative />,
    },
  ];
  const actions: readonly PaletteItem[] = [
    { id: 'create:companies', name: 'Create a company', icon: 'plus' },
    { id: 'theme:light', name: 'Use light theme', icon: 'sun' },
    { id: 'theme:dark', name: 'Use dark theme', icon: 'moon', isChecked: true },
  ];
  const pages: readonly PaletteItem[] = [
    { id: 'page:companies', name: 'Companies', icon: 'building' },
    { id: 'page:settings', name: 'Settings', icon: 'settings', kbd: '⌘,' },
  ];
  if (query === '') {
    return [
      { id: 'recent', label: 'Recent', items: records },
      { id: 'actions', label: 'Actions', items: actions },
      { id: 'pages', label: 'Go to', items: pages },
    ];
  }
  return [
    {
      id: 'records',
      label: 'Records',
      items: status === 'ready' ? records.filter(matches) : [],
      ...(status === 'ready' ? {} : { status }),
    },
    { id: 'pages', label: 'Pages', items: pages.filter(matches) },
    { id: 'actions', label: 'Actions', items: actions.filter(matches) },
  ];
}

interface SectionsSampleProps {
  readonly onAction?: (item: PaletteItem) => void;
  readonly status?: 'ready' | 'searching' | 'failed';
  /** What is typed at first, so the story starts on a search. */
  readonly startWith?: string;
}

/** The command menu: Recent, Actions and Go to with nothing typed; Records, Pages and Actions as it searches. */
function SectionsPalette({ onAction, status: first = 'ready', startWith = '' }: SectionsSampleProps) {
  const [isOpen, setOpen] = useState(true);
  const [query, setQuery] = useState(startWith);
  // Try again asks again: the sample's search goes back to searching.
  const [status, setStatus] = useState(first);
  return (
    <CommandPalette
      isOpen={isOpen}
      onOpenChange={setOpen}
      title="Command menu"
      searchLabel="Search"
      placeholder="Type a command or search…"
      sections={sectionsOf(query, status)}
      onSearch={setQuery}
      onAction={(item) => onAction?.(item)}
      onRetry={() => {
        setStatus('searching');
      }}
    />
  );
}

/** With nothing typed: the recent records, the actions (the current theme checked) and the pages, under headings. */
export const Sections: Story = {
  render: () => <SectionsPalette />,
  play: async () => {
    const found = await dialog();
    await expect(found).toHaveAccessibleName('Command menu');
    await waitFor(() => expect(found.querySelectorAll('[role="group"]')).toHaveLength(3));
    await expect(found.querySelector('[role="group"]')).toHaveAccessibleName('Recent');
  },
};

/** Typing narrows every section at once; the arrows cross sections; Enter chooses and the menu closes. */
export const SectionsSearchAndChoose: Story = {
  args: { onAction: fn() },
  parameters: { crm: { screenshot: false } },
  render: (args) => <SectionsPalette onAction={args.onAction} />,
  play: async ({ args, userEvent }) => {
    await dialog();
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', 'Search'));
    await userEvent.keyboard('north');
    await waitFor(() => expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(1));
    await waitFor(() => expect(document.querySelector('[role="status"]')).toHaveTextContent('1 result'));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect(args.onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'record:northwind' }));
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  },
};

/** The records search still out: its section says so in a row, while the pages already show. */
export const SectionSearching: Story = {
  render: () => <SectionsPalette status="searching" startWith="se" />,
  play: async ({ userEvent }) => {
    const found = await dialog();
    await userEvent.keyboard('se');
    await waitFor(() => expect(found).toHaveTextContent('Searching…'));
  },
};

/** The records search failed: its row says so in place of the records. */
export const SectionFailed: Story = {
  render: () => <SectionsPalette status="failed" />,
  play: async ({ userEvent }) => {
    const found = await dialog();
    await userEvent.keyboard('zz');
    await waitFor(() => expect(found).toHaveTextContent('The search didn’t finish. Try again.'));
  },
};

/** Choosing the failed row asks again without closing the menu. */
export const SectionFailedTryAgain: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <SectionsPalette status="failed" />,
  play: async ({ userEvent }) => {
    const found = await dialog();
    await userEvent.keyboard('zz');
    await waitFor(() => expect(found).toHaveTextContent('The search didn’t finish. Try again.'));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(found).toHaveTextContent('Searching…'));
    await expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  },
};

/** Nothing matches anywhere: the menu quotes what was typed, and the live region says there are no results. */
export const SectionsNothingMatches: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <SectionsPalette />,
  play: async ({ userEvent }) => {
    const found = await dialog();
    await userEvent.keyboard('qqq');
    await waitFor(() => expect(found).toHaveTextContent('Nothing matches “qqq”'));
    await waitFor(() => expect(document.querySelector('[role="status"]')).toHaveTextContent('No results'));
  },
};
