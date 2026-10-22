// The Days off card (spec 0025, AC-680; the owner's card anatomy, 22 October 2026), in Chromium: with none, one quiet
// line and Add day off under it; with some, a row per day (its date, its note, Remove), and Remove opens the day
// again; read only, the rows show with nothing to press.
import type { BookingAvailability } from '@crm/data';
import { createToasts, UiProvider } from '@crm/ui';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DaysOff } from './DaysOff.tsx';

const week: BookingAvailability['weekly'] = {
  mon: [['09:00', '17:00']],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
};
const none: BookingAvailability = { timeZone: 'UTC', weekly: week, overrides: [] };
const some: BookingAvailability = {
  ...none,
  overrides: [{ date: '2099-11-20', ranges: [], note: 'Diwali' }],
};

let mounted: { readonly root: Root; readonly host: HTMLElement } | undefined;

afterEach(() => {
  if (mounted === undefined) return;
  const { root, host } = mounted;
  act(() => {
    root.unmount();
  });
  host.remove();
  mounted = undefined;
});

async function draw(availability: BookingAvailability, isReadOnly = false) {
  const onChange = vi.fn<(next: BookingAvailability) => void>();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  await act(async () => {
    root.render(
      <UiProvider locale="en-US" timeZone="UTC" toasts={createToasts()} navigate={() => undefined}>
        <DaysOff availability={availability} onChange={onChange} isReadOnly={isReadOnly} />
      </UiProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const buttons = () => [...host.querySelectorAll('button')];
  return { host, onChange, buttons };
}

describe('DaysOff', () => {
  it('says there are none in one quiet line, with Add day off under it', async () => {
    const { host, buttons } = await draw(none);
    expect(host.textContent).toContain('No days off yet');
    expect(host.querySelector('[role="grid"]')).toBeNull();
    expect(buttons().map((each) => each.textContent)).toEqual(['Add day off']);
  });

  it('lists each day off as a row, and Remove opens that day again', async () => {
    const { host, onChange, buttons } = await draw(some);
    expect(host.textContent).not.toContain('No days off yet');
    expect(host.querySelector('[role="grid"]')?.textContent).toContain('Diwali');
    const remove = buttons().find((each) => each.getAttribute('aria-label')?.startsWith('Remove the day off on'));
    if (remove === undefined) throw new Error('No Remove button.');
    await act(async () => {
      remove.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].overrides).toEqual([]);
  });

  it('shows the days off with nothing to press when read only', async () => {
    const { host, buttons } = await draw(some, true);
    expect(host.textContent).toContain('Diwali');
    expect(buttons()).toEqual([]);
  });
});
