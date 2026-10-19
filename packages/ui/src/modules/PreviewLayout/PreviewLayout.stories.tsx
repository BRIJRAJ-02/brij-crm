import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent } from 'storybook/test';
import { Card } from '../../molecules/Card/Card.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { PreviewLayout } from './PreviewLayout.tsx';

const meta = {
  title: 'Modules/PreviewLayout',
  component: PreviewLayout,
  args: { previewSrc: 'about:blank', previewTitle: 'Intro call', children: null },
} satisfies Meta<typeof PreviewLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The editor's groups beside a phone width preview; the switch widens it. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage height="page">
      <PreviewLayout {...args}>
        <Card title="Meeting">Title, durations and location.</Card>
        <Card title="Hours">Weekly hours and days off.</Card>
      </PreviewLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const [first] = canvas.getAllByRole('radio', { name: 'Tablet' });
    if (first !== undefined) await userEvent.click(first);
    await expect(canvas.getAllByTitle('Preview of Intro call').length).toBeGreaterThan(0);
  },
};
