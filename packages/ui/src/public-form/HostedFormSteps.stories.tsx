import type { PublicForm, PublicStep } from '@crm/contracts/forms';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { Stage } from '../workbench/Stage/Stage.tsx';
import { HostedFormSteps } from './HostedFormSteps.tsx';

/** A longer enquiry that falls into topics: about you, your company, your project. */
const ENQUIRY = {
  key: 'project-enquiry',
  status: 'live',
  versionNumber: 2,
  headline: 'Start a project with us',
  subheading: 'Three short steps. We answer within one working day.',
  buttonText: 'Send enquiry',
  language: 'en',
  look: { colour: 'light', corners: 'rounded' },
  offersMeeting: false,
  questions: [
    { id: 'name', key: 'name', label: 'Your name', answerType: 'short_text', placeholder: 'John Doe', required: true },
    {
      id: 'email',
      key: 'email',
      label: 'Work email',
      answerType: 'email',
      placeholder: 'john@acme.com',
      required: true,
    },
    { id: 'phone', key: 'phone', label: 'Phone or WhatsApp', answerType: 'phone', required: false },
    { id: 'company', key: 'company', label: 'Company', answerType: 'short_text', required: true },
    {
      id: 'size',
      key: 'size',
      label: 'Size',
      answerType: 'dropdown',
      choices: ['Just me', '2 to 10', '11 to 50', '51 to 200', 'Over 200'],
      required: false,
    },
    {
      id: 'budget',
      key: 'budget',
      label: 'Budget',
      answerType: 'choice',
      choices: ['Under 5k', '5k to 20k', 'Over 20k'],
      required: true,
    },
    { id: 'message', key: 'message', label: 'What do you need?', answerType: 'long_text', required: false },
  ],
} satisfies PublicForm;

const STEPS: PublicStep[] = [
  { id: 'you', title: 'About you', keys: ['name', 'email', 'phone'] },
  { id: 'company', title: 'Your company', keys: ['company', 'size'] },
  { id: 'project', title: 'Your project', keys: ['budget', 'message'] },
];

/** The enquiry in Steps, as the server sends it (spec 0063). */
const STEPPED: PublicForm = { ...ENQUIRY, layout: 'steps', steps: STEPS };

/** The enquiry one question at a time. */
const ONE_BY_ONE: PublicForm = { ...ENQUIRY, layout: 'conversational' };

/** A stand in wordmark, 860 by 210 like the product's, drawn in one fill. */
const wordmark = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 210"><rect x="0" y="40" width="130" height="130" rx="65" fill="${fill}"/><rect x="170" y="70" width="660" height="70" rx="12" fill="${fill}"/></svg>`,
  )}`;

const meta = {
  title: 'Public form/HostedFormSteps',
  component: HostedFormSteps,
  args: {
    form: STEPPED,
    mode: 'page',
    logo: { light: wordmark('black'), dark: wordmark('white') },
  },
  render: (args) => (
    <Stage width="fill">
      <HostedFormSteps {...args} />
    </Stage>
  ),
} satisfies Meta<typeof HostedFormSteps>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Steps, the first: the header, "Step 1 of 3" over the progress line, the step's title and its questions, Continue. */
export const Steps: Story = {
  play: async ({ canvas }) => {
    const progress = canvas.getByRole('progressbar', { name: 'Step 1 of 3' });
    await expect(progress).toHaveAttribute('aria-valuetext', 'Step 1 of 3');
    await expect(canvas.getByRole('heading', { level: 2, name: 'About you' })).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  },
};

/** Continue checks the step first: its problems show, the first takes focus, and the step stays. */
export const StepErrors: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(canvas.getByLabelText('Your name')).toHaveFocus());
    await waitFor(() => expect(canvas.getByText('2 answers need a look')).toBeInTheDocument());
    await expect(canvas.getByRole('progressbar', { name: 'Step 1 of 3' })).toBeInTheDocument();
  },
};

/** A step that passes moves on: "Step 2 of 3", focus on its first question, Back beside Continue. */
export const SecondStep: Story = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByLabelText('Your name'), 'Ada Lovelace');
    await userEvent.type(canvas.getByLabelText('Work email'), 'ada@example.com');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(canvas.getByLabelText('Company')).toHaveFocus());
    await expect(canvas.getByRole('progressbar', { name: 'Step 2 of 3' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    // Back keeps what was typed.
    await userEvent.click(canvas.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(canvas.getByLabelText('Your name')).toHaveValue('Ada Lovelace'));
  },
};

/** The last step's button reads the form's own words, and sending thanks in place. */
export const LastStep: Story = {
  args: {
    onSubmit: () => Promise.resolve({ kind: 'done' as const, next: { kind: 'message' as const, text: '' } }),
  },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByLabelText('Your name'), 'Ada Lovelace');
    await userEvent.type(canvas.getByLabelText('Work email'), 'ada@example.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(canvas.getByLabelText('Company')).toHaveFocus());
    await userEvent.type(canvas.getByLabelText('Company'), 'Analytical Engines');
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Send enquiry' })).toBeInTheDocument());
    await userEvent.click(canvas.getByRole('radio', { name: '5k to 20k' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Send enquiry' }));
    await waitFor(() => expect(canvas.getByRole('heading', { name: 'Thank you. That is with us.' })).toHaveFocus());
    // Send another starts again from the first step.
    await userEvent.click(canvas.getByRole('button', { name: 'Send another' }));
    await waitFor(() => expect(canvas.getByRole('progressbar', { name: 'Step 1 of 3' })).toBeInTheDocument());
    await expect(canvas.getByLabelText('Your name')).toHaveValue('');
  },
};

/** Steps in the dark colour with square corners: the progress line, Back and Continue square with the fields. */
export const StepsDarkSquare: Story = {
  args: { form: { ...STEPPED, look: { colour: 'dark', corners: 'square' } } },
};

/** One at a time: no card, a thin line at the top, the question large with its number, OK with its Enter keycap. */
export const Conversational: Story = {
  args: { form: ONE_BY_ONE },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('progressbar', { name: '1 of 7' })).toBeInTheDocument();
    await expect(canvas.getByRole('textbox', { name: 'Your name' })).toBeInTheDocument();
  },
};

/** Enter goes on to the next question, which takes focus; an optional one says so. */
export const ConversationalNext: Story = {
  args: { form: ONE_BY_ONE },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole('textbox', { name: 'Your name' }), 'Ada Lovelace{Enter}');
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Work email' })).toHaveFocus());
    await userEvent.type(canvas.getByRole('textbox', { name: 'Work email' }), 'ada@example.com{Enter}');
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Phone or WhatsApp (optional)' })).toHaveFocus());
    await expect(canvas.getByRole('progressbar', { name: '3 of 7' })).toBeInTheDocument();
  },
};

/** One at a time, an empty required question: its message under it, and the question stays. */
export const ConversationalError: Story = {
  args: { form: ONE_BY_ONE },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: /OK/ }));
    await waitFor(() => expect(canvas.getByText('Answer this question.')).toBeInTheDocument());
    await expect(canvas.getByRole('progressbar', { name: '1 of 7' })).toBeInTheDocument();
  },
};

/** One at a time in the dark colour. */
export const ConversationalDark: Story = {
  args: { form: { ...ONE_BY_ONE, look: { colour: 'dark', corners: 'rounded' } } },
};

/** One at a time, Enter on a chosen choice goes on, as from a text field. */
export const ConversationalChoice: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    form: {
      ...ONE_BY_ONE,
      questions: ENQUIRY.questions.filter((question) => question.key === 'budget' || question.key === 'name').reverse(),
    },
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('radio', { name: '5k to 20k' }));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(canvas.getByRole('progressbar', { name: '2 of 2' })).toBeInTheDocument());
  },
};

/**
 * A step whose Show when fails is skipped and not counted (spec 0063, AC-6312): Your company shows only for a team,
 * so a visitor working alone reads "Step 1 of 2" and goes from About you to Your project.
 */
export const StepSkipped: Story = {
  args: {
    form: {
      ...STEPPED,
      questions: [
        {
          id: 'alone',
          key: 'alone',
          label: 'Who is this for?',
          answerType: 'choice',
          choices: ['Just me', 'My team'],
          required: true,
        },
        ...ENQUIRY.questions.filter((question) => ['company', 'budget'].includes(question.key)),
      ],
      steps: [
        { id: 'you', title: 'About you', keys: ['alone'] },
        {
          id: 'company',
          title: 'Your company',
          keys: ['company'],
          showWhen: { join: 'all', rules: [{ key: 'alone', op: 'is', value: 'My team' }] },
        },
        { id: 'project', title: 'Your project', keys: ['budget'] },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('progressbar', { name: 'Step 1 of 2' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('radio', { name: 'My team' }));
    await waitFor(() => expect(canvas.getByRole('progressbar', { name: 'Step 1 of 3' })).toBeInTheDocument());
    await userEvent.click(canvas.getByRole('radio', { name: 'Just me' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(canvas.getByRole('heading', { level: 2, name: 'Your project' })).toBeInTheDocument());
    await expect(canvas.getByRole('progressbar', { name: 'Step 2 of 2' })).toBeInTheDocument();
  },
};

/** One at a time, a choice picked by pointer goes on by itself after a short pause (AC-6305). */
export const ConversationalPicks: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    form: {
      ...ONE_BY_ONE,
      questions: ENQUIRY.questions.filter((question) => question.key === 'budget' || question.key === 'name').reverse(),
    },
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('radio', { name: 'Over 20k' }));
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Your name' })).toHaveFocus());
    await expect(canvas.getByRole('progressbar', { name: '2 of 2' })).toBeInTheDocument();
  },
};

/** One at a time, a long answer: Shift and Enter breaks the line, Enter goes on (AC-6305). */
export const ConversationalLongAnswer: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    form: {
      ...ONE_BY_ONE,
      questions: ENQUIRY.questions.filter((question) => question.key === 'message' || question.key === 'name'),
    },
  },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole('textbox', { name: 'Your name' }), 'Ada{Enter}');
    const message = canvas.getByRole('textbox', { name: 'What do you need? (optional)' });
    await waitFor(() => expect(message).toHaveFocus());
    await expect(canvas.getByText('Shift + Enter for a new line')).toBeInTheDocument();
    await userEvent.type(message, 'One{Shift>}{Enter}{/Shift}Two');
    await expect(message).toHaveValue('One\nTwo');
    await expect(canvas.getByRole('progressbar', { name: '2 of 2' })).toBeInTheDocument();
  },
};
