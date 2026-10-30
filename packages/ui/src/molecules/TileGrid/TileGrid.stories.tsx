import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { probeAlignment } from '../../lib/alignment-probe.ts';
import { settleAnimations } from '../../workbench/animations.ts';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Card } from '../Card/Card.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { TileGrid, type CardTileGridProps, type ChoiceTile } from './TileGrid.tsx';

const meta = {
  title: 'Molecules/TileGrid',
  component: TileGrid,
  args: { children: null },
} satisfies Meta<CardTileGridProps>;

export default meta;
type Story = StoryObj<CardTileGridProps>;

/** Three cards of different heights: as many columns as fit, each card as tall as its content. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage width="fill">
      <TileGrid>
        <Card title="Today" actions={<Button variant="ghost">All bookings</Button>}>
          <p>Three meetings</p>
        </Card>
        <Card title="Tasks due">
          <p>Call Ada back</p>
          <p>Send the proposal</p>
          <p>Book the venue</p>
        </Card>
        <Card title="Team today">
          <p>Ada Lovelace</p>
        </Card>
      </TileGrid>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('heading')).toHaveLength(3);
  },
};

/** On a phone: one column at the grid's full width, nothing past the edge. */
export const Phone: Story = {
  render: () => (
    <Stage width="phone">
      <TileGrid>
        <Card title="Today">
          <p>Three meetings</p>
        </Card>
        <Card title="Tasks due">
          <p>Call Ada back</p>
        </Card>
      </TileGrid>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const [first, second] = [...canvasElement.querySelectorAll('section')];
    // Stacked: the second card starts below the first, at the same left edge.
    await expect(second?.getBoundingClientRect().top).toBeGreaterThan(first?.getBoundingClientRect().bottom ?? 0);
    await expect(second?.getBoundingClientRect().left).toBe(first?.getBoundingClientRect().left);
  },
};

/** Loading and failed tiles: the cards carry the states, the grid only lays them out. */
export const States: Story = {
  render: () => (
    <Stage width="fill">
      <TileGrid>
        <Card title="Today" isBusy>
          <Skeleton shape="block" />
        </Card>
        <Card title="Tasks due">
          <EmptyState tone="error" title="Tasks didn’t load" onRetry={() => undefined}>
            Check your connection and try again.
          </EmptyState>
        </Card>
      </TileGrid>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  },
};

/** A tile that renders nothing takes no cell: the two left share the row. */
export const SomeEmpty: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="fill">
      <TileGrid>
        <Card title="Today">
          <p>Three meetings</p>
        </Card>
        {null}
        <Card title="Team today">
          <p>Ada Lovelace</p>
        </Card>
      </TileGrid>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const [first, second] = [...canvasElement.querySelectorAll('section')];
    // Side by side on one row: no hole where the empty tile would be.
    await expect(second?.getBoundingClientRect().top).toBe(first?.getBoundingClientRect().top);
  },
};

/** Fill (SettingsGrid): empty tracks stay, so one card keeps a track's width rather than the whole row. */
export const Fill: Story = {
  render: () => (
    <Stage width="fill">
      <TileGrid fill="fill">
        <Card title="Google Calendar">
          <p>ada@example.com</p>
        </Card>
      </TileGrid>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector('section');
    const grid = card?.parentElement;
    await expect(card?.getBoundingClientRect().width).toBeLessThan(grid?.getBoundingClientRect().width ?? 0);
  },
};

/** At most two columns (Home): three cards make two side by side and one below, never three across. */
export const TwoColumns: Story = {
  render: () => (
    <Stage width="fill">
      <TileGrid columns="two">
        <Card title="Today">
          <p>Three meetings</p>
        </Card>
        <Card title="My tasks">
          <p>Call Ada back</p>
        </Card>
        <Card title="Recently viewed">
          <p>Northwind Traders</p>
        </Card>
      </TileGrid>
    </Stage>
  ),
  play: async ({ canvas }) => {
    // However wide the frame, the third card never shares the first one's row.
    const [first, , third] = canvas.getAllByRole('heading').map((heading) => heading.getBoundingClientRect().top);
    await expect((third ?? 0) > (first ?? 0)).toBe(true);
  },
};

/** Two columns on a phone: one column, each card at the grid's full width. */
export const TwoColumnsPhone: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="phone">
      <TileGrid columns="two">
        <Card title="Today">
          <p>Three meetings</p>
        </Card>
        <Card title="My tasks">
          <p>Call Ada back</p>
        </Card>
      </TileGrid>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const [first, second] = canvas.getAllByRole('heading').map((heading) => heading.getBoundingClientRect());
    await expect((second?.top ?? 0) > (first?.bottom ?? 0)).toBe(true);
  },
};

const KINDS: readonly ChoiceTile[] = [
  { id: 'link', name: 'Link', icon: 'link', description: 'A button that opens a web address.' },
  { id: 'text', name: 'Text', icon: 'file-text', description: 'A short note or heading.' },
  { id: 'image', name: 'Image', icon: 'image', description: 'A picture, with an optional link.' },
  { id: 'video', name: 'Video', icon: 'video', description: 'A video from a web address.' },
  { id: 'social', name: 'Social', icon: 'at-sign', description: 'Your accounts, as small round buttons.' },
  { id: 'booking', name: 'Booking', icon: 'calendar', description: 'Lets people book a time with you.' },
];

function Looks({ id }: { readonly id: string }) {
  return (
    <svg viewBox="0 0 80 60" role="presentation" data-look={id}>
      <rect width="80" height="60" fill="var(--surface-subtle)" />
      <rect x="12" y="14" width="56" height="8" rx="4" fill="var(--accent)" />
      <rect x="12" y="28" width="56" height="8" rx="4" fill="var(--border)" />
      <rect x="12" y="42" width="40" height="8" rx="4" fill="var(--border)" />
    </svg>
  );
}

function Picker({ onChange }: { readonly onChange?: (id: string) => void }) {
  const [value, setValue] = useState<string | null>('fair');
  const looks: readonly ChoiceTile[] = [
    { id: 'fair', name: 'Fair', thumbnail: <Looks id="fair" />, description: 'Everyone gets a turn in order.' },
    { id: 'first', name: 'First free', thumbnail: <Looks id="first" /> },
    { id: 'least', name: 'Least busy', thumbnail: <Looks id="least" /> },
  ];
  return (
    <Stage width="fill">
      <TileGrid
        variant="choice"
        label="Look"
        tiles={looks}
        value={value}
        onChange={(id) => {
          setValue(id);
          onChange?.(id);
        }}
      />
    </Stage>
  );
}

/** First run's Done: two tiles that ease in, one a moment after the other (spec 0058, AC-21). */
export const Entering: Story = {
  args: { fill: 'fill', isEntering: true },
  render: (args) => (
    <Stage width="fill">
      <TileGrid {...args}>
        <Card title="Booking link">
          <Skeleton lines={2} isStill />
        </Card>
        <Card title="Link page">
          <Skeleton lines={2} isStill />
        </Card>
      </TileGrid>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await settleAnimations();
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Booking link')).toBeVisible();
    await expect(canvas.getByText('Link page')).toBeVisible();
  },
};

/** Choose by sight: marks over short names, one tile chosen with a ring and a tick. Every tile is one size. */
export const Choice: Story = {
  parameters: { crm: { preview: true } },
  render: () => <Picker />,
  play: async ({ canvas }) => {
    const radios = canvas.getAllByRole('radio');
    await expect(radios).toHaveLength(3);
    await expect(radios[0]).toBeChecked();
    const report = probeAlignment({ root: 'body' });
    await expect(report.failures.filter((failure) => failure.check === 'tile-size')).toEqual([]);
    await expect(report.checked['tile-size']).toBe(3);
  },
};

/** The keyboard: Tab lands on the chosen tile, arrows move and pick, and only one tile is a tab stop. */
export const ChoiceKeyboard: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <Picker onChange={fn()} />,
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole('radio', { name: /Fair/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('radio', { name: /First free/ })).toBeChecked();
    await userEvent.tab();
    await expect(canvas.getByRole('radio', { name: /First free/ })).not.toHaveFocus();
  },
};

/** Action mode: each tile starts something at once (Add block). A description reaches screen readers and a tooltip. */
export const ChoiceAction: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="fill">
      <TileGrid variant="choice" mode="action" label="Block kind" tiles={KINDS} onAction={fn()} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const group = canvas.getByRole('group', { name: 'Block kind' });
    const tiles = within(group).getAllByRole('button');
    await expect(tiles).toHaveLength(KINDS.length);
    await expect(canvas.getByRole('button', { name: /Link/ })).toHaveAccessibleDescription(
      'A button that opens a web address.',
    );
    await settleAnimations();
    const first = tiles[0]?.getBoundingClientRect();
    for (const tile of tiles) {
      await expect(Math.round(tile.getBoundingClientRect().width)).toBe(Math.round(first?.width ?? 0));
      await expect(Math.round(tile.getBoundingClientRect().height)).toBe(Math.round(first?.height ?? 0));
    }
  },
};

/**
 * Tiles with and without a description fill their tracks alike (a description's tooltip wraps the tile, and the
 * tile still fills the cell), and a disabled tile shows its reason on the tile, where a keyboard user reads it too.
 */
export const ChoiceDisabled: Story = {
  render: () => (
    <Stage width="fill">
      <TileGrid
        variant="choice"
        mode="action"
        label="Add block"
        onAction={fn()}
        tiles={[
          { id: 'link', name: 'Link', icon: 'link', description: 'A button that opens a web address.' },
          { id: 'text', name: 'Text', icon: 'file-text' },
          {
            id: 'booking',
            name: 'Booking page',
            icon: 'calendar',
            description: 'Lets people book a time with you.',
            isDisabled: true,
            disabledReason: 'At the limit',
          },
          { id: 'image', name: 'Image', icon: 'image' },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await settleAnimations();
    const report = probeAlignment({ root: 'body' });
    await expect(report.failures.filter((failure) => failure.check === 'tile-size')).toEqual([]);
    await expect(report.checked['tile-size']).toBe(4);
    await expect(canvas.getByText('At the limit')).toBeVisible();
    const booking = canvas.getByRole('button', { name: /Booking page/ });
    await expect(booking).toBeDisabled();
    await expect(booking).toHaveAccessibleDescription(/At the limit/);
  },
};

/** Select mode: a disabled choice says why on the tile and in its description. */
export const ChoiceDisabledSelect: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => (
    <Stage width="fill">
      <TileGrid
        variant="choice"
        label="Look"
        defaultValue="fair"
        tiles={[
          { id: 'fair', name: 'Fair', icon: 'users', description: 'Everyone gets a turn in order.' },
          { id: 'first', name: 'First free', icon: 'clock', isDisabled: true, disabledReason: 'Needs two hosts' },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Needs two hosts')).toBeVisible();
    await expect(canvas.getByRole('radio', { name: /First free/ })).toBeDisabled();
    await expect(canvas.getByRole('radio', { name: /First free/ })).toHaveAccessibleDescription('Needs two hosts');
    const report = probeAlignment({ root: 'body' });
    await expect(report.failures.filter((failure) => failure.check === 'tile-size')).toEqual([]);
  },
};
