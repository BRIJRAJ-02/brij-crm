import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { SectionTabs } from './SectionTabs.tsx';

const SECTIONS = ['Small plates', 'Mains', 'Sides', 'Desserts', 'Wine', 'Cocktails', 'Coffee'].map((label, index) => ({
  id: String(index),
  label,
  href: `#section-${String(index)}`,
}));

const meta = {
  title: 'Molecules/SectionTabs',
  component: SectionTabs,
  args: { label: 'Sections', sections: SECTIONS, current: '0' },
} satisfies Meta<typeof SectionTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The first section current: its pill filled, the row at its start. */
export const Default: Story = {
  render: (args) => (
    <Stage width="phone">
      <SectionTabs {...args} />
    </Stage>
  ),
};

/** Pressing a pill makes it current here (a page's scroll spy does it as the reader scrolls): the fill slides to it. */
export const Sliding: Story = {
  parameters: { crm: { preview: true } },
  render: function Sliding() {
    const [current, setCurrent] = useState('0');
    return (
      <Stage width="phone">
        <SectionTabs
          label="Sections"
          sections={SECTIONS}
          current={current}
          onSelect={(id, event) => {
            event.preventDefault();
            setCurrent(id);
          }}
        />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('link', { name: 'Sides' }));
    await expect(canvas.getByRole('link', { name: 'Sides' })).toHaveAttribute('aria-current', 'location');
    await expect(canvas.getByRole('link', { name: 'Small plates' })).not.toHaveAttribute('aria-current');
  },
};

/** No section current (the reader above the first): no fill. */
export const NoneCurrent: Story = {
  parameters: { crm: { screenshot: false } },
  args: { current: undefined },
  render: (args) => (
    <Stage width="phone">
      <SectionTabs {...args} />
    </Stage>
  ),
};
