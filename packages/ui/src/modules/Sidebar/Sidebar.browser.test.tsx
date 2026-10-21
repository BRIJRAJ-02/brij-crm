// A drag on a sidebar item's grip (spec 0034, AC-932), through the library's
// drag wrapper: it ends with its section, lands against the order as it is at
// the drop, and moves by keyboard too.
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToasts } from '../../provider/toasts.tsx';
import { UiProvider } from '../../provider/UiProvider.tsx';
import { NavItem, NavSection, Sidebar } from './Sidebar.tsx';

const mounted: (() => void)[] = [];

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
});

const frame = () => new Promise((resolve) => setTimeout(resolve, 30));

/** Renders inside the provider and returns a way to render again. */
async function render(node: ReactNode): Promise<{ readonly root: Root; readonly again: (next: ReactNode) => void }> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const wrap = (inner: ReactNode) => (
    <UiProvider locale="en-US" timeZone="Europe/London" navigate={() => undefined} toasts={createToasts()}>
      {inner}
    </UiProvider>
  );
  root.render(wrap(node));
  mounted.push(() => {
    root.unmount();
    host.remove();
  });
  await frame();
  return {
    root,
    again: (next) => {
      flushSync(() => {
        root.render(wrap(next));
      });
    },
  };
}

function Records({
  order,
  onReorder,
}: {
  readonly order: readonly string[];
  readonly onReorder: (id: string, to: number) => void;
}) {
  return (
    <Sidebar workspace="Brightline">
      <NavSection title="Records" onReorder={onReorder}>
        {order.map((name) => (
          <NavItem key={name} id={name.toLowerCase()} icon="building" href={`/${name.toLowerCase()}`}>
            {name}
          </NavItem>
        ))}
      </NavSection>
    </Sidebar>
  );
}

function grip(name: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[aria-label="Move ${name}"]`);
  if (found === null) throw new Error(`No grip for ${name}.`);
  return found;
}

function middleOf(name: string): number {
  const row = document.querySelector<HTMLElement>(`[data-reorder-id="${name.toLowerCase()}"]`);
  if (row === null) throw new Error(`No row for ${name}.`);
  const rect = row.getBoundingClientRect();
  return rect.top + rect.height / 2;
}

const pointer = (type: string, clientY: number) =>
  new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, isPrimary: true, clientY });

/** The drag wrapper follows the pointer on the document once a drag starts. */
const move = (type: string, clientY: number) => {
  document.dispatchEvent(pointer(type, clientY));
};

/** Picks up `name` by its grip and moves the pointer past the few pixels that start a drag. */
async function lift(name: string) {
  const y = middleOf(name);
  grip(name).dispatchEvent(pointer('pointerdown', y));
  move('pointermove', y - 8);
  await frame();
}

describe('a sidebar drag', () => {
  it('sends nothing when its section unmounts before the pointer comes up', async () => {
    const onReorder = vi.fn();
    const { again } = await render(<Records order={['Companies', 'People', 'Deals']} onReorder={onReorder} />);
    await lift('Deals');
    move('pointermove', middleOf('Companies') - 4);
    again(null);
    move('pointerup', 0);
    await frame();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('sends nothing when the pointer is cancelled', async () => {
    const onReorder = vi.fn();
    await render(<Records order={['Companies', 'People', 'Deals']} onReorder={onReorder} />);
    await lift('Deals');
    move('pointermove', middleOf('Companies') - 4);
    await frame();
    move('pointercancel', 0);
    move('pointerup', 0);
    await frame();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('lands where it is held, in the order as it is at the drop, through the latest callback', async () => {
    const onReorder = vi.fn();
    const first = vi.fn();
    const { again } = await render(<Records order={['Companies', 'People', 'Deals']} onReorder={first} />);
    // Deals is held over People.
    const people = middleOf('People');
    await lift('Deals');
    move('pointermove', people - 4);
    await frame();
    // A live change puts a new item first, and the screen hands a new callback.
    again(<Records order={['Accounts', 'Companies', 'People', 'Deals']} onReorder={onReorder} />);
    await frame();
    move('pointerup', people - 4);
    await frame();
    expect(first).not.toHaveBeenCalled();
    // Where it is held now, in the order as it is now: Accounts pushed every row down one, so the pointer is
    // over Companies, and Deals lands in its place (Accounts, Deals, Companies, People).
    expect(onReorder).toHaveBeenCalledExactlyOnceWith('deals', 1);
  });

  it('moves by keyboard: Space lifts, an arrow moves, Space drops, and focus comes back to the grip', async () => {
    const onReorder = vi.fn();
    await render(<Records order={['Companies', 'People', 'Deals']} onReorder={onReorder} />);
    const deals = grip('Deals');
    deals.focus();
    deals.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
    await frame();
    expect(deals).not.toHaveFocus();
    const press = (key: string, code: string) => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }),
      );
    };
    press('ArrowUp', 'ArrowUp');
    await frame();
    press(' ', 'Space');
    await frame();
    expect(onReorder).toHaveBeenCalledExactlyOnceWith('deals', 1);
    await frame();
    expect(grip('Deals')).toHaveFocus();
  });
});
