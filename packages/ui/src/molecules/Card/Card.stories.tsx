import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { Switch } from '../../atoms/Switch/Switch.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { DescriptionList } from '../DescriptionList/DescriptionList.tsx';
import { Select } from '../Select/Select.tsx';
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
