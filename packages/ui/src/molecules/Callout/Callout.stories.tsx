import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Callout } from './Callout.tsx';

const meta = {
  title: 'Molecules/Callout',
  component: Callout,
  args: { children: 'People are matched on email address. Rows without one are added as new people.' },
} satisfies Meta<typeof Callout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The four tones. */
export const Tones: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage direction="column">
      <Callout title="How matching works">
        People are matched on email address. Rows without one are added as new people.
      </Callout>
      <Callout tone="success" title="Import finished">
        2,394 people imported, 6 updated.
      </Callout>
      <Callout tone="warning" title="3 rows were skipped" actions={<Button>Download skipped rows</Button>}>
        Their dates weren’t in one format. Fix them, then import those rows again.
      </Callout>
      <Callout tone="danger" title="The sync stopped">
        Gmail refused the connection. Reconnect the account to start syncing again.
      </Callout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('The sync stopped');
  },
};
