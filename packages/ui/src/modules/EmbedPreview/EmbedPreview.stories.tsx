import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
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
