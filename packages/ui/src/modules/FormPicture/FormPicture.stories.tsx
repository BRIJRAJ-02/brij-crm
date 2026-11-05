import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { FormPicture } from './FormPicture.tsx';

const meta = {
  title: 'Modules/FormPicture',
  component: FormPicture,
  args: {
    title: 'Contact us',
    count: '4 questions',
    fields: [{ kind: 'text' }, { kind: 'choices', count: 3 }, { kind: 'long' }],
    hue: 'blue',
  },
  render: (args) => (
    <Stage width="narrow">
      <FormPicture {...args} />
    </Stage>
  ),
} satisfies Meta<typeof FormPicture>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A field and a choice (the long answer after them waits), then the button in the form's colour. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-kind]')).toHaveLength(2);
    await expect(canvasElement.querySelectorAll('[data-picked]')).toHaveLength(1);
    // Shapes only: the name and the count are its only words.
    await expect(canvasElement.textContent).toBe('Contact us4 questions');
  },
};

/** A rating and a checkbox. */
export const RatingAndCheck: Story = {
  args: {
    title: 'How did we do?',
    count: '2 questions',
    fields: [{ kind: 'rating' }, { kind: 'check' }],
    hue: 'green',
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-lit]')).toHaveLength(3);
  },
};

/** More questions than the sheet holds: the first two, then the button. */
export const ManyQuestions: Story = {
  args: {
    count: '9 questions',
    fields: [{ kind: 'text' }, { kind: 'text' }, { kind: 'text' }, { kind: 'text' }],
    hue: 'purple',
  },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-kind]')).toHaveLength(2);
  },
};

/** No questions yet (a new form): its name and the button alone. */
export const NoQuestions: Story = {
  args: { title: 'Untitled form', count: 'No questions yet', fields: [], hue: 'sky' },
  parameters: { crm: { screenshot: false } },
};

/** A long name: one line, cut. */
export const LongTitle: Story = {
  args: { title: 'Customer onboarding questionnaire for the enterprise accounts team', hue: 'lime' },
  parameters: { crm: { screenshot: false } },
};
