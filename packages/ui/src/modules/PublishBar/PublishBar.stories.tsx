import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { settleAnimations } from '../../workbench/animations.ts';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { PublishBar, PublishBarSkeleton, type PublishBarStatus } from './PublishBar.tsx';

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

/** While the editor loads: the bar's strip and height, its status a skeleton line. */
export const Loading: Story = {
  render: () => (
    <Stage width="fill">
      <PublishBarSkeleton />
    </Stage>
  ),
};

/** Paused with nothing to publish: the bar says guests can't book it, with a pause, and never claims live. */
export const Paused: Story = {
  args: { status: 'live', changes: [], isPaused: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Paused: guests can’t book this page');
    await expect(canvas.queryByText(/Live/)).toBeNull();
  },
};

/** Paused with changes: the count stays, and nothing says live. */
export const PausedWithChanges: Story = {
  args: { isPaused: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('3 changes not published');
    await expect(canvas.queryByText(/Live/)).toBeNull();
  },
};

/** One change: the count in the singular. */
export const OneChange: Story = {
  args: { changes: ['Length 30 min → 45 min'] },
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('1 change not published');
  },
};

/** Just published: a plain check and Published, Publish disabled; the caller puts the bar back to live. */
export const Published: Story = {
  args: { status: 'published' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('Published');
    await expect(canvas.getByRole('button', { name: 'Published' })).toBeDisabled();
  },
};

/** Publishing: Publish holds its place with its spinner, and Discard waits. */
export const Publishing: Story = { args: { status: 'publishing' } };

/** Refused: one line saying why, and the way to the setting to fix. Publish keeps its name. */
export const Refused: Story = {
  args: {
    status: 'error',
    problem: { message: 'Pick hours for this page.', fix: { label: 'Go to Hours', onFix: fn() } },
  },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('Pick hours for this page.');
    await expect(canvas.getByRole('button', { name: 'Publish' })).toBeEnabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Go to Hours' }));
    await expect(args.problem?.fix?.onFix).toHaveBeenCalled();
  },
};

/** Refused on a phone: the reason comes first, above the status and the buttons. */
export const RefusedPhone: Story = {
  args: Refused.args,
  render: (args) => (
    <Stage width="phone">
      <PublishBar {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    const alert = canvas.getByRole('alert');
    const status = canvas.getByRole('status');
    await expect(alert.getBoundingClientRect().bottom).toBeLessThanOrEqual(status.getBoundingClientRect().top);
  },
};

/** A phone's width with changes waiting: the buttons wrap under the count. */
export const DraftPhone: Story = {
  render: (args) => (
    <Stage width="phone">
      <PublishBar {...args} />
    </Stage>
  ),
};

/** Discard draft asks first ("Discard the draft?"), and Keep the draft keeps it. */
export const DiscardAsks: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Discard draft' }));
    const dialog = within(document.body).getByRole('alertdialog');
    await settleAnimations();
    await expect(within(dialog).getByRole('heading', { name: 'Discard the draft?' })).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep the draft' }));
    await expect(args.onDiscard).not.toHaveBeenCalled();
  },
};

/** Discard draft in the confirm drops the draft. */
export const DiscardDrops: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Discard draft' }));
    const dialog = within(document.body).getByRole('alertdialog');
    await settleAnimations();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard draft' }));
    await expect(args.onDiscard).toHaveBeenCalled();
  },
};

/** Publish → Published: the check and Published crossfade in, Publish says so too. */
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
