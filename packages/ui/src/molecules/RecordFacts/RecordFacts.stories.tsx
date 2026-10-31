import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { AttributeDisplay } from '../../fields/AttributeDisplay.tsx';
import { attributeOf } from '../../workbench/attributes.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { RecordFacts, type RecordFact } from './RecordFacts.tsx';

const JOB = attributeOf('text', 'Job title');
const EMAIL = attributeOf('email', 'Email addresses');

const FACTS: readonly RecordFact[] = [
  {
    id: 'job',
    label: 'Job title',
    icon: 'briefcase',
    content: <AttributeDisplay attribute={JOB} value={'Analyst'} surface="panel" />,
  },
  {
    id: 'email',
    label: 'Email addresses',
    content: <AttributeDisplay attribute={EMAIL} value={['ada@example.com'] as never} surface="panel" />,
  },
];

interface SampleProps {
  readonly facts?: readonly RecordFact[];
  readonly isLoading?: boolean;
  readonly width?: 'auto' | 'narrow';
}

function SampleFacts({ facts = FACTS, isLoading = false, width = 'auto' }: SampleProps) {
  return (
    <Stage width={width}>
      <RecordFacts label="About Ada Lovelace" facts={facts} isLoading={isLoading} />
    </Stage>
  );
}

const meta = {
  title: 'Molecules/RecordFacts',
  component: SampleFacts,
} satisfies Meta<typeof SampleFacts>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A person's facts: job title and email, each heard with its name. */
export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('list', { name: 'About Ada Lovelace' })).toBeInTheDocument();
    await expect(canvas.getByText('Job title')).toBeInTheDocument();
  },
};

/** Still coming: two skeletons hold the line. */
export const Loading: Story = {
  args: { isLoading: true },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull();
  },
};

/** Nothing to show: no line at all. */
export const Empty: Story = {
  args: { facts: [] },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('list')).not.toBeInTheDocument();
  },
};

/** In a narrow slot the facts wrap. */
export const Narrow: Story = {
  args: { width: 'narrow' },
};
