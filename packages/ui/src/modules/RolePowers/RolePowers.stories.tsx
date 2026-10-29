import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { RolePowers } from './RolePowers.tsx';

const meta = {
  title: 'Modules/RolePowers',
  component: RolePowers,
  args: {
    label: 'What an Admin can do',
    summary: 'Everyone can see and change records, and make notes, tasks and comments.',
    areas: [
      {
        id: 'records',
        title: 'Records',
        standing: 'all',
        held: ['Export records', 'Delete records forever'],
        withheld: [],
      },
      {
        id: 'capture',
        title: 'Forms and booking',
        standing: 'some',
        held: ['Build, publish and pause forms', 'Make booking pages'],
        withheld: ['Change other people’s booking pages'],
      },
      {
        id: 'workspace',
        title: 'Workspace',
        standing: 'none',
        held: [],
        withheld: ['Manage billing', 'Delete the workspace'],
      },
    ],
  },
  decorators: [
    (Story) => (
      <Stage width="dialog">
        <Story />
      </Stage>
    ),
  ],
} satisfies Meta<typeof RolePowers>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three areas, closed: one held whole, one in part, one not at all, each said in words beside its mark. */
export const Closed: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('region', { name: 'What an Admin can do' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: /Forms and booking/ })).toHaveAttribute('aria-expanded', 'false');
    await expect(canvas.getAllByText('Some')[0]).toBeInTheDocument();
    // The standing is part of the row's own name, not only the Badge beside it.
    await expect(canvas.getByRole('button', { name: /Forms and booking/ })).toHaveAccessibleName(/Some/);
    await expect(canvas.getByRole('button', { name: /Workspace/ })).toHaveAccessibleName(/None/);
  },
};

/** An area opened: what the role holds, then what it doesn't, read with "Can’t:" before it. */
export const Opened: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Forms and booking/ }));
    await expect(canvas.getByText('Make booking pages')).toBeVisible();
    await expect(canvas.getByText('Change other people’s booking pages').closest('li')).toHaveTextContent(
      'Can’t: Change other people’s booking pages',
    );
  },
};

/** No summary line: only the areas. */
export const WithoutSummary: Story = {
  args: { summary: undefined },
  parameters: { crm: { screenshot: false } },
};

/** While the role is read: skeleton rows, busy. */
export const Loading: Story = {
  args: { isLoading: true },
};
