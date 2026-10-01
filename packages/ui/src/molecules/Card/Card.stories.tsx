import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Switch } from '../../atoms/Switch/Switch.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Card } from './Card.tsx';

const meta = {
  title: 'Molecules/Card',
  component: Card,
  args: { title: 'Email digest', description: 'A summary of what changed, once a week.' },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A settings card with an action, content and a footer. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage width="narrow">
      <Card
        {...args}
        actions={<Button variant="ghost" icon="ellipsis" label="Digest options" />}
        footer={<Button variant="primary">Save</Button>}
      >
        <Switch label="Send on Mondays" defaultSelected />
      </Card>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { name: 'Email digest' })).toBeInTheDocument();
  },
};

/** The quieter tone, inside a page. */
export const Sunken: Story = {
  args: { tone: 'sunken', children: 'No digests sent yet.' },
  render: (args) => (
    <Stage width="narrow">
      <Card {...args} />
    </Stage>
  ),
};
