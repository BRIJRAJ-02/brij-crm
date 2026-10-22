import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { WorkspacePreview } from './WorkspacePreview.tsx';

const meta = {
  title: 'Modules/WorkspacePreview',
  component: WorkspacePreview,
  args: {
    workspaceName: 'Halcyon Labs',
    workspaceId: '0199a6f2-0000-7000-8000-000000000002',
    personName: 'Maya Chen',
    personId: '0199a6f2-0000-7000-8000-000000000003',
  },
  // The preview fills its slot; each story gives it first run's: the split card's right half.
  render: (args) => (
    <Stage width="phone" height="page">
      <WorkspacePreview {...args} />
    </Stage>
  ),
} satisfies Meta<typeof WorkspacePreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Both names typed, with the workspace ringed (Your workspace). It is decoration, out of the accessibility tree. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  args: { focus: 'workspace' },
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector('[aria-hidden="true"]');
    await expect(root).not.toBeNull();
    await expect(root?.textContent).toContain('Halcyon Labs');
    await expect(canvasElement.querySelectorAll('[data-focused]')).toHaveLength(1);
  },
};

/** Sign in's sketch: a sample workspace with a People table, before anyone has typed. */
export const Sample: Story = {
  args: { workspaceName: '', personName: '', sample: true },
  // New on 22 October 2026: its baseline comes with the next `pnpm test:visual --update`.
  parameters: { crm: { screenshot: false } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[aria-hidden="true"]')).not.toBeNull();
    await expect(canvasElement.textContent).toContain('Halcyon Labs');
    await expect(canvasElement.textContent).toContain('Ada Lovelace');
  },
};

/** Nothing typed yet: bars stand in for both names and their avatars; the rows keep the app's labels. */
export const Empty: Story = {
  args: { workspaceName: '', personName: '', focus: 'person' },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent).not.toContain('Halcyon Labs');
    await expect(canvasElement.textContent).not.toContain('Maya Chen');
    await expect(canvasElement.textContent).toContain('Home');
  },
};

/** About you: the person at the foot is ringed, named as typed. */
export const PersonFocused: Story = {
  args: { workspaceName: '', focus: 'person' },
};

/** Connect your calendar: the calendar row is ringed. */
export const CalendarFocused: Story = {
  args: { focus: 'calendar' },
};

/** About you: the areas picked (Booking meetings, Forms) add their rows to the sketch's sidebar, ringed. */
export const AreasFocused: Story = {
  args: { workspaceName: '', focus: 'areas', areas: ['booking', 'forms'] },
};

/** A long workspace name is cut with an ellipsis rather than pushing the sketch wider. */
export const LongName: Story = {
  args: { workspaceName: 'The Halcyon Laboratories for Applied Research and Development', focus: 'workspace' },
};
