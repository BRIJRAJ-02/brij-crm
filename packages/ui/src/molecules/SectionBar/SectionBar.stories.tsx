import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SectionBar } from './SectionBar.tsx';

const meta = {
  title: 'Molecules/SectionBar',
  component: SectionBar,
  args: {},
} satisfies Meta<typeof SectionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A week's bar: the heading, then previous, Today and next at the end. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <SectionBar
        title="19 – 25 October 2026"
        end={
          <>
            <Button variant="ghost" icon="chevron-left" label="Previous week" />
            <Button variant="primary">Today</Button>
            <Button variant="ghost" icon="chevron-right" label="Next week" />
          </>
        }
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: '19 – 25 October 2026' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Next week' })).toBeInTheDocument();
  },
};
