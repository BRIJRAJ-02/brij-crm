import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor } from 'storybook/test';
import { InfoTip } from '../../molecules/InfoTip/InfoTip.tsx';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import type { InviteRow } from './invite-rows.ts';
import { InviteRows, type InviteRole, type InviteRowsProps } from './InviteRows.tsx';

const ROLES: readonly InviteRole[] = [
  { id: 'admin', label: 'Admin' },
  { id: 'member', label: 'Member' },
  { id: 'guest', label: 'Guest' },
];

/** Holds the rows as a screen would, starting from `rows`. */
function Held(props: Omit<InviteRowsProps, 'onChange'> & { readonly onChange?: (rows: readonly InviteRow[]) => void }) {
  const [rows, setRows] = useState(props.rows);
  return (
    <Stage width="narrow-fill">
      <InviteRows
        {...props}
        rows={rows}
        onChange={(next) => {
          setRows(next);
          props.onChange?.(next);
        }}
      />
    </Stage>
  );
}

const meta = {
  title: 'Modules/InviteRows',
  component: InviteRows,
  args: {
    rows: [{ id: 'r1', email: '', roleId: 'member' }],
    roles: ROLES,
    rolesInfo: (
      <InfoTip label="Role">
        Admin: manages people and settings. Member: works with records. Guest: sees only what is shared.
      </InfoTip>
    ),
    max: 20,
    onChange: fn(),
    onSubmit: fn(),
    onBlurRow: fn(),
    onOverflow: fn(),
  },
  render: (args) => <Held {...args} />,
  // New on 22 October 2026: screenshot baselines come with the next `pnpm test:visual --update` in the pinned image.
  parameters: { crm: { screenshot: false } },
} satisfies Meta<typeof InviteRows>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One empty row with its role and "+ Add another" under it: type an address, then the button or Enter adds a row. */
export const Default: Story = {
  parameters: { crm: { preview: true, screenshot: false } },
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole('textbox', { name: 'Email' }), 'ada@acme.com');
    await userEvent.click(canvas.getByRole('button', { name: 'Add another person' }));
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Email 2' })).toHaveFocus());
    await userEvent.keyboard('grace@acme.com{Enter}');
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Email 3' })).toHaveFocus());
    await expect(canvas.getByRole('button', { name: 'Remove ada@acme.com' })).toBeInTheDocument();
  },
};

/** No roles: first run before the roles load, or a workspace where everyone joins as a member. */
export const WithoutRoles: Story = {
  args: {
    roles: undefined,
    rows: [
      { id: 'r1', email: 'ada@acme.com' },
      { id: 'r2', email: '' },
    ],
  },
};

/** A few people, each with a role, each row with its remove button. */
export const Several: Story = {
  args: {
    rows: [
      { id: 'r1', email: 'ada@acme.com', roleId: 'admin' },
      { id: 'r2', email: 'grace@acme.com', roleId: 'member' },
      { id: 'r3', email: '', roleId: 'member' },
    ],
  },
};

/** A row's problem under its address. */
export const WithErrors: Story = {
  args: {
    rows: [
      { id: 'r1', email: 'ada@', roleId: 'member' },
      { id: 'r2', email: 'grace@acme.com', roleId: 'member' },
    ],
    errors: { r1: 'Enter a valid email address.', r2: 'Already invited.' },
  },
};

/** A pasted list fills this row and new ones after it, with focus on the last. */
export const PasteList: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Email' }));
    // As a mail client copies it: the names are dropped.
    await userEvent.paste('Ada Lovelace <ada@acme.com>, grace@acme.com\nAlan <alan@acme.com>');
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Email 3' })).toHaveFocus());
    await expect(canvas.getByRole('textbox', { name: 'Email 3' })).toHaveValue('alan@acme.com');
    await expect(canvas.getByRole('textbox', { name: 'Email' })).toHaveValue('ada@acme.com');
    await expect(args.onOverflow).not.toHaveBeenCalled();
  },
};

/** Enter on an empty last row asks the screen to send, rather than adding empty rows. */
export const EnterSends: Story = {
  parameters: { crm: { screenshot: false } },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole('textbox', { name: 'Email' }));
    await userEvent.keyboard('{Enter}');
    await expect(args.onSubmit).toHaveBeenCalledTimes(1);
  },
};

/** At the most rows "+ Add another" goes, and a longer paste keeps the first ones. */
export const Full: Story = {
  args: {
    max: 2,
    rows: [
      { id: 'r1', email: 'ada@acme.com', roleId: 'member' },
      { id: 'r2', email: 'grace@acme.com', roleId: 'member' },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Add another person' })).toBeNull();
    await expect(canvas.getByText('Up to 2 at a time.')).toBeInTheDocument();
  },
};

/** While the invites go out: every control waits. */
export const Disabled: Story = {
  args: { isDisabled: true, rows: [{ id: 'r1', email: 'ada@acme.com', roleId: 'member' }] },
};

/** A phone's width: the email takes the room, the role and the remove button keep theirs. */
export const Narrow: Story = {
  parameters: { crm: { screenshot: false } },
  render: (args) => (
    <Stage width="phone">
      <InviteRows {...args} />
    </Stage>
  ),
};
