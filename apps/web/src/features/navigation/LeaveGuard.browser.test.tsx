// Leaving an editor with unsaved changes (Q59, Q62), in Chromium: it asks in the app's own danger Modal, never the
// browser's confirm; Keep editing stays where it was, Leave without saving goes on; nothing is asked while nothing is
// unsaved; and the booking page editor's tabs (a `?tab=` change) never ask, while Availability's `?schedule=` does.
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDialog, renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { LeaveGuard } from './LeaveGuard.tsx';

let app: InApp | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.restoreAllMocks();
});

/** The guard alone on `/w/acme/editor?tab=page`, as an editor draws it. */
async function editor(isDirty: boolean, searchStays?: boolean) {
  app = await renderInApp(
    () => <LeaveGuard isDirty={isDirty} {...(searchStays === undefined ? {} : { searchStays })} />,
    { data: {}, pattern: '/w/$slug/editor', at: '/w/acme/editor?tab=page' },
  );
  return app;
}

/** Starts a navigation without waiting on it: a blocked one only settles once the Modal is answered. */
async function go(inApp: InApp, href: string) {
  await act(async () => {
    void inApp.router.navigate({ href });
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

const where = (inApp: InApp) => `${inApp.router.state.location.pathname}${inApp.router.state.location.searchStr}`;

/** Presses a button in the open Modal by its words, and lets its exit play. */
async function press(name: string) {
  const button = [...(openDialog('alertdialog')?.querySelectorAll('button') ?? [])].find((each) =>
    each.textContent.startsWith(name),
  );
  expect(button, `a button "${name}" in the Modal`).toBeDefined();
  await act(async () => {
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}

describe('LeaveGuard', () => {
  it('asks in a Modal, not the browser, and Keep editing stays put', async () => {
    const confirm = vi.spyOn(globalThis, 'confirm');
    const inApp = await editor(true);
    await go(inApp, '/w/acme/elsewhere');
    const dialog = openDialog('alertdialog');
    expect(dialog?.textContent).toContain('Leave without saving?');
    expect(dialog?.textContent).toContain('Your changes here won’t be saved.');
    expect(confirm).not.toHaveBeenCalled();
    await press('Keep editing');
    expect(openDialog('alertdialog')).toBeNull();
    expect(where(inApp)).toBe('/w/acme/editor?tab=page');
  });

  it('goes on after Leave without saving', async () => {
    const inApp = await editor(true);
    await go(inApp, '/w/acme/elsewhere');
    await press('Leave without saving');
    expect(inApp.router.state.location.pathname).toBe('/w/acme/elsewhere');
  });

  it('asks nothing while nothing is unsaved', async () => {
    const inApp = await editor(false);
    await go(inApp, '/w/acme/elsewhere');
    expect(openDialog('alertdialog')).toBeNull();
    expect(inApp.router.state.location.pathname).toBe('/w/acme/elsewhere');
  });

  it('lets the editor change its tab with changes unsaved when the search stays', async () => {
    const inApp = await editor(true, true);
    await go(inApp, '/w/acme/editor?tab=hours');
    expect(openDialog('alertdialog')).toBeNull();
    expect(where(inApp)).toBe('/w/acme/editor?tab=hours');
    // Another page still asks.
    await go(inApp, '/w/acme/elsewhere');
    expect(openDialog('alertdialog')?.textContent).toContain('Leave without saving?');
  });

  it('asks on a search change when the search is part of what is open (another schedule)', async () => {
    const inApp = await editor(true);
    await go(inApp, '/w/acme/editor?tab=hours');
    expect(openDialog('alertdialog')?.textContent).toContain('Leave without saving?');
    expect(where(inApp)).toBe('/w/acme/editor?tab=page');
  });
});
