import type { RecordRefDisplay } from '@crm/contracts/values';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { LinkChip } from '../../atoms/LinkChip/LinkChip.tsx';
import { SAMPLE_COMPANIES, SAMPLE_MEMBERS } from '../../workbench/field-samples.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { RecordHeader } from './RecordHeader.tsx';

const NORTHWIND = SAMPLE_COMPANIES[0] as RecordRefDisplay;
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
}

/** A record page's header, as the record page draws it under the top bar. */
function SampleHeader({ isPerson = false, isLoading = false, width = 'auto' }: SampleProps) {
  return (
    <Stage width={width}>
      <RecordHeader
        record={isPerson ? PERSON : NORTHWIND}
        objectName={isPerson ? 'Person' : 'Company'}
        meta={
          isPerson ? (
            'Director of engineering'
          ) : (
            <LinkChip href="https://northwindtraders.com">northwindtraders.com</LinkChip>
          )
        }
        viewers={VIEWERS}
        isLoading={isLoading}
      >
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
