import type { RecordRefDisplay } from '@crm/contracts/values';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { LinkChip } from '../../atoms/LinkChip/LinkChip.tsx';
import { SAMPLE_COMPANIES, SAMPLE_MEMBERS } from '../../workbench/field-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { AttributeDisplay } from '../../fields/AttributeDisplay.tsx';
import { RecordFacts } from '../../molecules/RecordFacts/RecordFacts.tsx';
import type { RecordStat } from '../../molecules/RecordStats/RecordStats.tsx';
import { attributeOf } from '../../workbench/attributes.ts';
import { RecordHeader } from './RecordHeader.tsx';

const NORTHWIND = SAMPLE_COMPANIES[0] as RecordRefDisplay;
const VALUE = attributeOf('currency', 'Value');
const JOB = attributeOf('text', 'Job title');
const EMAIL = attributeOf('email', 'Email addresses');
const PERSON: RecordRefDisplay = {
  objectId: 'people',
  recordId: 'p1',
  name: 'Margaret Hamilton',
  kind: 'person',
  hue: 'green',
};
const VIEWERS = SAMPLE_MEMBERS.slice(1, 3).map((member) => ({
  id: member.id ?? member.name,
  name: member.name,
  ...(member.hue === undefined ? {} : { hue: member.hue }),
}));

interface SampleProps {
  readonly isPerson?: boolean;
  readonly isLoading?: boolean;
  readonly width?: 'auto' | 'narrow';
  /** The stat strip under the header (on by default), or its values still coming. */
  readonly stats?: 'shown' | 'loading' | 'none';
  /** The record at a glance under its name, with quick actions (the record page, owner 31 Oct). */
  readonly withFacts?: boolean;
}

/** A deal's stats, what its tabs don't say: its value, how long in its stage, its next meeting and last activity. */
function sampleStats(isLoading: boolean): readonly RecordStat[] {
  return [
    {
      id: 'value',
      label: 'Value',
      icon: 'banknote',
      value: (
        <AttributeDisplay attribute={VALUE} value={{ amount: '48000', currency: 'USD' } as never} surface="panel" />
      ),
      isLoading,
    },
    { id: 'stage', label: 'Entered Proposal', icon: 'circle-dot', time: '2026-09-29T10:00:00.000Z', isLoading },
    { id: 'meeting', label: 'Next meeting', icon: 'calendar', time: '2026-10-09T15:00:00.000Z', isLoading },
    {
      id: 'activity',
      label: 'Last activity',
      icon: 'activity',
      time: '2026-10-08T11:30:00.000Z',
      isLoading,
      onPress: () => undefined,
    },
  ];
}

/** A record page's header, as the record page draws it under the top bar. */
function SampleHeader({
  isPerson = false,
  isLoading = false,
  width = 'auto',
  stats = 'shown',
  withFacts = false,
}: SampleProps) {
  const facts = (
    <RecordFacts
      label="About Margaret Hamilton"
      facts={[
        {
          id: 'job',
          label: 'Job title',
          icon: 'briefcase',
          content: <AttributeDisplay attribute={JOB} value={'Director of engineering'} surface="panel" />,
        },
        {
          id: 'email',
          label: 'Email addresses',
          content: <AttributeDisplay attribute={EMAIL} value={['margaret@example.com'] as never} surface="panel" />,
        },
      ]}
    />
  );
  return (
    <Stage width={width}>
      <RecordHeader
        record={isPerson ? PERSON : NORTHWIND}
        objectName={isPerson ? 'Person' : 'Company'}
        {...(withFacts
          ? { facts }
          : {
              meta: isPerson ? (
                'Director of engineering'
              ) : (
                <LinkChip href="https://northwindtraders.com">northwindtraders.com</LinkChip>
              ),
            })}
        viewers={VIEWERS}
        isLoading={isLoading}
        stats={stats === 'none' ? [] : sampleStats(stats === 'loading')}
      >
        {withFacts && (
          <>
            <Button icon="mail">Email</Button>
            <Button icon="pen">Log activity</Button>
          </>
        )}
        <Button icon="star" label="Add to favorites" variant="ghost" />
        <Button icon="ellipsis" label="Record actions" variant="ghost" />
      </RecordHeader>
    </Stage>
  );
}

const meta = {
  title: 'Modules/RecordHeader',
  component: SampleHeader,
} satisfies Meta<typeof SampleHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A company: its square avatar, name, object and domain, who else is viewing, and its actions. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Northwind Traders' })).toBeInTheDocument();
    await expect(canvas.getByRole('group', { name: 'Grace Hopper and Alan Turing' })).toBeInTheDocument();
  },
};

/** A person has a round avatar. */
export const Person: Story = {
  args: { isPerson: true },
};

/** A person at a glance: job title and email under the name in place of "Person", with quick actions. */
export const WithFacts: Story = {
  args: { isPerson: true, withFacts: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('list', { name: 'About Margaret Hamilton' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Email' })).toBeInTheDocument();
  },
};

/** The record is still coming. */
export const Loading: Story = {
  args: { isLoading: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Loading record')).toBeInTheDocument();
  },
};

/** In a narrow slot the actions wrap under the name. */
export const Narrow: Story = {
  args: { width: 'narrow' },
};

/** The stats still coming: a skeleton in place of each value, labels already in place. */
export const StatsLoading: Story = {
  args: { stats: 'loading' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Next meeting')).toBeInTheDocument();
    const strip = canvas.getByRole('group', { name: 'About Northwind Traders' });
    const values = within(strip).getAllByRole('definition');
    await expect(values.every((value) => value.getAttribute('aria-busy') === 'true')).toBe(true);
  },
};

/** No stats: the header alone, as before the strip. */
export const WithoutStats: Story = {
  args: { stats: 'none' },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('group', { name: /About/ })).not.toBeInTheDocument();
  },
};

/** The strip in a narrow slot: two stats to a row. A stat that goes somewhere is a button named by its label. */
export const StatsNarrow: Story = {
  args: { width: 'narrow' },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'About Northwind Traders' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Last activity' })).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Value' })).not.toBeInTheDocument();
  },
};
