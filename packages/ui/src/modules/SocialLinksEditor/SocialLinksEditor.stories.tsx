import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { socialLinksDraftOf, type SocialLinkDraft } from './draft.ts';
import { SocialLinksEditor, type SocialLinksEditorProps } from './SocialLinksEditor.tsx';

const THREE = socialLinksDraftOf([
  { network: 'linkedin', href: 'https://linkedin.com/in/ada-lovelace' },
  { network: 'x', href: 'https://x.com/ada' },
  { network: 'website', href: 'https://ada.dev' },
]);

const ALL = socialLinksDraftOf([
  { network: 'linkedin', href: 'https://linkedin.com/in/ada-lovelace' },
  { network: 'x', href: 'https://x.com/ada' },
  { network: 'instagram', href: 'https://instagram.com/ada.l' },
  { network: 'github', href: 'https://github.com/ada' },
  { network: 'facebook', href: 'https://facebook.com/ada.l' },
  { network: 'youtube', href: 'https://youtube.com/@adamakes' },
  { network: 'tiktok', href: 'https://tiktok.com/@adal' },
  { network: 'threads', href: 'https://threads.com/@ada.l' },
  { network: 'angellist', href: 'https://wellfound.com/u/ada' },
  { network: 'website', href: 'https://ada.dev' },
]);

/** The editor holding its own draft, as a screen does. */
function Held(props: Omit<SocialLinksEditorProps, 'onChange'>) {
  const [rows, setRows] = useState<readonly SocialLinkDraft[]>(props.rows);
  return (
    <Stage width="narrow-fill">
      <SocialLinksEditor {...props} rows={rows} onChange={setRows} />
    </Stage>
  );
}

const meta = {
  title: 'Modules/SocialLinksEditor',
  component: SocialLinksEditor,
  args: { rows: THREE, onChange: () => undefined },
  render: (args) => <Held {...args} />,
} satisfies Meta<typeof SocialLinksEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three links: the mark and name, the field after the network's address, and each row's menu. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'LinkedIn' })).toHaveValue('ada-lovelace');
    await expect(canvas.getByText('linkedin.com/in/')).toBeVisible();
    await expect(canvas.getByRole('textbox', { name: 'Website' })).toHaveValue('https://ada.dev');
  },
};

/** None yet: one row says so, with Add social link. Adding one gives it a field, focused. */
export const Empty: Story = {
  args: { rows: [] },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('No social links yet')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Add social link' }));
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('menuitem', { name: 'GitHub' }));
    const field = canvas.getByRole('textbox', { name: 'GitHub' });
    await waitFor(() => expect(field).toHaveFocus());
    // A pasted profile link becomes its handle as the field is left.
    await userEvent.type(field, 'https://github.com/ada?tab=repositories');
    await userEvent.tab();
    await expect(field).toHaveValue('ada');
  },
};

/** One link. */
export const One: Story = { args: { rows: THREE.slice(0, 1) } };

/** All ten networks: Add social link goes, since every network is used. */
export const AllTen: Story = {
  args: { rows: ALL },
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('textbox')).toHaveLength(10);
    await expect(canvas.queryByRole('button', { name: 'Add social link' })).toBeNull();
  },
};

/** A link to another network is refused in plain words under its field. */
export const Refused: Story = {
  args: { rows: [{ network: 'linkedin', text: '' }] },
  play: async ({ canvas }) => {
    const field = canvas.getByRole('textbox', { name: 'LinkedIn' });
    await userEvent.type(field, 'https://instagram.com/ada');
    await userEvent.tab();
    await expect(canvas.getByText('That’s a link to Instagram, not LinkedIn.')).toBeVisible();
  },
};

/** Moving and removing a row, from its menu. */
export const MoveAndRemove: Story = {
  play: async ({ canvas, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('button', { name: 'X options' }));
    await userEvent.click(await body.findByRole('menuitem', { name: 'Move up' }));
    await expect(canvas.getAllByRole('textbox')[0]).toHaveValue('ada');
    await userEvent.click(canvas.getByRole('button', { name: 'Website options' }));
    const removes = await body.findAllByRole('menuitem', { name: 'Remove' });
    // The X menu may still be leaving: the open one is the last.
    const remove = removes.at(-1);
    if (remove === undefined) throw new Error('No Remove.');
    await userEvent.click(remove);
    await expect(canvas.getAllByRole('textbox')).toHaveLength(2);
    // Focus goes to the row now last, never to the page.
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'LinkedIn' })).toHaveFocus());
  },
};

/** While the links are read. */
export const Loading: Story = { args: { rows: [], isLoading: true } };

/** While a save is out: the rows stay as typed; Add and the row menus wait. */
export const Disabled: Story = {
  args: { isDisabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Add social link' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'LinkedIn options' })).toBeDisabled();
  },
};

/** Read only: the links, with no menus and no Add. */
export const ReadOnly: Story = {
  args: { isReadOnly: true, readOnlyReason: 'Only you change your social links.' },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button', { name: 'Add social link' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'LinkedIn options' })).toBeNull();
  },
};

/** In a dialog that frames it already. */
export const Bare: Story = { args: { tone: 'bare' } };
