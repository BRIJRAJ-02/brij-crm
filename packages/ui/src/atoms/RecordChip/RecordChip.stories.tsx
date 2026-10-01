import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { RecordChip } from './RecordChip.tsx';

const meta = {
  title: 'Atoms/RecordChip',
  component: RecordChip,
  args: {
    display: { objectId: 'companies', recordId: 'c1', name: 'Northwind Traders', kind: 'company', hue: 'blue' },
    href: '/companies/c1',
  },
} satisfies Meta<typeof RecordChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A company, linking to its page. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Northwind Traders' })).toHaveAttribute('href', '/companies/c1');
  },
};

/** Records and actors: a person, a company, another record, a member, an API key, an automation and the system. */
export const Kinds: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      <RecordChip display={{ objectId: 'people', recordId: 'p1', name: 'Maya Patel', kind: 'person', hue: 'purple' }} />
      <RecordChip
        display={{ objectId: 'companies', recordId: 'c1', name: 'Northwind', kind: 'company', hue: 'blue' }}
      />
      <RecordChip display={{ objectId: 'deals', recordId: 'd1', name: 'Q4 renewal', kind: 'other', hue: 'green' }} />
      <RecordChip display={{ type: 'member', id: 'm1', name: 'Ada Lovelace', hue: 'orange' }} />
      <RecordChip display={{ type: 'api_key', id: 'k1', name: 'Zapier key' }} />
      <RecordChip display={{ type: 'automation', id: 'a1', name: 'Assign new leads' }} />
      <RecordChip display={{ type: 'system', id: null, name: '' }} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('System')).toBeInTheDocument();
  },
};

/** Flat, for board cards and the timeline. */
export const Flat: Story = {
  args: { isFlat: true },
};

/** A long name is cut inside a narrow slot. */
export const Long: Story = {
  render: (args) => (
    <Stage width="narrow">
      <RecordChip
        {...args}
        display={{
          objectId: 'companies',
          recordId: 'c2',
          name: 'International Business Logistics and Freight',
          kind: 'company',
        }}
      />
    </Stage>
  ),
};
