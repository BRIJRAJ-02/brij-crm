import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { Button } from '../../atoms/Button/Button.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { LinkList, type LinkRow } from './LinkList.tsx';

function rows(): LinkRow[] {
  return [
    {
      id: 'intro',
      title: 'Intro call',
      address: '/b/Xy12AbCdEfGh3456',
      chips: ['30 min', '60 min'],
      actions: <Button variant="ghost" icon="copy" label="Copy link to Intro call" />,
    },
    {
      id: 'visit',
      title: 'Site visit',
      tag: 'Off',
      address: '/b/Qw98ZxCvBnMm7654',
      chips: ['90 min', 'Own hours', 'In person'],
      actions: <Button variant="ghost" icon="copy" label="Copy link to Site visit" />,
    },
  ];
}

const meta = {
  title: 'Modules/LinkList',
  component: LinkList,
  args: { label: 'Booking pages', rows: [], onOpen: fn() },
} satisfies Meta<typeof LinkList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two pages, one off; pressing a title opens it. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <LinkList {...args} rows={rows()} />
    </Stage>
  ),
  play: async ({ canvas, args }) => {
    await expect(canvas.getByText('Off')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Site visit' }));
    await expect(args.onOpen).toHaveBeenCalledWith('visit');
  },
};

/** No pages yet: the caller's empty state. */
export const Empty: Story = {
  render: (args) => (
    <Stage>
      <LinkList
        {...args}
        emptyState={<EmptyState title="No booking pages yet">Make one and share its link.</EmptyState>}
      />
    </Stage>
  ),
};
