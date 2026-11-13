import type { PublicForm } from '@crm/contracts/forms';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { TileGrid } from '../../molecules/TileGrid/TileGrid.tsx';
import { FormLayoutThumbnail } from './FormLayoutThumbnail.tsx';
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

/**
 * A brand kit in the app (Settings › Brand's preview), at the app's scale: the primary button takes the form's accent
 * inside a guest page, so the brand's colour reaches Send there too (spec 0072).
 */
export const Branded: Story = {
  parameters: { crm: { screenshot: false } },
  args: {
    form: CONTACT,
    brand: {
      variables: [
        ['--brand-accent', '#e65708'],
        ['--brand-on-accent', '#000000'],
        ['--brand-link', '#b74300'],
        ['--brand-accent-dark', '#e8590c'],
        ['--brand-on-accent-dark', '#000000'],
        ['--brand-link-dark', '#fd6c2b'],
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(document.documentElement).toHaveAttribute('data-scale', 'app');
    await expect(getComputedStyle(canvas.getByRole('button', { name: 'Send' })).backgroundColor).toBe(
      'rgb(230, 87, 8)',
    );
  },
};

/** An ending open in the builder: its words in the form's place, as the visitor reads them after sending. */
export const Ending: Story = {
  args: { form: CONTACT, ending: { heading: 'Thanks, we’ll call you', line: 'Usually within a day.' } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Thanks, we’ll call you')).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Send' })).toBeNull();
  },
};

/** The plain thank you open in the builder. */
export const ThankYou: Story = {
  args: { form: CONTACT, ending: {} },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Thanks, we got it.')).toBeInTheDocument();
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
    await waitFor(() => expect(canvas.getByRole('heading', { name: 'Thanks, we got it.' })).toHaveFocus());
    // Nothing to send again (T23).
    await expect(canvas.queryByRole('button', { name: 'Send another' })).toBeNull();
  },
};

/** A form that stopped taking enquiries. */
export const Paused: Story = {
  args: { form: { ...CONTACT, status: 'paused', questions: [] }, mode: 'page' },
  parameters: { crm: { screenshot: false } },
};

/** The preview in Steps (spec 0063): the first step, its progress line and Continue, as the visitor gets it. */
export const InSteps: Story = {
  args: {
    form: {
      ...CONTACT,
      layout: 'steps',
      steps: [
        { keys: ['name', 'email', 'phone'] },
        { id: 'more', title: 'About your project', keys: ['country', 'budget', 'message', 'updates'] },
      ],
    },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('progressbar', { hidden: true, name: 'Step 1 of 2' })).toBeInTheDocument();
  },
};

/** The preview pointed at the step being edited (`step`), as the builder does when a divider or question opens. */
export const InStepsSecond: Story = {
  args: { ...InSteps.args, step: 1 },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('progressbar', { hidden: true, name: 'Step 2 of 2' })).toBeInTheDocument();
  },
};

/** The preview one question at a time: the first question, large, with no card. */
export const OneAtATime: Story = {
  args: { form: { ...CONTACT, layout: 'conversational' } },
};

/**
 * The three layouts in miniature (FormLayoutThumbnail), as the editor's Layout tiles draw them: Classic, Steps and
 * One at a time, Steps chosen.
 */
export const LayoutTiles: Story = {
  render: () => (
    <Stage width="narrow">
      <TileGrid
        variant="choice"
        label="Layout"
        value="steps"
        tiles={[
          { id: 'classic', name: 'Classic', thumbnail: <FormLayoutThumbnail layout="classic" /> },
          { id: 'steps', name: 'Steps', thumbnail: <FormLayoutThumbnail layout="steps" /> },
          { id: 'conversational', name: 'One at a time', thumbnail: <FormLayoutThumbnail layout="conversational" /> },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('radio', { name: 'Steps' })).toBeChecked();
  },
};

/**
 * The form small (size="thumbnail"), a picture of it on a choice tile: the form template gallery's cards (forms
 * fixes 3, after Miro's template grid). Laid out at a panel's width, shown at half size, cropped to the tile.
 */
export const Thumbnail: Story = {
  render: () => (
    <Stage width="fill">
      <TileGrid
        variant="choice"
        label="Start a form"
        showsDescription
        keepsPicture
        pictureSize="large"
        value="contact"
        tiles={[
          {
            id: 'contact',
            name: 'Contact us',
            description: 'Name, email and a message.',
            thumbnail: <HostedFormPreview form={CONTACT} size="thumbnail" />,
          },
          {
            id: 'dark',
            name: 'Contact us, dark',
            description: 'The same form in its dark look.',
            thumbnail: (
              <HostedFormPreview form={{ ...CONTACT, look: { colour: 'dark', corners: 'square' } }} size="thumbnail" />
            ),
          },
        ]}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('radio', { name: 'Contact us' })).toBeChecked();
  },
};

/**
 * A template's own answers in miniature (`rows`), as the form template gallery's tiles draw them (spec 0063,
 * AC-6323): every tile keeps its tall preview and takes its name and purpose underneath, so the shapes say what
 * kind of form it is while the line says what it is for.
 */
export const TemplateTiles: Story = {
  render: () => (
    <Stage width="narrow">
      <TileGrid
        variant="choice"
        mode="action"
        label="Start a form"
        showsDescription
        keepsPicture
        tiles={[
          {
            id: 'blank',
            name: 'Blank form',
            thumbnail: <FormLayoutThumbnail layout="classic" rows={['field', 'field', 'field']} />,
            description: 'Name, email and phone, to change as you like.',
          },
          {
            id: 'feedback',
            name: 'Feedback',
            thumbnail: <FormLayoutThumbnail layout="classic" rows={['field', 'rating', 'long']} />,
            description: 'A rating and one open question, so you hear why as well as how much.',
          },
          {
            id: 'nps',
            name: 'Recommendation score (NPS)',
            thumbnail: <FormLayoutThumbnail layout="classic" rows={['field', 'scale', 'long']} />,
            description: '0 to 10, and room to say why.',
          },
          {
            id: 'support_request',
            name: 'Support request',
            thumbnail: <FormLayoutThumbnail layout="classic" rows={['field', 'long', 'choices']} />,
            description: 'What broke, how urgent it is, and a screenshot to go with it.',
          },
          {
            id: 'customer_onboarding',
            name: 'Customer onboarding',
            thumbnail: <FormLayoutThumbnail layout="steps" rows={['field', 'field', 'date']} />,
            description: 'Asked a step at a time, so a long form still gets finished.',
          },
        ]}
        onAction={() => undefined}
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    // Both halves are on the tile, not in a tooltip: the preview to look at and the line to read.
    await expect(canvas.getByRole('button', { name: 'Feedback' })).toHaveAccessibleDescription(
      'A rating and one open question, so you hear why as well as how much.',
    );
    await expect(canvas.getByText('0 to 10, and room to say why.')).toBeVisible();
  },
};

/** The headline and the button edited where they are (T21, as Tally does): press either to type its words. */
function EditableSample() {
  const [form, setForm] = useState(CONTACT);
  return (
    <Stage width="narrow-fill">
      <HostedFormPreview
        form={form}
        onTextChange={(change) => {
          setForm((before) => ({ ...before, ...change }));
        }}
      />
    </Stage>
  );
}

/** Pressing the headline opens its words by it; typing changes the preview, and Escape closes it. */
export const EditableText: Story = {
  args: { form: CONTACT },
  parameters: { crm: { screenshot: false } },
  render: () => <EditableSample />,
  play: async ({ canvas }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Edit the headline' }));
    const headline = within(document.body).getByRole('textbox', { name: 'Headline' });
    await userEvent.clear(headline);
    await userEvent.type(headline, 'Talk to us');
    await waitFor(() => expect(canvas.getByRole('heading', { name: 'Talk to us' })).toBeInTheDocument());
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await canvas.findByRole('button', { name: 'Edit the button' }));
    await expect(within(document.body).getByRole('textbox', { name: 'Button text' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
  },
};
