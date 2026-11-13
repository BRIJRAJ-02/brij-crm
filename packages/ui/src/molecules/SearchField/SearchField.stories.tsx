import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SEARCH_DEBOUNCE_MS, SearchField } from './SearchField.tsx';

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

/** Waits `ms` on the page's clock. */
function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Typing searches once typing pauses (spec 0073, AC-7322): ten keys about 50 ms apart send one query, after the
 * last; Enter sends at once, and never the same query twice.
 */
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
    for (const key of 'northwind!') {
      await userEvent.keyboard(key);
      await wait(50);
    }
    await expect(field).toHaveValue('northwind!');
    await waitFor(() => expect(args.onSearch).toHaveBeenCalledTimes(1));
    await expect(args.onSearch).toHaveBeenLastCalledWith('northwind!');
    // Well past the pause: still once.
    await wait(SEARCH_DEBOUNCE_MS * 2);
    await expect(args.onSearch).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Enter}');
    await expect(args.onSubmit).toHaveBeenCalledWith('northwind!');
    // Enter's query was already sent, so it isn't sent again.
    await expect(args.onSearch).toHaveBeenCalledTimes(1);
  },
};

/**
 * Controlled, with the screen's own Clear filters: the screen empties the field and its filter itself, and the
 * same query typed again is sent again rather than taken for a repeat.
 */
export const ControlledReset: Story = {
  parameters: { crm: { screenshot: false } },
  args: { onSearch: fn() },
  render: function ControlledReset(args) {
    const [query, setQuery] = useState('');
    return (
      <Stage width="narrow-fill">
        <SearchField {...args} value={query} onChange={setQuery} />
        <Button
          onPress={() => {
            setQuery('');
          }}
        >
          Clear filters
        </Button>
      </Stage>
    );
  },
  play: async ({ canvas, args, userEvent }) => {
    const field = canvas.getByRole('searchbox', { name: 'Search people' });
    await userEvent.type(field, 'acme');
    await waitFor(() => expect(args.onSearch).toHaveBeenCalledTimes(1));
    await expect(args.onSearch).toHaveBeenLastCalledWith('acme');
    await userEvent.click(canvas.getByRole('button', { name: 'Clear filters' }));
    await expect(field).toHaveValue('');
    await userEvent.type(field, 'acme');
    await waitFor(() => expect(args.onSearch).toHaveBeenCalledTimes(2));
    await expect(args.onSearch).toHaveBeenLastCalledWith('acme');
  },
};

/** A reset by the screen during a pause: the pause sends what the field shows now, not what it held. */
export const ResetMidPause: Story = {
  parameters: { crm: { screenshot: false } },
  args: { onSearch: fn() },
  render: function ResetMidPause(args) {
    const [query, setQuery] = useState('');
    return (
      <Stage width="narrow-fill">
        <SearchField {...args} value={query} onChange={setQuery} debounceMs={400} />
        <Button
          onPress={() => {
            setQuery('');
          }}
        >
          Clear filters
        </Button>
      </Stage>
    );
  },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search people' }), 'acm');
    await userEvent.click(canvas.getByRole('button', { name: 'Clear filters' }));
    await wait(600);
    await expect(args.onSearch).not.toHaveBeenCalled();
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

/** `⌘K` also answers Ctrl+K; with nothing typed, Esc is left to whatever holds the field. */
export const CommandShortcut: Story = {
  args: { label: 'Search everything', shortcut: '⌘K' },
  render: (args) => (
    <Stage width="narrow-fill">
      <SearchField {...args} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const field = canvas.getByRole('searchbox', { name: 'Search everything' });
    await userEvent.keyboard('{Control>}k{/Control}');
    await expect(field).toHaveFocus();
    let reachedHolder = false;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') reachedHolder = true;
    };
    canvasElement.addEventListener('keydown', onKeyDown);
    await userEvent.keyboard('{Escape}');
    canvasElement.removeEventListener('keydown', onKeyDown);
    await expect(reachedHolder).toBe(true);
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

/** Disabled: no clear button, and no keycap even while empty, since its shortcut does nothing. */
export const Disabled: Story = {
  args: { isDisabled: true, shortcut: '⌘K' },
  render: (args) => (
    <Stage width="narrow-fill" direction="column">
      <SearchField {...args} label="Search people" />
      <SearchField {...args} label="Search companies" defaultValue="Acme" />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('searchbox', { name: 'Search people' })).toBeDisabled();
    await expect(canvas.getByRole('searchbox', { name: 'Search companies' })).toBeDisabled();
    await expect(canvasElement.querySelectorAll('kbd')).toHaveLength(0);
    await expect(canvas.queryByRole('button', { name: 'Clear search' })).toBeNull();
  },
};
