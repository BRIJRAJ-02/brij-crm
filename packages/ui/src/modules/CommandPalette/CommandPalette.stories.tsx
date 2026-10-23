import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
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
    { id: 'theme:light', name: 'Use light theme', icon: 'sun', choice: 'Theme', isChecked: false },
    { id: 'theme:dark', name: 'Use dark theme', icon: 'moon', choice: 'Theme', isChecked: true },
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
}

/** The command menu: Recent, Actions and Go to with nothing typed; Records, Pages and Actions as it searches. */
function SectionsPalette({ onAction, status: first = 'ready' }: SectionsSampleProps) {
  const [isOpen, setOpen] = useState(true);
  const [query, setQuery] = useState('');
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

/**
 * With nothing typed: the recent records, the actions and the pages, under headings. The themes are a choice
 * inside Actions (a group of their own, "Theme"), the one in use checked.
 */
export const Sections: Story = {
  render: () => <SectionsPalette />,
  play: async () => {
    const found = await dialog();
    await expect(found).toHaveAccessibleName('Command menu');
    await waitFor(() => expect(found.querySelectorAll('[role="group"]')).toHaveLength(4));
    const groups = [...found.querySelectorAll('[role="group"]')];
    await expect(groups[0]).toHaveAccessibleName('Recent');
    await expect(groups[1]).toHaveAccessibleName('Actions');
    await expect(groups[2]).toHaveAccessibleName('Theme');
  },
};

/** The theme in use is announced, not only drawn: each theme is a radio item, the one in use checked (Q47). */
export const ThemeChecked: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <SectionsPalette />,
  play: async ({ userEvent }) => {
    const found = await dialog();
    await waitFor(() => expect(found.querySelectorAll('[role="menuitemradio"]')).toHaveLength(2));
    const checked = found.querySelector('[role="menuitemradio"][aria-checked="true"]');
    await expect(checked).toHaveAccessibleName('Use dark theme');
    await expect(found.querySelector('[role="menuitemradio"][aria-checked="false"]')).toHaveAccessibleName(
      'Use light theme',
    );
    await expect(checked?.closest('[role="group"]')).toHaveAccessibleName('Theme');
    // Searched down to the themes alone, they keep their checked state under the Actions heading.
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', 'Search'));
    await userEvent.keyboard('theme');
    await waitFor(() => expect(found.querySelectorAll('[role="group"]')).toHaveLength(1));
    await expect(found.querySelector('[role="group"]')).toHaveAccessibleName('Actions');
    await expect(found.querySelector('[aria-checked="true"]')).toHaveAccessibleName('Use dark theme');
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
  render: () => <SectionsPalette status="searching" />,
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

/** A palette over fixed sections, as given. */
function FixedPalette({ sections }: { readonly sections: readonly PaletteSection[] }) {
  const [isOpen, setOpen] = useState(true);
  return (
    <CommandPalette
      isOpen={isOpen}
      onOpenChange={setOpen}
      title="Command menu"
      searchLabel="Search"
      sections={sections}
      onSearch={() => undefined}
      onAction={() => undefined}
    />
  );
}

/**
 * A choice's options stay one group wherever the matching sorted them: here a
 * Create row ranked between two themes. A status row after a choice is a plain
 * row of its own, never an option.
 */
export const ChoiceKeptTogether: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <FixedPalette
      sections={[
        {
          id: 'actions',
          label: 'Actions',
          status: 'searching',
          items: [
            { id: 'theme:system', name: 'Use system theme', icon: 'monitor', choice: 'Theme', isChecked: false },
            { id: 'create:people', name: 'Create a person', icon: 'plus' },
            { id: 'theme:light', name: 'Use light theme', icon: 'sun', choice: 'Theme', isChecked: true },
          ],
        },
      ]}
    />
  ),
  play: async () => {
    const found = await dialog();
    await waitFor(() => expect(found.querySelectorAll('[role="menuitemradio"]')).toHaveLength(2));
    const groups = [...found.querySelectorAll('[role="group"]')];
    const themes = groups.find((group) => group.querySelectorAll('[role="menuitemradio"]').length > 0);
    await expect(themes?.querySelectorAll('[role="menuitemradio"]')).toHaveLength(2);
    await expect(groups.filter((group) => group.querySelector('[role="menuitemradio"]') !== null)).toHaveLength(1);
    await expect(found.querySelector('[aria-checked="true"]')).toHaveAccessibleName('Use light theme');
    const searching = found.querySelector('[data-pending]');
    await expect(searching).toHaveAttribute('role', 'menuitem');
    await expect(searching?.closest('[role="group"]')?.querySelector('[role="menuitemradio"]')).toBeNull();
  },
};

/** How long the sample's records search takes, as the app's (a pause, then the server). */
const RECORDS_AFTER_MS = 150;

/**
 * The command menu's search as the app runs it: the records come a moment
 * after each key, above the pages, and until they do Records holds only its
 * "Searching…" row, never the rows found for the text before.
 */
function SearchingPalette({
  onAction,
  answerAfterMs = RECORDS_AFTER_MS,
}: {
  readonly onAction?: (item: PaletteItem) => void;
  /** How long each records search takes here. */
  readonly answerAfterMs?: number;
}) {
  const [isOpen, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [answered, setAnswered] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnswered(query);
    }, answerAfterMs);
    return () => {
      clearTimeout(timer);
    };
  }, [query, answerAfterMs]);
  const all = sectionsOf('', 'ready');
  const matches = (item: PaletteItem) => item.name.toLowerCase().includes(query.toLowerCase());
  const records = [...(all[0]?.items ?? []), { id: 'record:contoso', name: 'Contoso', kind: 'Company' }];
  const isIn = answered === query;
  const sections: readonly PaletteSection[] =
    query === ''
      ? all
      : [
          {
            id: 'records',
            label: 'Records',
            items: isIn ? records.filter(matches) : [],
            ...(isIn ? {} : { status: 'searching' as const }),
          },
          { id: 'pages', label: 'Pages', items: (all[2]?.items ?? []).filter(matches) },
          { id: 'actions', label: 'Actions', items: (all[1]?.items ?? []).filter(matches) },
        ];
  return (
    <CommandPalette
      isOpen={isOpen}
      onOpenChange={setOpen}
      title="Command menu"
      searchLabel="Search"
      sections={sections}
      onSearch={setQuery}
      onAction={(item) => onAction?.(item)}
    />
  );
}

const highlighted = () => document.querySelector('[role="dialog"] [data-focused][data-key]');

/**
 * As the text changes, the highlight goes to the first row of what matches it
 * now: no row found for the text before keeps it, and Enter never runs one.
 * Enter runs the row highlighted, even when records came in above it within
 * the half second before React Aria names that row to the field.
 */
export const HighlightFollowsTheText: Story = {
  args: { onAction: fn() },
  parameters: { crm: { screenshot: false } },
  render: (args) => <SearchingPalette onAction={args.onAction} />,
  play: async ({ args, userEvent }) => {
    const found = await dialog();
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', 'Search'));
    await userEvent.keyboard('north');
    await waitFor(() => expect(found).toHaveTextContent('Northwind Traders'));
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(highlighted()).toHaveTextContent('Northwind Traders'));

    // New text: while its records are searched, the row found for "north" is gone, and Enter runs no row from
    // before. It waits for this text's answer, which has no rows, so nothing runs.
    await userEvent.keyboard('x');
    await expect(found).not.toHaveTextContent('Northwind Traders');
    await userEvent.keyboard('{Enter}');
    await expect(args.onAction).not.toHaveBeenCalled();
    await waitFor(() => expect(found).toHaveTextContent('Nothing matches “northx”'));
    await expect(args.onAction).not.toHaveBeenCalled();

    // Other text: the first row that matches it now takes the highlight while the records are searched.
    await userEvent.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}th');
    await waitFor(() => expect(highlighted()).toHaveTextContent('Use light theme'));
    // Northwind Traders comes in above it; Enter still runs the row highlighted.
    await waitFor(() => expect(found).toHaveTextContent('Northwind Traders'));
    await expect(highlighted()).toHaveTextContent('Use light theme');
    await userEvent.keyboard('{Enter}');
    await expect(args.onAction).toHaveBeenCalledTimes(1);
    await expect(args.onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'theme:light' }));
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  },
};

/** Enter pressed before the records come in chooses the first row once they do, for the same text (AC-1097). */
export const EnterBeforeTheRecords: Story = {
  args: { onAction: fn() },
  parameters: { crm: { screenshot: false } },
  render: (args) => <SearchingPalette onAction={args.onAction} answerAfterMs={600} />,
  play: async ({ args, userEvent }) => {
    const found = await dialog();
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', 'Search'));
    await userEvent.keyboard('ada{Enter}');
    await expect(found).toHaveTextContent('Searching…');
    await waitFor(() => expect(args.onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'record:ada' })));
    await expect(args.onAction).toHaveBeenCalledTimes(1);
  },
};
