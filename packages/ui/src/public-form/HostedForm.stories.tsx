import { formStrings, type PublicForm } from '@crm/contracts/forms';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { Stage } from '../workbench/Stage/Stage.tsx';
import { FormLoading, HostedForm } from './HostedForm.tsx';

/** The owner's form: name, work email, phone and a size, as a new form starts with one dropdown added. */
const LEAD = {
  key: 'contact-us',
  status: 'live',
  versionNumber: 3,
  headline: 'Fill this in and we will come back to you',
  buttonText: 'Send',
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
    {
      id: 'phone',
      key: 'phone',
      label: 'Phone or WhatsApp',
      answerType: 'phone',
      placeholder: '555 000 1234',
      required: false,
    },
    {
      id: 'size',
      key: 'size',
      label: 'Size',
      answerType: 'dropdown',
      choices: ['Just me', '2 to 10', '11 to 50', '51 to 200', 'Over 200'],
      required: false,
    },
  ],
} satisfies PublicForm;

/** Every answer type a form can ask, for the whole field rhythm. */
const EVERY_TYPE: PublicForm = {
  ...LEAD,
  key: 'every-type',
  headline: 'Tell us about your project',
  buttonText: 'Send enquiry',
  questions: [
    ...LEAD.questions.slice(0, 2),
    { id: 'company', key: 'company', label: 'Company', answerType: 'short_text', required: true },
    { id: 'site', key: 'site', label: 'Website', answerType: 'website', placeholder: 'acme.com', required: false },
    { id: 'country', key: 'country', label: 'Country', answerType: 'country', required: false },
    {
      id: 'budget',
      key: 'budget',
      label: 'Budget',
      answerType: 'choice',
      choices: ['Under 5k', '5k to 20k', 'Over 20k'],
      required: true,
    },
    { id: 'message', key: 'message', label: 'Anything else?', answerType: 'long_text', required: false },
    { id: 'updates', key: 'updates', label: 'Send me product updates', answerType: 'checkbox', required: false },
  ],
};

/** A stand in wordmark, 860 by 210 like the product's, drawn in one fill. */
const wordmark = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 210"><rect x="0" y="40" width="130" height="130" rx="65" fill="${fill}"/><rect x="170" y="70" width="660" height="70" rx="12" fill="${fill}"/></svg>`,
  )}`;

const never = () => new Promise<never>(() => undefined);

const meta = {
  title: 'Public form/HostedForm',
  component: HostedForm,
  args: {
    form: { ...LEAD, subheading: 'We answer within one working day.' },
    mode: 'page',
    logo: { light: wordmark('black'), dark: wordmark('white') },
  },
  render: (args) => (
    <Stage width="fill">
      <HostedForm {...args} />
    </Stage>
  ),
} satisfies Meta<typeof HostedForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Classic on its own page: the headline, the questions with "(optional)" after the optional ones, "Choose one" in the empty dropdown. */
/**
 * Before the form has been read: the same ground, the same card, and the places the headline, the questions and
 * the button will take. It carries no theme of its own, since the form's Colour is not known yet.
 */
export const Loading: Story = {
  render: () => (
    <Stage width="fill">
      <FormLoading mode="page" words={formStrings('en')} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector('[data-frame="card"]');
    await expect(card?.getAttribute('aria-busy')).toBe('true');
    await expect(card?.hasAttribute('data-theme')).toBe(false);
    await expect(canvasElement.querySelectorAll('[data-shape="field"]')).toHaveLength(4);
  },
};

export const Classic: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: LEAD.headline })).toBeInTheDocument();
    await expect(canvas.getByLabelText('Phone or WhatsApp (optional)')).toBeInTheDocument();
    await expect(canvas.getByText('Choose one')).toBeInTheDocument();
    await expect(canvas.queryByText('Prefer not to say')).not.toBeInTheDocument();
  },
};

/** Every answer type in one column: the rhythm, the radio group's own "(optional)", a tick box never marked. */
export const EveryType: Story = {
  args: { form: EVERY_TYPE },
};

/** Spec 0063's first batch, filled: a date, a time, a rating, a scale with its end words, a multi select with Other open, an address. */
const NEW_TYPES = {
  ...LEAD,
  key: 'new-types',
  headline: 'Book your onboarding',
  questions: [
    {
      id: 'start',
      key: 'start',
      label: 'Start date',
      answerType: 'date',
      required: true,
      options: { earliest: '2026-11-01' },
    },
    { id: 'slot', key: 'slot', label: 'Best time to call', answerType: 'time', required: false },
    { id: 'fit', key: 'fit', label: 'How well do we fit?', answerType: 'rating', required: true },
    {
      id: 'nps',
      key: 'nps',
      label: 'How likely are you to recommend us?',
      answerType: 'scale',
      required: true,
      options: { from: 0, to: 10, lowLabel: 'Not likely', highLabel: 'Very likely' },
    },
    {
      id: 'teams',
      key: 'teams',
      label: 'Which teams will use it?',
      answerType: 'multi_select',
      choices: ['Sales', 'Support', 'Marketing'],
      required: true,
      options: { other: true },
    },
    { id: 'office', key: 'office', label: 'Office address', answerType: 'address', required: false },
    { id: 'source', key: 'utm_campaign', label: 'Campaign', answerType: 'hidden', required: false },
  ],
} satisfies PublicForm;

/** The new answer types (spec 0063, AC-6307), each with the library's own control; the hidden one draws nothing. */
export const NewTypes: Story = {
  args: { form: NEW_TYPES, prefill: { teams: ['Sales', 'Nope'], nps: '9' } },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByLabelText('Start date')).toHaveAttribute('type', 'date');
    await expect(canvas.getByLabelText('Start date')).toHaveAttribute('min', '2026-11-01');
    // The rating and the scale are radio groups named by their question, the scale's end words read with it.
    await expect(canvas.getByRole('radiogroup', { name: 'How well do we fit?' })).toBeInTheDocument();
    const scale = canvas.getByRole('radiogroup', { name: 'How likely are you to recommend us?' });
    await expect(scale).toHaveAccessibleDescription('Not likely Very likely');
    // The link's answers: a scale's number and a multi select's pick by its words (one it lacks ignored).
    await expect(canvas.getByRole('radio', { name: '9' })).toBeChecked();
    await expect(canvas.getByRole('button', { name: 'Sales' })).toHaveAttribute('aria-pressed', 'true');
    // Other opens its box.
    await userEvent.click(canvas.getByRole('button', { name: 'Other' }));
    await expect(canvas.getByLabelText('Other, in your words')).toBeInTheDocument();
    await expect(canvas.getByRole('group', { name: 'Office address (optional)' })).toBeInTheDocument();
    await expect(canvas.queryByText('Campaign')).not.toBeInTheDocument();
  },
};

/** Inside a site's frame: an h2 at heading size, no card, no ground. */
export const Embed: Story = {
  args: { mode: 'embed' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: LEAD.headline })).toBeInTheDocument();
  },
};

/** Dark colour and square corners: the whole of a form's look. */
export const DarkSquare: Story = {
  args: { form: { ...LEAD, look: { colour: 'dark', corners: 'square' } } },
};

/** Send with nothing filled: each required question says so, the summary lists them as links, the first takes focus. */
export const Errors: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(canvas.getByLabelText('Your name')).toHaveFocus());
    await expect(canvas.getAllByText('Answer this question.')).toHaveLength(2);
    await waitFor(() => expect(canvas.getByText('2 answers need a look')).toBeInTheDocument());
    // A summary link takes focus to its question.
    await userEvent.click(canvas.getByRole('link', { name: 'Work email' }));
    await waitFor(() => expect(canvas.getByLabelText('Work email')).toHaveFocus());
    // Fixing one clears its error and shortens the summary at once.
    await userEvent.type(canvas.getByLabelText('Work email'), 'ada@example.com');
    await waitFor(() => expect(canvas.getByText('1 answer needs a look')).toBeInTheDocument());
  },
};

/** The checker: an answer is checked as focus leaves it, never while typing. */
export const CheckedOnBlur: Story = {
  play: async ({ canvas }) => {
    const email = canvas.getByLabelText('Work email');
    await userEvent.type(email, 'ada@');
    await expect(canvas.queryByText('Enter an email address, such as ada@example.com.')).not.toBeInTheDocument();
    await userEvent.tab();
    await waitFor(() =>
      expect(canvas.getByText('Enter an email address, such as ada@example.com.')).toBeInTheDocument(),
    );
    // A required answer emptied again says so as focus leaves it.
    const name = canvas.getByLabelText('Your name');
    await userEvent.type(name, 'Ada');
    await userEvent.clear(name);
    await userEvent.tab();
    await waitFor(() => expect(canvas.getByText('Answer this question.')).toBeInTheDocument());
  },
};

/** A misspelt provider gets a hint with Use it, which fixes the address. */
export const EmailHint: Story = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByLabelText('Work email'), 'ada@gmial.com');
    await userEvent.tab();
    await waitFor(() => expect(canvas.getByText('Did you mean ada@gmail.com?')).toBeInTheDocument());
    await userEvent.click(canvas.getByRole('button', { name: 'Use it' }));
    await waitFor(() => expect(canvas.getByLabelText('Work email')).toHaveValue('ada@gmail.com'));
    await expect(canvas.queryByText('Did you mean ada@gmail.com?')).not.toBeInTheDocument();
  },
};

/** While sending: the button keeps its width, shows the spinner and reads "Sending". */
export const Sending: Story = {
  args: { onSubmit: never },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByLabelText('Your name'), 'Ada Lovelace');
    await userEvent.type(canvas.getByLabelText('Work email'), 'ada@example.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(canvas.getByRole('button', { name: /Sending/ })).toBeInTheDocument());
  },
};

/** A send that failed for a reason that isn't about a question: one alert line above the button. */
export const Failed: Story = {
  args: { onSubmit: () => Promise.resolve({ kind: 'failed' as const }) },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByLabelText('Your name'), 'Ada Lovelace');
    await userEvent.type(canvas.getByLabelText('Work email'), 'ada@example.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent('That did not go through. Try again in a moment.'),
    );
  },
};

/** The thank you replaces the form, with focus on its heading; Send another starts again. */
export const Thanks: Story = {
  args: {
    onSubmit: () => Promise.resolve({ kind: 'done' as const, next: { kind: 'message' as const, text: '' } }),
  },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByLabelText('Your name'), 'Ada Lovelace');
    await userEvent.type(canvas.getByLabelText('Work email'), 'ada@example.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(canvas.getByRole('heading', { name: 'Thank you. That is with us.' })).toHaveFocus());
    await expect(canvas.getByText('We will come back to you at the address you gave.')).toBeInTheDocument();
  },
};

/** A form that stopped taking enquiries. */
export const Paused: Story = {
  args: { form: { ...LEAD, status: 'paused', questions: [] } },
};

/** Tabbing through every question with nothing typed says nothing, a required tick box included: it waits for Send. */
export const TabThroughIsQuiet: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    form: {
      ...LEAD,
      questions: [
        ...LEAD.questions.slice(0, 2),
        { id: 'terms', key: 'terms', label: 'I agree to be contacted', answerType: 'checkbox', required: true },
      ],
    },
  },
  play: async ({ canvas }) => {
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await expect(canvas.queryByText('Answer this question.')).not.toBeInTheDocument();
    await expect(canvas.queryByText('Tick this to go on.')).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(canvas.getByText('Tick this to go on.')).toBeInTheDocument());
  },
};

/** A form that asks for no email or phone thanks without promising to write back. */
export const ThanksWithoutAddress: Story = {
  parameters: { crm: { screenshot: false } },
  args: { form: { ...LEAD, questions: LEAD.questions.slice(0, 1) } },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByLabelText('Your name'), 'Ada Lovelace');
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(canvas.getByText('We have it, and the team will read it shortly.')).toBeInTheDocument());
  },
};

const booking = (seconds: number) => () =>
  Promise.resolve({
    kind: 'done' as const,
    next: { kind: 'booking' as const, url: '/b/intro-call?p=token', countdownSeconds: seconds, text: '' },
  });

/** Sent, and on to book: "Taking you to book a time in 30…" with the ring draining, Book now and Stay here (AC-1059). */
export const BookAfter: Story = {
  // The ring and the number move with time, so no screenshot.
  parameters: { crm: { screenshot: false } },
  args: { onSubmit: booking(30), onRedirect: fn() },
  play: async ({ canvas, args }) => {
    await userEvent.type(canvas.getByLabelText('Your name'), 'Ada Lovelace');
    await userEvent.type(canvas.getByLabelText('Work email'), 'ada@example.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(canvas.getByRole('heading', { name: 'Thank you. That is with us.' })).toHaveFocus());
    await expect(canvas.getByRole('button', { name: 'Book now' })).toBeInTheDocument();
    await expect(args.onRedirect).not.toHaveBeenCalled();
  },
};

/** After Stay here: the countdown is gone and Book a time stays for later. */
export const BookAfterStayed: Story = {
  args: { onSubmit: booking(30), onRedirect: fn() },
  play: async ({ canvas, args }) => {
    await userEvent.type(canvas.getByLabelText('Your name'), 'Ada Lovelace');
    await userEvent.type(canvas.getByLabelText('Work email'), 'ada@example.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Stay here' }));
    // The one button now reads Book a time, and focus stays on it.
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Book a time' })).toHaveFocus());
    await userEvent.click(canvas.getByRole('button', { name: 'Book a time' }));
    await expect(args.onRedirect).toHaveBeenCalledWith('/b/intro-call?p=token');
  },
};

/** A countdown of nought: "Taking you to book a time…", and off at once. */
export const BookAfterAtOnce: Story = {
  args: { onSubmit: booking(0), onRedirect: fn() },
  play: async ({ canvas, args }) => {
    await userEvent.type(canvas.getByLabelText('Your name'), 'Ada Lovelace');
    await userEvent.type(canvas.getByLabelText('Work email'), 'ada@example.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(args.onRedirect).toHaveBeenCalledWith('/b/intro-call?p=token'));
    await expect(canvas.getAllByText('Taking you to book a time…').length).toBeGreaterThan(0);
  },
};

/** Show when (spec 0043): Team size shows only once the budget is Large, and a hidden required question never blocks Send. */
export const ShowWhen: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    onSubmit: fn(() => Promise.resolve({ kind: 'done' as const, next: { kind: 'message' as const, text: '' } })),
    form: {
      ...LEAD,
      questions: [
        {
          id: 'budget',
          key: 'budget',
          label: 'Budget',
          answerType: 'choice',
          choices: ['Small', 'Large'],
          required: true,
        },
        {
          id: 'team',
          key: 'team',
          label: 'Team size',
          answerType: 'number',
          required: true,
          showWhen: { join: 'all', rules: [{ key: 'budget', op: 'is', value: 'Large' }] },
        },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByLabelText('Team size')).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('radio', { name: 'Large' }));
    await expect(await canvas.findByLabelText('Team size')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('radio', { name: 'Small' }));
    await waitFor(() => expect(canvas.queryByLabelText('Team size')).not.toBeInTheDocument());
  },
};
