import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Skeleton } from './Skeleton.tsx';

const meta = {
  title: 'Atoms/Skeleton',
  component: Skeleton,
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One line of text loading. */
export const Default: Story = {
  render: (args) => (
    <Stage width="narrow">
      <Skeleton {...args} />
    </Stage>
  ),
};

/** Lines under centred text (an EmptyState's title and text): the shorter last line sits in the middle. */
export const LinesCentred: Story = {
  render: () => (
    <Stage width="narrow">
      <Skeleton lines={2} align="center" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const [first, last] = [...canvasElement.querySelectorAll('[data-shape="line"]')].map((line) =>
      line.getBoundingClientRect(),
    );
    if (first === undefined || last === undefined) throw new Error('two lines expected');
    await expect(Math.abs(last.left + last.width / 2 - (first.left + first.width / 2))).toBeLessThan(1);
  },
};

/** A row the way a list loads: an avatar, an icon tile, a name and a few lines. */
export const Shapes: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage direction="column" width="narrow">
      <Skeleton shape="circle" />
      <Skeleton shape="tile" />
      <Skeleton width="medium" />
      <Skeleton lines={3} />
      <Skeleton shape="block" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    for (const skeleton of canvasElement.querySelectorAll('[data-shape]')) {
      await expect(skeleton.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  },
};

/** Still: a sketch of content (first run's workspace preview), drawn without the pulse so it never reads as loading. */
export const Still: Story = {
  render: () => (
    <Stage direction="column" width="narrow">
      <Skeleton shape="tile" isStill />
      <Skeleton width="medium" isStill />
      <Skeleton lines={2} isStill />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    for (const skeleton of canvasElement.querySelectorAll('[data-shape]')) {
      await expect(skeleton.getAnimations()).toHaveLength(0);
    }
  },
};

/** Text rows: each holds its own line box, so a loading heading is exactly as tall as the heading. */
export const TextShape: Story = {
  render: () => (
    <Stage direction="column" width="narrow">
      <h2>
        <Skeleton shape="text" width="medium" />
      </h2>
      <p>
        <Skeleton shape="text" lines={2} />
      </p>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const heading = canvasElement.querySelector('h2');
    const row = heading?.querySelector('[data-shape="text"]');
    if (heading === null || row === null || row === undefined) throw new Error('a heading with a text row expected');
    const line = Number.parseFloat(globalThis.getComputedStyle(heading).lineHeight);
    await expect(Math.abs(row.getBoundingClientRect().height - line)).toBeLessThan(1);
  },
};

/** The avatar scale: a loading face is the size the face will be. */
export const CircleSizes: Story = {
  render: () => (
    <Stage width="narrow">
      <Skeleton shape="circle" size="sm" />
      <Skeleton shape="circle" size="lg" />
      <Skeleton shape="circle" size="xl" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const sizes = [...canvasElement.querySelectorAll('[data-shape="circle"]')].map(
      (circle) => circle.getBoundingClientRect().width,
    );
    await expect(sizes).toHaveLength(3);
    await expect(sizes[0]).toBeLessThan(sizes[1] ?? 0);
    await expect(sizes[1]).toBeLessThan(sizes[2] ?? 0);
  },
};

/** Fill: a placeholder that takes the whole slot a layout already sized. */
export const FillShape: Story = {
  render: () => (
    <Stage width="narrow">
      <Skeleton shape="fill" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const fill = canvasElement.querySelector('[data-shape="fill"]');
    await expect(fill?.getBoundingClientRect().width).toBeGreaterThan(0);
  },
};

/** A field's box, for a settings row while its page loads: as tall as a field, a menu wide, or across its slot. */
export const FieldShape: Story = {
  render: () => (
    <Stage direction="column" width="narrow">
      <Skeleton shape="field" />
      <Skeleton shape="field" width="full" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const [menuWide, full] = [...canvasElement.querySelectorAll('[data-shape="field"]')].map(
      (field) => field.getBoundingClientRect().width,
    );
    await expect(menuWide).toBeGreaterThan(0);
    await expect(full).toBeGreaterThanOrEqual(menuWide ?? 0);
  },
};
