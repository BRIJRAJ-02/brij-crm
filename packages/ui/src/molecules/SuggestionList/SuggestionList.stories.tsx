import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef } from 'react';
import { expect, fn, within } from 'storybook/test';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SuggestionList, type SuggestionRow } from './SuggestionList.tsx';

const ROWS: readonly SuggestionRow[] = [
  {
    key: 'ada',
    leading: <Avatar name="Ada Lovelace" id="ada" size="xs" isDecorative />,
    label: 'Ada Lovelace',
    detail: 'ada@example.com',
  },
  {
    key: 'grace',
    leading: <Avatar name="Grace Hopper" id="grace" size="xs" isDecorative />,
    label: 'Grace Hopper',
    detail: 'grace@example.com',
  },
];

/** The list under an anchor, as a field opens it. */
function Sample({ rows }: { readonly rows: readonly SuggestionRow[] }) {
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <Stage>
      <span ref={anchor}>@</span>
      <SuggestionList
        anchorRef={anchor}
        id="members"
        label="Members"
        rows={rows}
        activeIndex={0}
        emptyText="No one matches"
        onPick={fn()}
        onHighlight={fn()}
      />
    </Stage>
  );
}

const meta = {
  title: 'Molecules/SuggestionList',
  component: Sample,
  args: { rows: ROWS },
  parameters: { crm: { screenshot: false } },
} satisfies Meta<typeof Sample>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Members, the first highlighted. */
export const Members: Story = {
  play: async () => {
    const page = within(document.body);
    await expect(await page.findByRole('listbox', { name: 'Members' })).toBeInTheDocument();
    await expect(page.getByRole('option', { name: /Ada Lovelace/ })).toHaveAttribute('aria-selected', 'true');
  },
};

/** Nobody matches: a status line, not an empty listbox. */
export const Empty: Story = {
  args: { rows: [] },
  play: async () => {
    const page = within(document.body);
    await expect(await page.findByText('No one matches')).toBeInTheDocument();
    await expect(page.queryByRole('listbox')).toBeNull();
  },
};
