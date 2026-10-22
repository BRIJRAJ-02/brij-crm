import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { HUES } from '../../hue.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { StatusDot } from './StatusDot.tsx';

const meta = {
  title: 'Atoms/StatusDot',
  component: StatusDot,
  args: { children: 'Active', hue: 'green' },
} satisfies Meta<typeof StatusDot>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One status. */
export const Default: Story = {};

/** A dot for each hue, each with its label. */
export const Hues: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      {HUES.map((hue) => (
        <StatusDot key={hue} hue={hue}>
          {hue.charAt(0).toUpperCase() + hue.slice(1)}
        </StatusDot>
      ))}
    </Stage>
  ),
};

/** An archived status on an old value. */
export const Archived: Story = {
  args: { children: 'Paused', hue: 'orange', isArchived: true },
};

/**
 * `shortLabel`: in a wide bar the dot and its label; in a narrow one (a phone) the dot and the short word, the full
 * label still read by screen readers.
 */
export const ShortLabel: Story = {
  args: { children: 'Published · Unpublished changes', hue: 'orange', shortLabel: 'Changed' },
  render: (args) => (
    <Stage direction="column">
      <span data-testid="wide">
        <StatusDot {...args} />
      </span>
      <Stage width="phone">
        <span data-testid="narrow">
          <StatusDot {...args} />
        </span>
      </Stage>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const wide = canvas.getByTestId('wide');
    const narrow = canvas.getByTestId('narrow');
    const shown = (root: HTMLElement, width: string) => root.querySelector(`[data-width="${width}"]`);
    await expect(shown(wide, 'wide')).toBeVisible();
    await expect(shown(wide, 'narrow')).not.toBeVisible();
    await expect(shown(narrow, 'wide')).not.toBeVisible();
    await expect(shown(narrow, 'narrow')).toBeVisible();
    await expect(shown(narrow, 'narrow')).toHaveTextContent('Changed');
    // The full label stays in the accessibility tree at both widths: one copy, never aria-hidden.
    for (const root of [wide, narrow]) {
      const readable = Array.from(root.querySelectorAll('*')).filter(
        (element) =>
          element.textContent === 'Published · Unpublished changes' && element.closest('[aria-hidden="true"]') === null,
      );
      await expect(readable).toHaveLength(1);
    }
  },
};

/** Archived with a short label: on a phone a gray dot and the short word, "(archived)" read by screen readers. */
export const ArchivedShortLabel: Story = {
  args: { children: 'Paused', hue: 'orange', isArchived: true, shortLabel: 'Paused' },
};
