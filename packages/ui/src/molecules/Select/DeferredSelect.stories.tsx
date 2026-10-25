import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, waitFor } from 'storybook/test';
import { Stage } from '../../workbench/Stage/Stage.tsx';
import { DeferredSelect, DeferredSelectFrom, type DeferredSelectProps, type SelectModule } from './DeferredSelect.tsx';
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
/** How long the held stories keep Select's code back: long enough to press the stand in itself. */
const HOLD_MS = 600;

/** A loader that keeps Select's code back for a while, so a play function presses the stand in, not the real one. */
const held = (): Promise<SelectModule> =>
  new Promise((resolve) => {
    setTimeout(resolve, HOLD_MS);
  }).then(() => import('./Select.tsx'));
const failing = (): Promise<SelectModule> => Promise.reject(new Error('the chunk did not load'));

function Held(args: DeferredSelectProps) {
  return (
    <Stage width="narrow">
      <DeferredSelectFrom {...args} load={held} />
    </Stage>
  );
}

function listbox() {
  return waitFor(() => {
    const found = document.querySelector('[role="listbox"]');
    if (found === null) throw new Error('the list did not open');
    return found;
  });
}

/** Whether the trigger is React Aria's own (the real Select), not the stand in. */
const isReal = (button: Element) => button.hasAttribute('data-react-aria-pressable');

/** The trigger in the story, stand in or real. */
function triggerIn(canvasElement: HTMLElement) {
  const button = canvasElement.querySelector<HTMLElement>('button[aria-haspopup="listbox"]');
  if (button === null) throw new Error('no trigger');
  return button;
}

/** Waits for the real Select to take the stand in's place, and answers its trigger. */
function realTrigger(canvasElement: HTMLElement) {
  return waitFor(() => {
    const button = triggerIn(canvasElement);
    if (!isReal(button)) throw new Error('the real Select has not loaded');
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

/** The computed values that make the closed trigger's look, for the element and the properties given. */
function looks(element: Element | null, properties: readonly string[]) {
  if (element === null) throw new Error('nothing to compare');
  const style = getComputedStyle(element);
  return Object.fromEntries(properties.map((property) => [property, style.getPropertyValue(property)]));
}

const TRIGGER_LOOK = [
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'padding-inline-start',
  'padding-block-start',
  'border-top-width',
  'border-top-style',
  'border-top-color',
  'border-top-left-radius',
  'box-shadow',
  'column-gap',
  'opacity',
  'touch-action',
] as const;
const TEXT_LOOK = ['color', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'white-space'] as const;
const FOCUS_LOOK = ['outline-style', 'outline-width', 'outline-color', 'outline-offset'] as const;

/** The stand in and a loaded inline Select side by side, the stand in held so it stays one. */
function Pair(args: DeferredSelectProps) {
  return (
    <Stage direction="column" width="narrow">
      <div data-testid="deferred">
        <DeferredSelectFrom {...args} load={() => new Promise<SelectModule>(() => undefined)} />
      </div>
      <div data-testid="loaded">
        <Select {...args} isLabelHidden variant="inline" />
      </div>
    </Stage>
  );
}

/** Both triggers of a Pair. */
function pair(canvasElement: HTMLElement) {
  const standIn = canvasElement.querySelector<HTMLElement>('[data-testid="deferred"] button');
  const loaded = canvasElement.querySelector<HTMLElement>('[data-testid="loaded"] button');
  if (standIn === null || loaded === null) throw new Error('no trigger');
  return { standIn, loaded };
}

/** At rest: the stand in is the loaded trigger's box, look, focus ring, name and state. */
export const StandIn: Story = {
  render: (args) => <Pair {...args} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const { standIn, loaded } = pair(canvasElement);
    await expect(isReal(standIn)).toBe(false);
    const [a, b] = [box(standIn), box(loaded)];
    await expect({ width: a.width, height: a.height }).toEqual({ width: b.width, height: b.height });
    await expect(chevronAt(standIn)).toBe(chevronAt(loaded));
    await expect(looks(standIn, TRIGGER_LOOK)).toEqual(looks(loaded, TRIGGER_LOOK));
    for (const part of ['span:first-child', 'span:first-child > span:last-child'])
      await expect(looks(standIn.querySelector(part), TEXT_LOOK)).toEqual(looks(loaded.querySelector(part), TEXT_LOOK));
    // The same role, name and state for a screen reader.
    await expect(canvas.getAllByRole('button', { name: 'Kolkata time GMT+5:30 Time zone' })).toHaveLength(2);
    for (const attribute of ['aria-haspopup', 'aria-expanded'])
      await expect(standIn.getAttribute(attribute)).toBe(loaded.getAttribute(attribute));
    // The keyboard's focus ring, each in turn.
    await userEvent.tab();
    await expect(document.activeElement).toBe(standIn);
    const ringA = looks(standIn, FOCUS_LOOK);
    await userEvent.tab();
    await expect(document.activeElement).toBe(loaded);
    await expect(looks(loaded, FOCUS_LOOK)).toEqual(ringA);
  },
};

/** Nothing chosen: the caller's placeholder, muted, as the loaded Select draws it. */
export const Placeholder: Story = {
  args: { value: null },
  render: (args) => <Pair {...args} />,
  play: async ({ canvas, canvasElement }) => {
    const { standIn, loaded } = pair(canvasElement);
    await expect(canvas.getAllByRole('button', { name: /Choose a time zone/ })).toHaveLength(2);
    await expect(box(standIn).width).toBe(box(loaded).width);
    const part = 'span:first-child > span';
    await expect(looks(standIn.querySelector(part), TEXT_LOOK)).toEqual(looks(loaded.querySelector(part), TEXT_LOOK));
  },
};

/** The first hover loads the list's code, and the real Select takes the stand in's place without moving. */
export const LoadsOnHover: Story = {
  render: (args) => <Held {...args} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const standIn = canvas.getByRole('button', { name: NAME });
    const before = box(standIn);
    await userEvent.hover(standIn);
    const real = await realTrigger(canvasElement);
    await expect(box(real)).toEqual(before);
    await expect(document.querySelector('[role="listbox"]')).toBeNull();
  },
};

/** One press on the stand in opens the list once its code is in, its search focused; Esc puts focus on the trigger. */
export const FirstPress: Story = {
  render: (args) => <Held {...args} />,
  play: async ({ canvasElement, userEvent }) => {
    await expect(isReal(triggerIn(canvasElement))).toBe(false);
    await userEvent.click(triggerIn(canvasElement));
    await expect(isReal(triggerIn(canvasElement))).toBe(false);
    await listbox();
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Search city or GMT offset'));
    await userEvent.keyboard('{Escape}');
    const real = await realTrigger(canvasElement);
    await waitFor(() => expect(document.activeElement).toBe(real));
  },
};

/** The keys that open a Select open the stand in too, on the first press: Enter, Space, Alt and the down arrow. */
function opensWith(keys: string): Story['play'] {
  return async ({ canvasElement, userEvent }) => {
    await userEvent.tab();
    await expect(document.activeElement).toBe(triggerIn(canvasElement));
    await expect(isReal(triggerIn(canvasElement))).toBe(false);
    await userEvent.keyboard(keys);
    await listbox();
    await userEvent.keyboard('{Escape}');
    const real = await realTrigger(canvasElement);
    await waitFor(() => expect(document.activeElement).toBe(real));
  };
}

/** From the keyboard: Tab reaches it, Enter opens it the first time, and Esc puts focus back on it. */
export const FirstEnter: Story = { render: (args) => <Held {...args} />, play: opensWith('{Enter}') };

/** Space opens it the first time too. */
export const FirstSpace: Story = { render: (args) => <Held {...args} />, play: opensWith(' ') };

/** Alt and the down arrow open it the first time, as on a loaded Select. */
export const FirstAltDown: Story = {
  render: (args) => <Held {...args} />,
  play: opensWith('{Alt>}{ArrowDown}{/Alt}'),
};

/** A press still waiting for the list is called off by Esc: nothing opens later, and focus stays put. */
export const CalledOff: Story = {
  render: (args) => <Held {...args} />,
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Escape}');
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS * 2));
    await expect(document.querySelector('[role="listbox"]')).toBeNull();
    await expect(document.activeElement).toBe(triggerIn(canvasElement));
  },
};

/**
 * Focused before its code is in: the stand in keeps the focus (swapping the focused button would drop it for a
 * moment), and the real Select takes its place once focus moves on.
 */
export const KeepsFocus: Story = {
  render: (args) => <Held {...args} />,
  play: async ({ canvasElement, userEvent }) => {
    await userEvent.tab();
    const standIn = triggerIn(canvasElement);
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS * 2));
    await expect(document.activeElement).toBe(standIn);
    await expect(isReal(standIn)).toBe(false);
    await userEvent.tab();
    await realTrigger(canvasElement);
    await expect(document.querySelector('[role="listbox"]')).toBeNull();
  },
};

/** Its code failed to load: the stand in stays, showing the zone, and nothing opens on its own later. */
export const LoadFailed: Story = {
  render: (args) => (
    <Stage width="narrow">
      <DeferredSelectFrom {...args} load={failing} />
    </Stage>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: NAME }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(document.querySelector('[role="listbox"]')).toBeNull();
    await expect(isReal(triggerIn(canvasElement))).toBe(false);
    await expect(canvas.getByRole('button', { name: NAME })).toHaveTextContent('Kolkata time');
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

/** Disabled: muted, and a press neither loads nor opens it. */
export const Disabled: Story = {
  args: { isDisabled: true },
  render: (args) => <Held {...args} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const standIn = canvas.getByRole('button', { name: NAME });
    await expect(standIn).toBeDisabled();
    await userEvent.click(standIn);
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS * 2));
    await expect(document.querySelector('[role="listbox"]')).toBeNull();
    await expect(isReal(triggerIn(canvasElement))).toBe(false);
  },
};
