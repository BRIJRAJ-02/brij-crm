// Deleting a schedule asks first (spec 0035, AC-967; the owner's confirm rule, 21 October 2026), in Chromium: the
// question names the schedule and the pages it moves, Cancel changes nothing, the commit runs once and shows busy
// while the server works, and a refusal is said inside the dialog, which stays open.
import { dataError, type ScheduleView } from '@crm/data';
import { createToasts, UiProvider } from '@crm/ui';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeleteScheduleDialog } from './DeleteScheduleDialog.tsx';

const evenings: ScheduleView = {
  id: '0190f0f0-0000-7000-8000-000000000001',
  memberId: '0190f0f0-0000-7000-8000-00000000000a',
  name: 'Evenings',
  isDefault: false,
  availability: {
    timeZone: 'UTC',
    weekly: { mon: [['18:00', '20:00']], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
    overrides: [],
  },
  pages: [
    { id: '0190f0f0-0000-7000-8000-000000000002', title: 'Intro call' },
    { id: '0190f0f0-0000-7000-8000-000000000003', title: 'Demo' },
  ],
  updatedAt: '2026-10-21T10:00:00.000Z',
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

/** The dialog open on Evenings, with `onDelete` standing in for the data layer's delete. */
async function open(onDelete: (schedule: ScheduleView) => Promise<unknown>) {
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  await act(async () => {
    root.render(
      <UiProvider locale="en-GB" timeZone="UTC" toasts={createToasts()} navigate={() => undefined}>
        <DeleteScheduleDialog
          schedule={evenings}
          fallbackName="Working hours"
          onClose={onClose}
          onDelete={onDelete}
          onDeleted={onDeleted}
        />
      </UiProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const dialog = document.querySelector('[role="alertdialog"]');
  if (dialog === null) throw new Error('No dialog.');
  const button = (name: string) => {
    const found = [...dialog.querySelectorAll('button')].find((each) => each.textContent.includes(name));
    if (found === undefined) throw new Error(`No ${name} button.`);
    return found;
  };
  return { dialog, button, onClose, onDeleted };
}

const press = async (element: HTMLElement) => {
  await act(async () => {
    element.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

describe('the delete schedule confirm', () => {
  it('asks by name, says where its pages go and that it can’t be undone, Cancel first and the verb last', async () => {
    const { dialog } = await open(() => Promise.resolve());
    expect(dialog.textContent).toContain('Delete the Evenings schedule?');
    expect(dialog.textContent).toContain(
      'Intro call and Demo will use Working hours, your default. This can’t be undone.',
    );
    const buttons = [...dialog.querySelectorAll('button')].map((each) => each.textContent.trim());
    expect(buttons.findIndex((text) => text.startsWith('Cancel'))).toBeLessThan(
      buttons.findIndex((text) => text.startsWith('Delete schedule')),
    );
  });

  it('changes nothing on Cancel', async () => {
    const onDelete = vi.fn(() => Promise.resolve());
    const { button, onClose, onDeleted } = await open(onDelete);
    await press(button('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('deletes once, however often it is pressed, showing busy until the server answers', async () => {
    let answer: (() => void) | undefined;
    const onDelete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    );
    const { button, dialog, onDeleted } = await open(onDelete);
    const commit = button('Delete schedule');
    await press(commit);
    await press(commit);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(dialog.textContent).toContain('Deleting');
    await act(async () => {
      answer?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(onDeleted).toHaveBeenCalledWith(evenings);
  });

  it('says a refusal inside the dialog and stays open, so it can be tried again', async () => {
    const onDelete = vi.fn(() =>
      Promise.reject(dataError('DEFAULT_SCHEDULE', 'Set another schedule as default first.')),
    );
    const { button, dialog, onClose, onDeleted } = await open(onDelete);
    await press(button('Delete schedule'));
    expect(dialog.textContent).toContain('Set another schedule as default first.');
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(button('Delete schedule').disabled).toBe(false);
  });
});
