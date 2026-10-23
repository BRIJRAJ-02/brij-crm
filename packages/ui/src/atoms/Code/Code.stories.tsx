import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { Code } from './Code.tsx';

const meta = {
  title: 'Atoms/Code',
  component: Code,
  args: { children: 'person.email_addresses' },
} satisfies Meta<typeof Code>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Inline, in a sentence. */
export const Default: Story = {
  parameters: { crm: { preview: true } },
  render: (args) => (
    <Stage>
      <span>
        Filter on <Code {...args} /> to find people by address.
      </span>
    </Stage>
  ),
};

/** With a copy button. Where the browser refuses the clipboard, it says so and selects the text. */
export const Copyable: Story = {
  args: { children: 'https://hooks.example.com/w/8c1f2', isCopyable: true, copyLabel: 'Copy the webhook URL' },
  render: (args) => (
    <Stage>
      <Code {...args} />
    </Stage>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Copy the webhook URL' }));
    // Headless browsers may or may not grant the clipboard; either way a toast reports it.
    await waitFor(() =>
      expect(document.querySelector('[role="alertdialog"], [role="alert"], [role="status"]')).not.toBeNull(),
    );
  },
};

/** The ten backup codes two factor setup shows, as `children` one per line. */
const BACKUP_CODES = [
  'A8kd2-Pq9xZ',
  'mT4rw-L0bQe',
  'Zy7Nc-3vHsd',
  'qP2jX-8wKmR',
  'Ld5fG-hT1nV',
  'W9sbE-c6YuK',
  'nR3tM-xJ8pA',
  'Fh6qL-2dZwS',
  'Kc1vY-gN7rB',
  'uE4mP-sW9tH',
].join('\n');

/**
 * Block: a setup key on its own line, in a box at the slot's full width (the sidebar's here, narrower than a phone's
 * dialog). Lines break only between the groups of four, and Copy sits inside the box at its end.
 */
export const Block: Story = {
  args: {
    children: 'JBSW Y3DP EHPK 3PXP KRUG S4ZA MFZG CYLT',
    variant: 'block',
    isCopyable: true,
    copyLabel: 'Copy the setup key',
  },
  render: (args) => (
    <Stage width="narrow-fill">
      <Code {...args} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    const code = canvasElement.querySelector('code');
    const text = code?.firstChild;
    if (!(text instanceof Text)) throw new Error('The key renders as one text node');
    /** Where a run of the key's characters draws: one box per line it sits on. */
    const boxesOf = (from: number, to: number) => {
      const range = document.createRange();
      range.setStart(text, from);
      range.setEnd(text, to);
      return [...range.getClientRects()];
    };
    // It wraps at this width, and every group of four stays on one line (a split group draws as two boxes).
    await expect(boxesOf(0, text.length).length).toBeGreaterThan(1);
    let start = 0;
    for (const group of text.data.split(' ')) {
      await expect(boxesOf(start, start + group.length)).toHaveLength(1);
      start += group.length + 1;
    }
    // Copy is inside the box, not after it.
    const copy = canvas.getByRole('button', { name: 'Copy the setup key' });
    await expect(code?.parentElement?.contains(copy)).toBe(true);
  },
};

/** List: ten backup codes in two columns of whole codes, five rows; Copy inside the box copies one per line. */
export const List: Story = {
  args: { children: BACKUP_CODES, variant: 'list', isCopyable: true, copyLabel: 'Copy the backup codes' },
  render: (args) => (
    <Stage width="narrow-fill">
      <Code {...args} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    const items = [...canvasElement.querySelectorAll('code > span')];
    await expect(items.map((item) => item.textContent)).toEqual(BACKUP_CODES.split('\n'));
    const columns = new Set(items.map((item) => Math.round(item.getBoundingClientRect().left)));
    const rows = new Set(items.map((item) => Math.round(item.getBoundingClientRect().top)));
    await expect(columns.size).toBe(2);
    await expect(rows.size).toBe(5);
    // Each code whole, on one line.
    for (const item of items) {
      await expect(item.getBoundingClientRect().height).toBeLessThan(2 * parseFloat(getComputedStyle(item).lineHeight));
    }
    const copy = canvas.getByRole('button', { name: 'Copy the backup codes' });
    await expect(canvasElement.querySelector('code')?.parentElement?.contains(copy)).toBe(true);
  },
};

/** The box's sides match when there is no Copy inside it; without Copy, the end keeps the start's padding. */
async function evenSides(canvasElement: HTMLElement) {
  const box = canvasElement.querySelector('code')?.parentElement;
  if (box === null || box === undefined) throw new Error('The box renders');
  const style = getComputedStyle(box);
  await expect(style.paddingInlineEnd).toBe(style.paddingInlineStart);
}

/** BlockPlain: a setup key without Copy. The box keeps even sides, and the groups still wrap whole. */
export const BlockPlain: Story = {
  args: { children: 'JBSW Y3DP EHPK 3PXP KRUG S4ZA MFZG CYLT', variant: 'block', isCopyable: false },
  render: (args) => (
    <Stage width="narrow-fill">
      <Code {...args} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.queryByRole('button')).toBeNull();
    await evenSides(canvasElement);
  },
};

/** ListPlain: ten backup codes without Copy, in the same two columns, with even sides. */
export const ListPlain: Story = {
  args: { children: BACKUP_CODES, variant: 'list', isCopyable: false },
  render: (args) => (
    <Stage width="narrow-fill">
      <Code {...args} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.queryByRole('button')).toBeNull();
    await expect(canvasElement.querySelectorAll('code > span')).toHaveLength(10);
    await evenSides(canvasElement);
  },
};
