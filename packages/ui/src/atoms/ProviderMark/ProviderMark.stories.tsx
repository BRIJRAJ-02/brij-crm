import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Button } from '../Button/Button.tsx';
import { ProviderMark, type ProviderName } from './ProviderMark.tsx';

const meta = {
  title: 'Atoms/ProviderMark',
  component: ProviderMark,
  args: { provider: 'google' },
} satisfies Meta<typeof ProviderMark>;

export default meta;
type Story = StoryObj<typeof meta>;

const ALL: readonly ProviderName[] = ['google', 'google-calendar', 'outlook', 'apple-calendar', 'timefix'];

const SOCIAL: readonly ProviderName[] = [
  'linkedin',
  'x',
  'instagram',
  'github',
  'facebook',
  'youtube',
  'angellist',
  'tiktok',
  'threads',
];

/** Every brand's mark, labelled, at both sizes. Each is the brand's own artwork; only Timefix's swaps by theme. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: () => (
    <Stage>
      {ALL.map((provider) => (
        <ProviderMark key={provider} provider={provider} isLabelled />
      ))}
      {ALL.map((provider) => (
        <ProviderMark key={`${provider}-sm`} provider={provider} size="sm" isLabelled />
      ))}
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('img', { name: 'Google' })).toHaveLength(2);
    await expect(canvas.getAllByRole('img', { name: 'Google Calendar' })).toHaveLength(2);
    await expect(canvas.getAllByRole('img', { name: 'Outlook' })).toHaveLength(2);
    await expect(canvas.getAllByRole('img', { name: 'Apple Calendar' })).toHaveLength(2);
    await expect(canvas.getAllByRole('img', { name: 'Timefix' })).toHaveLength(2);
  },
};

/** Beside a label that names the brand, the mark is decoration and out of the accessibility tree. */
export const Decorative: Story = {
  render: () => (
    <Stage>
      <ProviderMark provider="google" />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('img')).toBeNull();
  },
};

/** In Buttons, through `provider`: the mark sits where the icon goes, and the label names the action. */
export const InButtons: Story = {
  render: () => (
    <Stage direction="column">
      <Button provider="google" size="lg" isFullWidth="center">
        Continue with Google
      </Button>
      <Button provider="google-calendar">Add to Google Calendar</Button>
      <Button provider="outlook">Add to Outlook</Button>
      <Button provider="apple-calendar">Add to Apple Calendar</Button>
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    await expect(canvas.queryByRole('img')).toBeNull();
  },
};

/** `lg`, the 20px slot of a workspace's square avatar: the Timefix mark heading the app's sidebar. */
export const Large: Story = {
  render: () => (
    <Stage>
      <ProviderMark provider="timefix" size="lg" isLabelled />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const mark = canvas.getByRole('img', { name: 'Timefix' });
    const shown = [...mark.querySelectorAll('img')].find((image) => image.getBoundingClientRect().width > 0);
    await expect(shown?.getBoundingClientRect().width).toBe(20);
  },
};

/** The social networks' marks, labelled, at both sizes: a profile link's mark (the url field). The black ones swap by theme. */
export const Social: Story = {
  render: () => (
    <Stage>
      {SOCIAL.map((provider) => (
        <ProviderMark key={provider} provider={provider} isLabelled />
      ))}
      {SOCIAL.map((provider) => (
        <ProviderMark key={`${provider}-sm`} provider={provider} size="sm" isLabelled />
      ))}
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('img', { name: 'LinkedIn' })).toHaveLength(2);
    await expect(canvas.getAllByRole('img', { name: 'X' })).toHaveLength(2);
    await expect(canvas.getAllByRole('img', { name: 'GitHub' })).toHaveLength(2);
  },
};

/** The social networks' shapes in the text colour (`tone="mono"`), as a link page's social links draw them: one set. */
export const Mono: Story = {
  render: () => (
    <Stage>
      {SOCIAL.map((provider) => (
        <ProviderMark key={provider} provider={provider} tone="mono" isLabelled />
      ))}
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'LinkedIn' })).toBeVisible();
    await expect(canvas.getAllByRole('img')).toHaveLength(SOCIAL.length);
  },
};
