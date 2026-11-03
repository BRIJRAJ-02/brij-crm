import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { PublishBar, type PublishBarStatus } from './PublishBar.tsx';

const CHANGES = ['Title “Intro” → “Intro call”', 'Length 30 min → 45 min', 'Social links hidden'];

const VERSIONS = [
  { version: 4, label: 'Ada Lovelace · 3 Nov, 14:30', isCurrent: true },
  { version: 3, label: 'Ada Lovelace · 1 Nov, 09:12', isCurrent: false },
  { version: 2, label: 'Grace Hopper · 28 Oct, 17:05', isCurrent: false },
];

const meta = {
  title: 'Modules/PublishBar',
  component: PublishBar,
  args: {
    status: 'draft',
    changes: CHANGES,
    onPublish: fn(),
    onDiscard: fn(),
    onVersions: fn(),
    onRestore: fn(),
    versions: VERSIONS,
    previewHref: '/b/TOBGzXsRIi0MaACw?preview=draft',
  },
  render: (args) => (
    <Stage width="fill">
      <PublishBar {...args} />
    </Stage>
  ),
} satisfies Meta<typeof PublishBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Changes waiting: the count, Changes, Versions, Preview, Discard and Publish; Changes opens the list. */
export const Draft: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('3 changes not published');
    await userEvent.click(canvas.getByRole('button', { name: 'Changes' }));
    await expect(canvas.getByText('Length 30 min → 45 min')).toBeVisible();
  },
};

/** Nothing to publish: the page is live, and Versions stays. */
export const Live: Story = { args: { status: 'live', changes: [] } };

/** Publishing: Publish holds its place with its spinner, and Discard waits. */
export const Publishing: Story = { args: { status: 'publishing' } };

/** Refused: one line saying why, and the way to the setting to fix. */
export const Refused: Story = {
  args: {
    status: 'error',
    problem: { message: 'Pick hours for this page.', fix: { label: 'Go to Hours', onFix: fn() } },
  },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('Pick hours for this page.');
    await userEvent.click(canvas.getByRole('button', { name: 'Go to Hours' }));
    await expect(args.problem?.fix?.onFix).toHaveBeenCalled();
  },
};

/** Discard asks first, and Keep them keeps them. */
export const DiscardAsks: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Discard' }));
    const dialog = within(document.body).getByRole('alertdialog');
    await settleAnimations();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep them' }));
    await expect(args.onDiscard).not.toHaveBeenCalled();
  },
};

/** Publish → Published: the check draws, the label says so, and the bar goes back to live. */
export const PublishToPublished: Story = {
  render: function PublishToPublished(args) {
    const [status, setStatus] = useState<PublishBarStatus>('draft');
    return (
      <Stage width="fill">
        <PublishBar
          {...args}
          status={status}
          changes={status === 'live' ? [] : CHANGES}
          onPublish={() => {
            setStatus('publishing');
            setTimeout(() => setStatus('published'), 300);
          }}
        />
      </Stage>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Publish' }));
    await expect(await canvas.findByRole('button', { name: 'Published' })).toBeDisabled();
  },
};
