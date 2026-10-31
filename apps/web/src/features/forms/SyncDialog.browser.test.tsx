// Sync earlier submissions in Chromium (spec 0058, AC-14): Only unfiled is chosen on open, the preview is one line of
// counts, and there is one button, which names how many it syncs and starts that scope.
import type { DataLayer, SyncPreview, SyncScope } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { SyncDialog } from './SyncDialog.tsx';

const PREVIEWS: Readonly<Record<SyncScope, SyncPreview>> = {
  unfiled: {
    total: 12,
    creates: 9,
    updates: 3,
    unchanged: 0,
    failures: 0,
    checked: 12,
    capped: false,
    versionNumber: 2,
  },
  all: { total: 42, creates: 9, updates: 20, unchanged: 11, failures: 2, checked: 42, capped: false, versionNumber: 2 },
};

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

async function open(previews: Readonly<Record<SyncScope, SyncPreview>> = PREVIEWS) {
  const started: SyncScope[] = [];
  const data = {
    forms: {
      syncPreview: (_slug: string, _formId: string, scope: SyncScope) => Promise.resolve(previews[scope]),
      syncStart: (_slug: string, _formId: string, scope: SyncScope, jobId: string) => {
        started.push(scope);
        return Promise.resolve({ jobId, total: previews[scope].total });
      },
    },
    submissions: { newId: () => crypto.randomUUID() },
  } as unknown as DataLayer;
  shown = await renderInApp(
    () => (
      <SyncDialog
        slug="acme"
        formId="form-1"
        reason="menu"
        isOpen
        onClose={() => undefined}
        onStarted={() => undefined}
      />
    ),
    { data, pattern: '/w/$slug/captures/forms/$formId', at: '/w/acme/captures/forms/form-1' },
  );
  return started;
}

describe('Sync earlier submissions (AC-14)', () => {
  it('opens on Only unfiled, shows its counts, and has one button naming how many it syncs', async () => {
    const started = await open();
    const dialog = page.getByRole('dialog', { name: 'Sync earlier submissions?' });
    await expect.element(dialog.getByRole('radio', { name: 'Only unfiled' })).toBeChecked();
    const counts = dialog.getByRole('group', { name: 'What syncing would do' });
    // One count line; a count of none says nothing.
    await expect.element(counts).toHaveTextContent('9 new records and 3 records updated.');
    await expect.element(counts).not.toHaveTextContent('already match');
    // One button besides the way out, naming how many it syncs.
    const sync = dialog.getByRole('button', { name: /^Sync/ });
    await expect.element(sync).toHaveTextContent('Sync 12 submissions');
    await expect.element(dialog.getByRole('button', { name: /^Cancel/ })).toBeVisible();
    await userEvent.click(sync);
    expect(started).toEqual(['unfiled']);
  });

  it('All reads its own counts, says once that the ones it can’t sync stay as they are, and syncs all', async () => {
    const started = await open();
    // The segment's label takes the press, as a pointer's would.
    await userEvent.click(
      page.getByRole('radiogroup', { name: 'Which submissions' }).getByText('All', { exact: true }),
    );
    const sync = page.getByRole('button', { name: 'Sync 42 submissions' });
    await expect.element(sync).toBeEnabled();
    await expect
      .element(page.getByRole('group', { name: 'What syncing would do' }))
      .toHaveTextContent('9 new records, 20 records updated, 11 already match, and 2 can’t be synced.');
    await expect.element(page.getByText('Any that can’t be synced stay as they are.')).toBeVisible();
    await userEvent.click(sync);
    expect(started).toEqual(['all']);
  });

  it('with nothing to sync says so in one row and offers no Sync', async () => {
    const none: SyncPreview = { ...PREVIEWS.unfiled, total: 0, creates: 0, updates: 0 };
    await open({ unfiled: none, all: none });
    await expect.element(page.getByText('Nothing to sync')).toBeVisible();
    expect(page.getByRole('button', { name: /^Sync/ }).query()).toBeNull();
  });
});
