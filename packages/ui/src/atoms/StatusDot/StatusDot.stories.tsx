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
 * `isLabelCollapsible`: in a wide bar the dot and its words; in a narrow one (a phone) the dot alone, its words still
 * read by screen readers.
 */
export const LabelCollapsible: Story = {
  args: { children: 'Draft', hue: 'gray', isLabelCollapsible: true },
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
    const shown = (root: HTMLElement) => root.querySelector('[data-collapsible]');
    await expect(shown(wide)).toBeVisible();
    await expect(shown(narrow)).not.toBeVisible();
    // The name stays in the accessibility tree at both widths: one hidden copy, never aria-hidden.
    for (const root of [wide, narrow]) {
      const copies = Array.from(root.querySelectorAll('*')).filter(
        (element) => element.textContent === 'Draft' && element.closest('[aria-hidden="true"]') === null,
      );
      await expect(copies).toHaveLength(1);
    }
    await expect(narrow).toHaveTextContent('Draft');
  },
};
