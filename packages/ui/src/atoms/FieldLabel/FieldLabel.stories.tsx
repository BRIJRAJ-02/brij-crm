import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { InfoTip } from '../../molecules/InfoTip/InfoTip.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FieldLabel } from './FieldLabel.tsx';

const meta = {
  title: 'Atoms/FieldLabel',
  component: FieldLabel,
  args: { label: 'Domain', as: 'text' },
} satisfies Meta<typeof FieldLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Plain, with an aside, with an InfoTip, strong and heading. Disabled shows inside a disabled Field (its story). */
export const States: Story = {
  render: () => (
    <Stage direction="column">
      <FieldLabel label="Domain" as="text" />
      <FieldLabel label="Website" aside="(optional)" as="text" />
      <FieldLabel
        label="Minimum notice"
        as="text"
        info={<InfoTip label="Minimum notice">How soon a visitor can book.</InfoTip>}
      />
      <FieldLabel label="Who can book?" tone="strong" as="text" />
      <FieldLabel label="Answers" tone="heading" as="text" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'About Minimum notice' })).toBeInTheDocument();
  },
};
