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
