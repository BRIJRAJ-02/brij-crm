import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { BookingPagePicture } from '../BookingPagePicture/BookingPagePicture.tsx';
import { EmbedPreview } from './EmbedPreview.tsx';

const meta = {
  title: 'Modules/EmbedPreview',
  component: EmbedPreview,
  args: {
    mode: 'inline',
    headline: 'Tell us about your team',
    words: 'Talk to us',
    label: 'How the form sits on your site',
  },
  render: (args) => (
    <Stage width="dialog">
      <EmbedPreview {...args} />
    </Stage>
  ),
} satisfies Meta<typeof EmbedPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** In the page: the form's box among the site's lines, with its headline. */
export const Inline: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'How the form sits on your site' })).toBeInTheDocument();
  },
};

/** In the page, clear, with the headline left to the site. */
export const InlineClear: Story = { args: { isTransparent: true, isTitleHidden: true } };

/** Popup: the site's own button, in its words. */
export const Popup: Story = { args: { mode: 'popup', words: 'Get a quote' } };

/** Corner button: ours, in its colour and words. */
export const Floating: Story = { args: { mode: 'floating', colour: '#0f766e' } };

/** Corner button with its mark before the words, as a booking page's snippet can ask for (`data-timefix-icon`). */
export const FloatingMarked: Story = {
  args: {
    mode: 'floating',
    mark: 'calendar',
    words: 'Book a time',
    label: 'How the booking page sits on your site',
  },
};

/** A booking page in the page: its own picture (BookingPagePicture) in the box, in place of a form's fields. */
export const BookingInline: Story = {
  args: { headline: 'Intro call', label: 'How the booking page sits on your site' },
  render: (args) => (
    <Stage width="dialog">
      <EmbedPreview
        {...args}
        content={
          <BookingPagePicture
            title="Intro call"
            lengths="30 min"
            openDays={[true, true, true, true, true, false, false]}
            hue="blue"
          />
        }
      />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'How the booking page sits on your site' })).toBeInTheDocument();
    // The picture is the page's: its title is drawn, its fields are not.
    await expect(canvas.getByText('Intro call')).toBeInTheDocument();
  },
};
