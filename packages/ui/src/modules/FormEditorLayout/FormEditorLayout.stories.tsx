import type { PublicForm } from '@crm/contracts/forms';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Card } from '../../molecules/Card/Card.tsx';
import { SegmentedControl } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import { Select } from '../../molecules/Select/Select.tsx';
import { HostedFormPreview } from '../HostedFormPreview/HostedFormPreview.tsx';
import { FormEditorLayout } from './FormEditorLayout.tsx';

const FORM: PublicForm = {
  key: 'contact-us',
  status: 'live',
  versionNumber: 7,
  headline: 'Fill this in and we will come back to you',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'light', corners: 'rounded' },
  offersMeeting: false,
  questions: [
    { id: 'q1', key: 'name', label: 'Your name', answerType: 'short_text', required: true },
    { id: 'q2', key: 'email', label: 'Work email', answerType: 'email', required: true },
  ],
};

const LOOK = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const meta = {
  title: 'Modules/FormEditorLayout',
  component: FormEditorLayout,
  args: {
    status: { tone: 'live', text: 'Published · v7' },
    children: <Card title="Questions">{null}</Card>,
  },
} satisfies Meta<typeof FormEditorLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Published, with tabs, and the live preview beside the questions. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  args: {
    tabs: (
      <SegmentedControl
        label="Form sections"
        defaultValue="form"
        segments={[
          { value: 'form', label: 'Form' },
          { value: 'settings', label: 'Settings' },
          { value: 'install', label: 'Install' },
          { value: 'submissions', label: 'Submissions' },
        ]}
      />
    ),
    previewControls: (
      <>
        <Select label="Colour" items={LOOK} defaultValue="light" size="sm" />
        <Select
          label="Corners"
          items={[
            { id: 'rounded', label: 'Rounded' },
            { id: 'square', label: 'Square' },
          ]}
          defaultValue="rounded"
          size="sm"
        />
      </>
    ),
    preview: <HostedFormPreview form={FORM} />,
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Published · v7')).toBeInTheDocument();
    await expect(canvas.getByRole('complementary', { name: 'Preview' })).toBeInTheDocument();
  },
};

/** Changed since it was published, with a refused publish's Callout. */
export const Changed: Story = {
  args: {
    status: { tone: 'changed', text: 'Published · Unpublished changes' },
    notices: <Callout tone="danger">Every question needs a label.</Callout>,
    preview: <HostedFormPreview form={FORM} />,
  },
  parameters: { crm: { screenshot: false } },
};

/** Never published: no tabs, a hollow dot. */
export const NotPublished: Story = {
  args: {
    status: { tone: 'draft', text: 'Not published' },
    preview: <HostedFormPreview form={FORM} />,
  },
};
