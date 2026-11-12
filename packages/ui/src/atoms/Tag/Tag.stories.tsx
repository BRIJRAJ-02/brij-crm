import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { HUES } from '../../hue.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Tag, TagList, type TagItem } from './Tag.tsx';

const meta = {
  title: 'Atoms/Tag',
  component: Tag,
  args: { children: 'Enterprise', hue: 'blue' },
} satisfies Meta<typeof Tag>;

export default meta;
type Story = StoryObj<typeof meta>;

const STAGES: readonly TagItem[] = [
  { id: 'lead', label: 'Lead', hue: 'gray' },
  { id: 'qualified', label: 'Qualified', hue: 'sky' },
  { id: 'proposal', label: 'Proposal', hue: 'purple' },
  { id: 'won', label: 'Won', hue: 'green' },
  { id: 'lost', label: 'Lost', hue: 'red' },
];

/** One option in its hue. */
export const Default: Story = {};

/** All nine hues. */
export const Hues: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      {HUES.map((hue) => (
        <Tag key={hue} hue={hue}>
          {hue.charAt(0).toUpperCase() + hue.slice(1)}
        </Tag>
      ))}
    </Stage>
  ),
};

/** An archived option on an old value: gray, dashed, and "(archived)" for screen readers. */
export const Archived: Story = {
  args: { children: 'Legacy plan', isArchived: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('(archived)')).toBeInTheDocument();
  },
};

/** The `ai` tone: a fact AI found, on the surface with the violet sparkle, said as "filled by AI" (spec 0073). */
export const Ai: Story = {
  render: () => (
    <Stage>
      <Tag tone="ai">AI enriched</Tag>
      <Tag tone="ai">Series B</Tag>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const tag = canvas.getByText('Series B').parentElement;
    await expect(tag).toHaveAttribute('data-tone', 'ai');
    await expect(tag).toHaveTextContent('Series B (filled by AI)');
    // The sparkle is the only violet: the words keep the text colour, the chip the surface.
    const sparkle = tag?.querySelector('svg');
    await expect(sparkle).not.toBeNull();
    const ai = getComputedStyle(document.documentElement).getPropertyValue('--ai').trim();
    const probe = document.createElement('span');
    probe.style.color = ai;
    document.body.append(probe);
    const violet = getComputedStyle(probe).color;
    probe.remove();
    await expect(getComputedStyle(sparkle as Element).color).toBe(violet);
    await expect(getComputedStyle(tag as Element).color).not.toBe(violet);
  },
};

/** A long label is cut with an ellipsis inside a narrow slot. */
export const Long: Story = {
  render: () => (
    <Stage width="narrow">
      <Tag hue="orange">Strategic partnership renewal for the EMEA region</Tag>
    </Stage>
  ),
};

/** Three tags, then "+2", which opens all five. Esc closes it and returns focus to the chip. */
export const List: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <TagList tags={STAGES} maxVisible={3} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    const more = canvas.getByRole('button', { name: 'Show 2 more' });
    await expect(more).toHaveTextContent('+2');
    await userEvent.tab();
    await expect(more).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const dialog = await waitFor(() => {
      const found = document.querySelector('[role="dialog"]');
      if (found === null) throw new Error('the popover did not open');
      return found;
    });
    await expect(dialog).toHaveAccessibleName('All tags');
    await expect(dialog).toHaveTextContent('Lost');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await waitFor(() => expect(more).toHaveFocus());
  },
};
