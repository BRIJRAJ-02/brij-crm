import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Form } from '../../molecules/Form/Form.tsx';
import { Steps } from '../../molecules/Steps/Steps.tsx';
import { WorkspacePreview } from '../WorkspacePreview/WorkspacePreview.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { AuthLayout } from './AuthLayout.tsx';

const meta = {
  title: 'Modules/AuthLayout',
  component: AuthLayout,
  args: {
    productName: 'Timefix',
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
    await expect(canvas.getByText('Timefix')).toBeVisible();
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

/** A stand in wordmark, 860 by 210 like the product's, drawn in one fill. */
const wordmark = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 210"><rect x="0" y="40" width="130" height="130" rx="65" fill="${fill}"/><rect x="170" y="70" width="660" height="70" rx="12" fill="${fill}"/></svg>`,
  )}`;

/** With the product's wordmark in place of the mark and name: the image for the theme shows, named by `productName`, and the other one is out of the accessibility tree. */
export const WithLogo: Story = {
  args: { logo: { light: wordmark('black'), dark: wordmark('white') } },
  play: async ({ canvas }) => {
    const shown = canvas.getAllByRole('img', { name: 'Timefix' });
    await expect(shown).toHaveLength(1);
    await expect(shown[0]).toBeVisible();
  },
};

/** A footer under a hairline, for a way back. */
export const WithFooter: Story = {
  args: { footer: <Button variant="link">Sign out</Button> },
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

/** First run's steps, as Steps' count names them. */
const FIRST_RUN = [
  { id: 'about', label: 'About you' },
  { id: 'workspace', label: 'Your workspace' },
  { id: 'calendar', label: 'Connect your calendar' },
];

/**
 * Split (first run, spec 0036): from 1024px up, the step on the left and the workspace's sketch on the right, Back and
 * the step count above the title, and who is signed in at the foot beside Sign out. Narrower, the sketch is left out.
 */
export const Split: Story = {
  args: {
    title: 'Your workspace',
    description: 'Your records live here. Name it for your team or company.',
    eyebrow: (
      <>
        <Button variant="ghost" icon="arrow-left" label="Back" />
        <Steps variant="count" label="Setting up" steps={FIRST_RUN} current="workspace" />
      </>
    ),
    preview: <WorkspacePreview workspaceName="Halcyon Labs" personName="Maya Chen" focus="workspace" />,
    account: 'maya@halcyonlabs.io',
    footer: <Button variant="link">Sign out</Button>,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Your workspace' })).toBeInTheDocument();
    await expect(canvas.getByText('Step 2 of 3')).toBeInTheDocument();
    await expect(canvas.getByText('Signed in as maya@halcyonlabs.io')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  },
};
