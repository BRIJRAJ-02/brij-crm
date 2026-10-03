import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Form } from '../../molecules/Form/Form.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { AuthLayout } from './AuthLayout.tsx';

const meta = {
  title: 'Modules/AuthLayout',
  component: AuthLayout,
  args: {
    productName: 'CRM',
    title: 'Name your workspace',
    description: 'You can change both later.',
    children: null,
  },
  // A page frame fills its container, so each story gives it an app window's height.
  render: (args) => (
    <Stage height="page">
      <AuthLayout {...args}>
        <Form submitLabel="Create workspace" onSubmit={fn()}>
          <Field label="Workspace name" name="name" defaultValue="Halcyon Labs" />
          <Field label="Web address" name="slug" defaultValue="halcyon-labs" />
        </Form>
      </AuthLayout>
    </Stage>
  ),
} satisfies Meta<typeof AuthLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The product's mark and name over the page card, centred in the window. The card is the page's main landmark, and its title takes focus by script, outside the tab order. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('main')).toBeInTheDocument();
    const title = canvas.getByRole('heading', { level: 1, name: 'Name your workspace' });
    await expect(title).toHaveAttribute('tabindex', '-1');
    await expect(canvas.getByText('CRM')).toBeVisible();
  },
};

/** Loading: the page's task is still coming (the session is being checked). A Skeleton stands in, and the card reads as busy. */
export const Loading: Story = {
  args: { isBusy: true },
  render: (args) => (
    <Stage height="page">
      <AuthLayout {...args}>
        <Skeleton lines={3} />
      </AuthLayout>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    await expect(canvas.getByRole('heading', { level: 1, name: 'Name your workspace' })).toBeInTheDocument();
  },
};

/** A footer under a hairline, for a way back. */
export const WithFooter: Story = {
  args: { footer: <Button variant="ghost">Sign out</Button> },
};

/** Narrower than a phone: the card keeps space-16 from each edge. */
export const Narrow: Story = {
  render: (args) => (
    <Stage width="narrow" height="page">
      <AuthLayout {...args}>
        <Form submitLabel="Create workspace" onSubmit={fn()}>
          <Field label="Workspace name" name="name" defaultValue="Halcyon Labs" />
        </Form>
      </AuthLayout>
    </Stage>
  ),
};
