import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Switch } from '../../atoms/Switch/Switch.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { DescriptionList } from '../DescriptionList/DescriptionList.tsx';
import { Select } from '../Select/Select.tsx';
import { Table } from '../Table/Table.tsx';
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

/** A page of its own before the app shell, like the status page: the card is the page's main landmark, with an h1. */
export const Page: Story = {
  args: { placement: 'page', title: 'CRM', description: 'The API and the database are answering.' },
  render: (args) => (
    <Card {...args}>
      <DescriptionList
        items={[
          { term: 'Environment', description: 'development' },
          { term: 'Postgres', description: '18.1' },
        ]}
      />
    </Card>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('main')).toBeInTheDocument();
    await expect(canvas.getByRole('heading', { level: 1, name: 'CRM' })).toBeInTheDocument();
  },
};

/** The small page card (`size="sm"`, `size-panel` wide): a page before the app whose task is one short form, like sign in. */
export const PageSmall: Story = {
  args: { placement: 'page', size: 'sm', title: 'Sign in or sign up' },
  render: (args) => (
    <Card {...args}>
      <Button variant="primary" size="lg" isFullWidth="center">
        Continue with email
      </Button>
    </Card>
  ),
  play: async ({ canvas }) => {
    const main = canvas.getByRole('main');
    await expect(main).toHaveAttribute('data-size', 'sm');
    await expect(canvas.getByRole('heading', { level: 1, name: 'Sign in or sign up' })).toBeInTheDocument();
  },
};

/**
 * A page card with a preview beside it (first run's split card): the content keeps its narrow column, and the preview,
 * decoration, sits beside it out of the accessibility tree from 1024px up. An eyebrow leads the title.
 */
export const PageWithPreview: Story = {
  args: {
    placement: 'page',
    size: 'sm',
    title: 'Your workspace',
    description: 'Name it for your team or company.',
    eyebrow: <Button variant="ghost" icon="arrow-left" label="Back" />,
    preview: <DescriptionList items={[{ term: 'Workspace', description: 'Halcyon Labs' }]} />,
  },
  render: (args) => (
    <Card {...args}>
      <Button variant="primary" size="lg" isFullWidth="center">
        Continue
      </Button>
    </Card>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Your workspace' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    const preview = canvasElement.querySelector('[inert]');
    await expect(preview).toHaveAttribute('aria-hidden', 'true');
    // Out of the accessibility tree: its words aren't found by role or text queries that respect aria-hidden.
    await expect(canvas.queryByRole('term')).toBeNull();
  },
};

/**
 * A Select first: React Aria's hidden template before it doesn't count, so the air under the header is the
 * same as with any other first child.
 */
export const SelectFirst: Story = {
  args: { title: 'Time zone', description: 'Your hours are in this zone.' },
  render: (args) => (
    <Stage>
      <Card {...args}>
        <Select
          label="Time zone"
          isLabelHidden
          items={[
            { id: 'london', label: 'Europe/London' },
            { id: 'kolkata', label: 'Asia/Kolkata' },
          ]}
          defaultValue="london"
        />
      </Card>
      <Card {...args}>
        <p>Europe/London</p>
      </Card>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const gap = (title: HTMLElement, below: Element) =>
      below.getBoundingClientRect().top - (title.closest('header') ?? title).getBoundingClientRect().bottom;
    const [first, second] = canvas.getAllByText('Your hours are in this zone.');
    const select = canvas.getByRole('button', { name: /Europe\/London/ });
    const text = canvas.getAllByText('Europe/London').find((element) => element.tagName === 'P');
    if (first === undefined || second === undefined || text === undefined) throw new Error('missing');
    await expect(Math.round(gap(first, select))).toBe(Math.round(gap(second, text)));
  },
};

/** A Table first: its hidden markers don't count either, so the air under the header stays the same. */
export const TableFirst: Story = {
  args: { title: 'Days off', description: 'Days you are closed.' },
  render: (args) => (
    <Stage>
      <Card {...args}>
        <Table
          label="Days off"
          columns={[
            { id: 'date', label: 'Date', isRowHeader: true },
            { id: 'note', label: 'Note' },
          ]}
          rows={[{ date: 'Fri, Dec 25', note: 'Holiday' }]}
          getRowId={(row) => row.date}
          renderCell={(row, column) => (column === 'date' ? row.date : row.note)}
        />
      </Card>
      <Card {...args}>
        <p>Fri, Dec 25</p>
      </Card>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const gap = (title: HTMLElement, below: Element) =>
      below.getBoundingClientRect().top - (title.closest('header') ?? title).getBoundingClientRect().bottom;
    const [first, second] = canvas.getAllByText('Days you are closed.');
    const table = canvas.getByRole('grid', { name: 'Days off' });
    const text = canvas.getAllByText('Fri, Dec 25').find((element) => element.tagName === 'P');
    if (first === undefined || second === undefined || text === undefined) throw new Error('missing');
    await expect(Math.round(gap(first, table))).toBe(Math.round(gap(second, text)));
  },
};
