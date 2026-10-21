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

/** Two cards, stacked across the view's whole width. */
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

/** A side column at the end on a wide page (Availability: the week, then the time zone and days off), under it on a narrow one. */
export const WithAside: Story = {
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

/** Too narrow for both: the side column wraps under the children at full width. */
export const WithAsideNarrow: Story = {
  render: (args) => (
    <Stage width="narrow">
      <PageColumn {...args} aside={<Card title="Time zone">Europe/London</Card>}>
        <Card title="Weekly hours">Monday to Friday, 09:00 to 17:00.</Card>
      </PageColumn>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const main = canvas.getByText('Weekly hours').getBoundingClientRect();
    const side = canvas.getByText('Time zone').getBoundingClientRect();
    await expect(side.top).toBeGreaterThan(main.bottom);
  },
};

/** Alone on the page: the whole height, its child in the middle (a list's empty state). */
export const Centered: Story = {
  args: { align: 'center' },
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

/** Stacked with `stack="aside-first"`: on a narrow page the side column comes before the children. */
export const AsideFirstNarrow: Story = {
  args: { stack: 'aside-first' },
  render: (args) => (
    <Stage width="narrow">
      <PageColumn {...args} aside={<Card title="Time zone">Europe/London</Card>}>
        <Card title="Weekly hours">Monday to Friday, 09:00 to 17:00.</Card>
      </PageColumn>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const main = canvas.getByText('Weekly hours').getBoundingClientRect();
    const side = canvas.getByText('Time zone').getBoundingClientRect();
    await expect(side.bottom).toBeLessThan(main.top);
    // The DOM order matches, so reading and Tab order follow the screen.
    const order = canvas.getByText('Time zone').compareDocumentPosition(canvas.getByText('Weekly hours'));
    await expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  },
};

/** `stack="aside-first"` changes nothing side by side: the side column stays at the end, tops level. */
export const AsideFirstWide: Story = {
  args: { stack: 'aside-first' },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill">
      <PageColumn {...args} aside={<Card title="Time zone">Europe/London</Card>}>
        <Card title="Weekly hours">Monday to Friday, 09:00 to 17:00.</Card>
        <Card title="Days off">None coming up.</Card>
      </PageColumn>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const main = canvas.getByText('Weekly hours').getBoundingClientRect();
    const side = canvas.getByText('Time zone').getBoundingClientRect();
    await expect(side.left).toBeGreaterThan(main.right);
    await expect(Math.round(side.top)).toBe(Math.round(main.top));
  },
};

/** A footer that draws nothing (a SaveBar with nothing unsaved) takes no room under the last card. */
export const EmptyFooter: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage>
      <div data-testid="column">
        <PageColumn {...args} footer={<Nothing />}>
          <Card title="Weekly hours">Monday to Friday, 09:00 to 17:00.</Card>
        </PageColumn>
      </div>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const card = canvas.getByText('Weekly hours').closest('section')?.getBoundingClientRect();
    const column = canvas.getByTestId('column').getBoundingClientRect();
    // Only the column's own padding (space-16) under the card, no gap for an empty footer.
    await expect(Math.round(column.bottom - (card?.bottom ?? 0))).toBe(16);
  },
};

function Nothing() {
  return null;
}

/** `align="fill"`: the view's whole height for a child that fills it (Bookings' week grid). */
export const Fill: Story = {
  args: { align: 'fill' },
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="fill" height="page">
      <PageColumn {...args}>
        <Card title="Week">The grid takes the rest of the view.</Card>
      </PageColumn>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const column = canvasElement.querySelector('[data-align="fill"]');
    await expect(column?.getBoundingClientRect().height ?? 0).toBeGreaterThan(300);
  },
};
