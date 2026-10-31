// A choice tile in a real browser, clicked the way a person (and Playwright, with its actionability checks) clicks
// it: on the tile, and on the radio itself. Neither may need `force`, so nothing may cover the radio.
import { useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { createToasts } from '../../provider/toasts.tsx';
import { UiProvider } from '../../provider/UiProvider.tsx';
import { TileGrid, type ChoiceTile } from './TileGrid.tsx';

const mounted: (() => void)[] = [];

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
});

const frame = () => new Promise((resolve) => setTimeout(resolve, 30));

async function render(node: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <UiProvider locale="en-US" timeZone="Europe/London" navigate={() => undefined} toasts={createToasts()}>
      {node}
    </UiProvider>,
  );
  mounted.push(() => {
    root.unmount();
    host.remove();
  });
  await frame();
}

const TILES: readonly ChoiceTile[] = [
  { id: 'fair', name: 'Fair', icon: 'users', description: 'Everyone gets a turn in order.' },
  { id: 'first', name: 'First free', icon: 'clock' },
  { id: 'least', name: 'Least busy', icon: 'calendar', description: 'Whoever has the fewest bookings.' },
];

function Picker() {
  const [value, setValue] = useState<string | null>('fair');
  return <TileGrid variant="choice" label="Look" tiles={TILES} value={value} onChange={setValue} />;
}

const radio = (name: string) => page.getByRole('radio', { name });

describe('ChoiceTiles select', () => {
  it('picks a tile when its radio is clicked, with no force', async () => {
    await render(<Picker />);
    await userEvent.click(radio('First free'));
    expect(radio('First free').element()).toBeChecked();
    await userEvent.click(radio('Least busy'));
    expect(radio('Least busy').element()).toBeChecked();
    expect(radio('First free').element()).not.toBeChecked();
  });

  it('picks a tile when its name, picture or padding is clicked', async () => {
    await render(<Picker />);
    await userEvent.click(page.getByText('First free'));
    expect(radio('First free').element()).toBeChecked();
    const tile = radio('Least busy').element().closest('[data-tile]');
    if (!(tile instanceof HTMLElement)) throw new Error('no tile');
    // The tile's top start corner: its padding, outside the picture and the name.
    await userEvent.click(tile, { position: { x: 4, y: 4 } });
    expect(radio('Least busy').element()).toBeChecked();
  });
});
