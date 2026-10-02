import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, waitFor } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Panel } from './Panel.tsx';

const meta = {
  title: 'Molecules/Panel',
  component: Panel,
  args: { title: 'Northwind Traders', isOpen: true, onClose: () => undefined, children: null },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

function Opener({ startOpen = false }: { readonly startOpen?: boolean }) {
  const [isOpen, setOpen] = useState(startOpen);
  return (
    <Stage>
      <Button
        icon="building"
        onPress={() => {
          setOpen(true);
        }}
      >
        Open Northwind
      </Button>
      <Panel
        title="Northwind Traders"
        isOpen={isOpen}
        onClose={() => {
          setOpen(false);
        }}
        actions={<Button variant="ghost" icon="ellipsis" label="Record actions" />}
        footer={<Button variant="primary">Save</Button>}
      >
        A wholesale distributor in Portland. 48 people, 6 open deals.
      </Panel>
    </Stage>
  );
}

/** Open beside the page, with header actions and a footer. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: () => <Opener startOpen />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('dialog', { name: 'Northwind Traders' })).toBeInTheDocument();
  },
};

/** From the keyboard: focus moves in, Esc closes it and focus returns to the button. */
export const Keyboard: Story = {
  parameters: { crm: { screenshot: false } },
  render: () => <Opener />,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Open Northwind' });
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const panel = await waitFor(() => canvas.getByRole('dialog', { name: 'Northwind Traders' }));
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

/** Floating, inset from the edges on the larger radius, as the record panel shows. */
export const Floating: Story = {
  render: () => (
    <Stage>
      <Panel title="Northwind Traders" isOpen onClose={() => undefined} variant="floating">
        A wholesale distributor in Portland. 48 people, 6 open deals.
      </Panel>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('dialog', { name: 'Northwind Traders' })).toBeInTheDocument();
  },
};
