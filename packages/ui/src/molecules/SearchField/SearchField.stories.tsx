import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SearchField } from './SearchField.tsx';

const meta = {
  title: 'Molecules/SearchField',
  component: SearchField,
  args: { label: 'Search people', onSearch: fn(), onClear: fn() },
} satisfies Meta<typeof SearchField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Empty, with its placeholder: the label, unless `placeholder` says otherwise. */
export const Empty: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="narrow-fill">
      <SearchField {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const field = canvas.getByRole('searchbox', { name: 'Search people' });
    await expect(field).toHaveAttribute('placeholder', 'Search people');
    await expect(canvas.queryByRole('button', { name: 'Clear search' })).toBeNull();
  },
};

/** Typing searches once typing pauses: ten keys send one query, Enter sends at once, and never the same one twice. */
export const Debounced: Story = {
  args: { onSearch: fn(), onSubmit: fn() },
  render: (args) => (
    <Stage width="narrow-fill">
      <SearchField {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const field = canvas.getByRole('searchbox', { name: 'Search people' });
    await userEvent.click(field);
    await userEvent.keyboard('northwind!');
    await waitFor(() => expect(args.onSearch).toHaveBeenCalledTimes(1));
    await expect(args.onSearch).toHaveBeenLastCalledWith('northwind!');
    await userEvent.keyboard('{Enter}');
    await expect(args.onSubmit).toHaveBeenCalledWith('northwind!');
    // Enter's query was already sent, so it isn't sent again.
    await expect(args.onSearch).toHaveBeenCalledTimes(1);
  },
};

/** With text: the clear button empties it and keeps focus in the field; Esc does the same. */
export const Clearing: Story = {
  args: { defaultValue: 'Acme', onSearch: fn(), onClear: fn() },
  render: (args) => (
    <Stage width="narrow-fill">
      <SearchField {...args} />
    </Stage>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const field = canvas.getByRole('searchbox', { name: 'Search people' });
    await userEvent.click(canvas.getByRole('button', { name: 'Clear search' }));
    await expect(field).toHaveValue('');
    await expect(field).toHaveFocus();
    await expect(args.onClear).toHaveBeenCalledTimes(1);
    await expect(args.onSearch).toHaveBeenLastCalledWith('');
    await userEvent.keyboard('Globex');
    await userEvent.keyboard('{Escape}');
    await expect(field).toHaveValue('');
    await expect(field).toHaveFocus();
    await expect(args.onClear).toHaveBeenCalledTimes(2);
  },
};

/** A shortcut: its keycap shows while the field is empty and unfocused; pressing it focuses the field. */
export const Shortcut: Story = {
  args: { label: 'Search', shortcut: '/' },
  render: (args) => (
    <Stage width="narrow-fill">
      <SearchField {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const field = canvas.getByRole('searchbox', { name: 'Search' });
    await expect(canvas.getByText('/')).toBeInTheDocument();
    await userEvent.keyboard('/');
    await expect(field).toHaveFocus();
    await expect(canvas.queryByText('/')).toBeNull();
  },
};

/** Controlled, small, in a toolbar: what is typed shows at once through `onChange`. */
export const Controlled: Story = {
  render: function Controlled(args) {
    const [query, setQuery] = useState('');
    return (
      <Stage width="narrow-fill">
        <SearchField {...args} size="sm" value={query} onChange={setQuery} />
        <span>{query === '' ? 'Everyone' : `Matching ${query}`}</span>
      </Stage>
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search people' }), 'Jo');
    await expect(canvas.getByText('Matching Jo')).toBeInTheDocument();
  },
};

/** Disabled: no clear button, no keycap. */
export const Disabled: Story = {
  args: { isDisabled: true, defaultValue: 'Acme', shortcut: '⌘K' },
  render: (args) => (
    <Stage width="narrow-fill">
      <SearchField {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('searchbox', { name: 'Search people' })).toBeDisabled();
    await expect(canvas.queryByRole('button', { name: 'Clear search' })).toBeNull();
  },
};
