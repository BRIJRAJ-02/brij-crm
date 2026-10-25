import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { DeferredSelect } from './DeferredSelect.tsx';
import { Select } from './Select.tsx';

const ZONES = [
  { id: 'Asia/Kolkata', label: 'Kolkata time', description: 'GMT+5:30' },
  { id: 'Europe/London', label: 'London time', description: 'GMT+1' },
  { id: 'America/New_York', label: 'New York time', description: 'GMT-4' },
];

// The look is Select's Inline story, which has its screenshot; these hold the stand in to it and test first use.
const meta = {
  title: 'Molecules/DeferredSelect',
  component: DeferredSelect,
  parameters: { crm: { screenshot: false } },
  args: {
    label: 'Time zone',
    items: ZONES,
    value: 'Asia/Kolkata',
    placeholder: 'Choose a time zone',
    showsDescription: true,
    isSearchable: true,
    searchLabel: 'Search city or GMT offset',
    preload: 'intent',
    onChange: fn(),
  },
} satisfies Meta<typeof DeferredSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

const NAME = /Kolkata time/;

function listbox() {
  return waitFor(() => {
    const found = document.querySelector('[role="listbox"]');
    if (found === null) throw new Error('the list did not open');
    return found;
  });
}

/** Whether the trigger is React Aria's own (the real Select), not the stand in. */
const isReal = (button: HTMLElement) => button.hasAttribute('data-react-aria-pressable');

/** Waits for the real Select to take the stand in's place, and answers its trigger. */
function realTrigger(canvasElement: HTMLElement) {
  return waitFor(() => {
    const button = canvasElement.querySelector<HTMLElement>('button[aria-haspopup="listbox"]');
    if (button === null || !isReal(button)) throw new Error('the real Select has not loaded');
    return button;
  });
}

const box = (element: Element) => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
};

/** How far into its trigger the chevron sits. */
function chevronAt(button: HTMLElement) {
  const chevron = button.querySelector('svg');
  if (chevron === null) throw new Error('no chevron');
  return box(chevron).x - box(button).x;
}

/** At rest: the stand in, beside a loaded inline Select with the same value, is the same box with the same name. */
export const StandIn: Story = {
  render: (args) => (
    <Stage direction="column" width="narrow">
      <div data-testid="deferred">
        <DeferredSelect {...args} />
      </div>
      <div data-testid="loaded">
        <Select {...args} isLabelHidden variant="inline" />
      </div>
    </Stage>
  ),
  play: async ({ canvas }) => {
    const standIn = canvas.getByTestId('deferred').querySelector('button');
    const loaded = canvas.getByTestId('loaded').querySelector('button');
    if (standIn === null || loaded === null) throw new Error('no trigger');
    await expect(isReal(standIn)).toBe(false);
    const [a, b] = [box(standIn), box(loaded)];
    await expect({ width: a.width, height: a.height }).toEqual({ width: b.width, height: b.height });
    // The chevron sits the same way into each.
    await expect(chevronAt(standIn)).toBe(chevronAt(loaded));
    // The same role, name and state for a screen reader.
    const buttons = canvas.getAllByRole('button', { name: 'Kolkata time GMT+5:30 Time zone' });
    await expect(buttons).toHaveLength(2);
    for (const attribute of ['aria-haspopup', 'aria-expanded'])
      await expect(standIn.getAttribute(attribute)).toBe(loaded.getAttribute(attribute));
  },
};

/** The first hover loads the list's code, and the real Select takes the stand in's place without moving. */
export const LoadsOnHover: Story = {
  render: (args) => (
    <Stage width="narrow">
      <DeferredSelect {...args} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const standIn = canvas.getByRole('button', { name: NAME });
    const before = box(standIn);
    await userEvent.hover(standIn);
    const real = await realTrigger(canvasElement);
    await expect(box(real)).toEqual(before);
    await expect(document.querySelector('[role="listbox"]')).toBeNull();
  },
};

/** One press opens it, however soon after the page it comes: the list opens with its search focused. */
export const FirstPress: Story = {
  render: (args) => (
    <Stage width="narrow">
      <DeferredSelect {...args} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: NAME }));
    await listbox();
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Search city or GMT offset'));
    await userEvent.keyboard('{Escape}');
    const real = await realTrigger(canvasElement);
    await waitFor(() => expect(document.activeElement).toBe(real));
  },
};

/** From the keyboard: Tab reaches it, Enter opens it the first time, and Esc puts focus back on it. */
export const FirstEnter: Story = {
  render: (args) => (
    <Stage width="narrow">
      <DeferredSelect {...args} />
    </Stage>
  ),
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    await listbox();
    await userEvent.keyboard('{Escape}');
    const real = await realTrigger(canvasElement);
    await waitFor(() => expect(document.activeElement).toBe(real));
  },
};

/** Space opens it the first time too. */
export const FirstSpace: Story = {
  render: (args) => (
    <Stage width="narrow">
      <DeferredSelect {...args} />
    </Stage>
  ),
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard(' ');
    await listbox();
    await userEvent.keyboard('{Escape}');
    const real = await realTrigger(canvasElement);
    await waitFor(() => expect(document.activeElement).toBe(real));
  },
};

/** Alt and the down arrow open it the first time, as on a loaded Select. */
export const FirstAltDown: Story = {
  render: (args) => (
    <Stage width="narrow">
      <DeferredSelect {...args} />
    </Stage>
  ),
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await listbox();
    await userEvent.keyboard('{Escape}');
    const real = await realTrigger(canvasElement);
    await waitFor(() => expect(document.activeElement).toBe(real));
  },
};

/** Focused by the keyboard before its code is in: the real one keeps the focus when it arrives. */
export const KeepsFocus: Story = {
  render: (args) => (
    <Stage width="narrow">
      <DeferredSelect {...args} />
    </Stage>
  ),
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.tab();
    const real = await realTrigger(canvasElement);
    await waitFor(() => expect(document.activeElement).toBe(real));
    await expect(document.querySelector('[role="listbox"]')).toBeNull();
  },
};

/** Chosen after its code loads on idle: the visitor's choice goes to the caller. */
export const Choose: Story = {
  args: { preload: 'idle' },
  render: (args) => (
    <Stage width="narrow">
      <DeferredSelect {...args} />
    </Stage>
  ),
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: NAME }));
    await listbox();
    await userEvent.keyboard('london');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(args.onChange).toHaveBeenCalledWith('Europe/London'));
  },
};

/** Nothing chosen yet: the caller's placeholder, muted. */
export const Placeholder: Story = {
  args: { value: null },
  render: (args) => (
    <Stage width="narrow">
      <DeferredSelect {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: /Choose a time zone/ })).toBeVisible();
  },
};

/** Disabled: muted, and neither focus nor a press loads or opens it. */
export const Disabled: Story = {
  args: { isDisabled: true },
  render: (args) => (
    <Stage width="narrow">
      <DeferredSelect {...args} />
    </Stage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: NAME })).toBeDisabled();
  },
};
