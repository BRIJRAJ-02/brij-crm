import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Card } from '../../molecules/Card/Card.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { PageColumn } from './PageColumn.tsx';

const meta = {
  title: 'Modules/PageColumn',
  component: PageColumn,
  args: { children: null },
} satisfies Meta<typeof PageColumn>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two cards in a readable column. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <PageColumn {...args}>
        <Card title="Weekly hours">Monday to Friday, 09:00 to 17:00.</Card>
        <Card title="Days off">None coming up.</Card>
      </PageColumn>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Weekly hours')).toBeInTheDocument();
  },
};

/** With its own action at the top end, and a sticky footer bar while something is unsaved. */
export const WithFooter: Story = {
  render: (args) => (
    <Stage>
      <PageColumn
        {...args}
        actions={<Button icon="plus">New booking page</Button>}
        footer={<Callout actions={<Button variant="primary">Save</Button>}>Unsaved changes</Callout>}
      >
        <Card title="Weekly hours">Monday to Friday, 09:00 to 17:00.</Card>
      </PageColumn>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  },
};

/** The whole width inside the padding, for a list of rows (Captures › Links and Forms). */
export const FullWidth: Story = {
  args: { width: 'full' },
  render: (args) => (
    <Stage>
      <PageColumn
        {...args}
        actions={
          <Button variant="primary" icon="plus">
            New form
          </Button>
        }
      >
        <Card title="Contact us">3 enquiries this month.</Card>
      </PageColumn>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'New form' })).toBeInTheDocument();
  },
};

/** A side column at the end on a wide page (Availability: the week, then the time zone and days off), under it on a narrow one. */
export const WithAside: Story = {
  args: { width: 'full' },
  render: (args) => (
    <Stage width="fill">
      <PageColumn
        {...args}
        aside={
          <>
            <Card title="Time zone">Europe/London</Card>
            <Card title="Days off">None coming up.</Card>
          </>
        }
      >
        <Card title="Weekly hours">Monday to Friday, 09:00 to 17:00.</Card>
      </PageColumn>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Time zone')).toBeInTheDocument();
  },
};

/** Alone on the page: the whole height, its child in the middle (a list's empty state). */
export const Centered: Story = {
  args: { width: 'full', align: 'center' },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <PageColumn {...args}>
        <Card title="No forms yet">Make one and share its link.</Card>
      </PageColumn>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('No forms yet')).toBeInTheDocument();
  },
};
