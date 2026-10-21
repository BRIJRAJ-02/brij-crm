import type { PublicForm } from '@crm/contracts/forms';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { HostedFormPreview } from './HostedFormPreview.tsx';

const CONTACT: PublicForm = {
  key: 'contact-us',
  status: 'live',
  versionNumber: 3,
  headline: 'Fill this in and we will come back to you',
  subheading: 'We answer within one working day.',
  buttonText: 'Send',
  language: 'en',
  look: { colour: 'light', corners: 'rounded' },
  offersMeeting: false,
  questions: [
    { id: 'q1', key: 'name', label: 'Your name', answerType: 'short_text', placeholder: 'John Doe', required: true },
    { id: 'q2', key: 'email', label: 'Work email', answerType: 'email', placeholder: 'john@acme.com', required: true },
    { id: 'q3', key: 'phone', label: 'Phone or WhatsApp', answerType: 'phone', required: false },
    { id: 'q7', key: 'country', label: 'Country', answerType: 'country', required: false },
    {
      id: 'q4',
      key: 'budget',
      label: 'Budget',
      answerType: 'dropdown',
      choices: ['Under 5k', '5k to 20k', 'Over 20k'],
      required: false,
    },
    { id: 'q5', key: 'message', label: 'Anything else?', answerType: 'long_text', required: false },
    { id: 'q6', key: 'updates', label: 'Send me product updates', answerType: 'checkbox', required: false },
  ],
};

/** A stand in wordmark, 860 by 210 like the product's, drawn in one fill. */
const wordmark = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 210"><rect x="0" y="40" width="130" height="130" rx="65" fill="${fill}"/><rect x="170" y="70" width="660" height="70" rx="12" fill="${fill}"/></svg>`,
  )}`;

const meta = {
  title: 'Modules/HostedFormPreview',
  component: HostedFormPreview,
  args: { form: CONTACT, logo: { light: wordmark('black'), dark: wordmark('white') } },
  render: (args) => (
    <Stage width="narrow">
      <HostedFormPreview {...args} />
    </Stage>
  ),
} satisfies Meta<typeof HostedFormPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The builder's column: the draft as a visitor sees it, inert, with a note for screen readers. */
export const Default: Story = {
  args: { form: CONTACT },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('A preview of the form. It can’t be filled in here.')).toBeInTheDocument();
    const frame = canvasElement.querySelector('[inert]');
    await expect(frame).not.toBeNull();
    await expect(canvas.getByRole('button', { name: 'Send' }).closest('[inert]')).toBe(frame);
    // An optional question says so after its label; an unanswered dropdown asks, never looks answered.
    // The quiet "(optional)" is its own muted span inside the label, so the label reads whole.
    await expect(
      canvas.getByText(
        (_, element) => element?.tagName === 'LABEL' && element.textContent === 'Phone or WhatsApp (optional)',
      ),
    ).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: /^Choose one Budget \(optional\)/ })).toBeInTheDocument();
  },
};

/** Dark colour and square corners: the whole of a form's look. */
export const DarkSquare: Story = {
  args: { form: { ...CONTACT, look: { colour: 'dark', corners: 'square' } } },
};

/** Opened to try: answers are checked as the server would, errors sit under their fields, and nothing is sent. */
export const AsPage: Story = {
  args: { form: CONTACT, mode: 'page' },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(canvas.getByLabelText('Your name')).toHaveFocus());
    await expect(canvas.getAllByText('Answer this question.')).toHaveLength(2);
    await userEvent.type(canvas.getByLabelText('Your name'), 'Ada Lovelace');
    await userEvent.type(canvas.getByLabelText('Work email'), 'ada@example.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(canvas.getByRole('heading', { name: 'Thank you. That is with us.' })).toHaveFocus());
    // Send another starts again, with focus on the form's headline.
    await userEvent.click(canvas.getByRole('button', { name: 'Send another' }));
    await waitFor(() =>
      expect(canvas.getByRole('heading', { name: 'Fill this in and we will come back to you' })).toHaveFocus(),
    );
  },
};

/** A form that stopped taking enquiries. */
export const Paused: Story = {
  args: { form: { ...CONTACT, status: 'paused', questions: [] }, mode: 'page' },
  parameters: { crm: { screenshot: false } },
};
