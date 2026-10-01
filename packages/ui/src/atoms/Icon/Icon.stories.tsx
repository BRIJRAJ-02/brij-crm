import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { HUES } from '../../hue.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Icon } from './Icon.tsx';
import { icons, type IconName } from './icons.ts';

const meta = {
  title: 'Atoms/Icon',
  component: Icon,
  args: { name: 'building' },
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A decorative 16px icon: hidden from screen readers, colour from its parent. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const svg = canvasElement.querySelector('svg');
    await expect(svg).toHaveAttribute('aria-hidden', 'true');
    await expect(svg).toHaveAttribute('focusable', 'false');
    await expect(svg).not.toHaveAttribute('role');
    await expect(svg).toHaveAttribute('data-size', 'md');
  },
};

/** Every icon in the registry, at the default size. */
export const Registry: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      {(Object.keys(icons) as IconName[]).map((name) => (
        <Icon key={name} name={name} />
      ))}
    </Stage>
  ),
};

/** `md` (16) for nav, menus and rows; `sm` (14) in buttons and chips; `xs` (12) in card footers. */
export const Sizes: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <Icon name="calendar" size="md" />
      <Icon name="calendar" size="sm" />
      <Icon name="calendar" size="xs" />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const sizes = [...canvasElement.querySelectorAll('svg')].map((svg) => svg.getAttribute('data-size'));
    await expect(sizes).toEqual(['md', 'sm', 'xs']);
  },
};

/** `inherit` (the default), `muted` for attribute and column header icons, `ai` for the sparkle only. */
export const Tones: Story = {
  render: () => (
    <Stage>
      <Icon name="tag" />
      <Icon name="tag" tone="muted" />
      <Icon name="sparkles" tone="ai" />
    </Stage>
  ),
};

/** An object's icon on its hue tile, as the sidebar and top bar show it. */
export const Tiles: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      {HUES.map((hue) => (
        <Icon key={hue} name="building" tile={hue} />
      ))}
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const tiles = [...canvasElement.querySelectorAll('[data-hue]')];
    await expect(tiles.map((tile) => tile.getAttribute('data-hue'))).toEqual([...HUES]);
    for (const tile of tiles) {
      await expect(tile).toHaveAttribute('aria-hidden', 'true');
      await expect(tile.querySelector('svg')).toHaveAttribute('data-size', 'sm');
    }
  },
};

/** With a label, as the only content of a control, it reads as an image with that name. */
export const Labelled: Story = {
  args: { name: 'circle-question-mark', label: 'Help' },
  play: async ({ canvas }) => {
    const image = canvas.getByRole('img', { name: 'Help' });
    await expect(image).not.toHaveAttribute('aria-hidden');
  },
};
