// A pointer drag on a sidebar section's grip (spec 0034, AC-932): it ends
// with its section, lands against the order as it is at the drop, and redraws
// only when its drop place moves.
import { Profiler, type ReactNode } from 'react';
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

describe('a sidebar drag', () => {
  it('sends nothing when its section unmounts before the pointer comes up', async () => {
    const onReorder = vi.fn();
    const { again } = await render(<Records order={['Companies', 'People', 'Deals']} onReorder={onReorder} />);
    const y = middleOf('Deals');
    grip('Deals').dispatchEvent(pointer('pointerdown', y));
    window.dispatchEvent(pointer('pointermove', middleOf('Companies') - 4));
    again(null);
    window.dispatchEvent(pointer('pointerup', 0));
    await frame();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('sends nothing when the pointer is cancelled', async () => {
    const onReorder = vi.fn();
    await render(<Records order={['Companies', 'People', 'Deals']} onReorder={onReorder} />);
    grip('Deals').dispatchEvent(pointer('pointerdown', middleOf('Deals')));
    window.dispatchEvent(pointer('pointermove', middleOf('Companies') - 4));
    window.dispatchEvent(pointer('pointercancel', 0));
    window.dispatchEvent(pointer('pointerup', 0));
    await frame();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('lands beside the item it was dropped by, in the order as it is at the drop', async () => {
    const onReorder = vi.fn();
    const first = vi.fn();
    const { again } = await render(<Records order={['Companies', 'People', 'Deals']} onReorder={first} />);
    // Deals is dragged above People (index 1 among the others: Companies, People).
    grip('Deals').dispatchEvent(pointer('pointerdown', middleOf('Deals')));
    window.dispatchEvent(pointer('pointermove', middleOf('People') - 4));
    // A live change puts a new item first, and the screen hands a new callback.
    again(<Records order={['Accounts', 'Companies', 'People', 'Deals']} onReorder={onReorder} />);
    window.dispatchEvent(pointer('pointerup', 0));
    await frame();
    expect(first).not.toHaveBeenCalled();
    // Just above People in the order as it is now: Accounts, Companies, Deals, People.
    expect(onReorder).toHaveBeenCalledExactlyOnceWith('deals', 2);
  });

  it('redraws only when its drop place moves', async () => {
    const commits = { count: 0 };
    const onReorder = vi.fn();
    await render(
      <Profiler
        id="sidebar"
        onRender={() => {
          commits.count += 1;
        }}
      >
        <Records order={['Companies', 'People', 'Deals']} onReorder={onReorder} />
      </Profiler>,
    );
    const y = middleOf('Deals');
    grip('Deals').dispatchEvent(pointer('pointerdown', y));
    await frame();
    const lifted = commits.count;
    for (let step = 0; step < 20; step += 1) window.dispatchEvent(pointer('pointermove', y + (step % 3)));
    await frame();
    expect(commits.count).toBe(lifted);
    window.dispatchEvent(pointer('pointerup', y));
    await frame();
    expect(onReorder).not.toHaveBeenCalled();
  });
});
