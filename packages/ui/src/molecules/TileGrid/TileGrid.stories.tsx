import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Card } from '../Card/Card.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { TileGrid } from './TileGrid.tsx';

const meta = {
  title: 'Molecules/TileGrid',
  component: TileGrid,
  args: { children: null },
} satisfies Meta<typeof TileGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

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
        <Card title="Needs attention">
          <p>Northwind renewal</p>
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
