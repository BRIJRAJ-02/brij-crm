// Settings › Background jobs in Chromium: Confirm on a counted change and
// Cancel on a job each ask first (the house rule in Modal's README). The
// confirm opens from its row, Esc and its dismiss change nothing and hand
// focus back, the commit runs once and shows busy until the answer, and the
// jobs table takes focus when the row's button went with the change (the
// page's title is hidden under the bar's trail).
import type { DataLayer, JobsSnapshot, JobsView, JobView } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { deferred, openDialog, renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { JobsScreen } from './JobsScreen.tsx';

/** What holds focus: the jobs table by its name, anything else by its text. */
const focusedName = (): string | undefined => {
  const focused = document.activeElement;
  return focused?.getAttribute('aria-label') === 'Background jobs'
    ? 'Background jobs'
    : (focused?.textContent ?? undefined);
};

/** A job as the store holds it, with what a test changes. */
function jobOf(overrides: Partial<JobView>): JobView {
  return {
    id: '0199f0a0-0000-7000-8000-000000000001',
    kind: 'records.bulk_delete',
    label: 'Bulk delete',
    status: 'ready',
    total: 12_345,
    done: 0,
    refused: 0,
    skipped: 0,
    startedBy: { type: 'member', memberId: '0199f0a0-0000-7000-8000-0000000000aa' },
    createdAt: '2026-10-21T09:00:00Z',
    expiresAt: '2026-10-21T10:00:00Z',
    cancellable: true,
    ...overrides,
  };
}

/** A jobs view holding `jobs`, which a test may change as the store would (a confirm queuing the job). */
function viewOf(jobs: readonly JobView[]) {
  let snapshot: JobsSnapshot = { status: 'ready', jobs, hasMore: false, loadingMore: false };
  const listeners = new Set<() => void>();
  const view: JobsView = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    more: () => Promise.resolve(),
    reload: () => Promise.resolve(),
  };
  const change = (next: readonly JobView[]) => {
    snapshot = { ...snapshot, jobs: next };
    for (const listener of listeners) listener();
  };
  return { view, change };
}

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/** The jobs page with these jobs, and the data layer's job writes as mocks. */
async function renderJobs(jobs: readonly JobView[], writes: Partial<DataLayer['jobs']>) {
  const { view, change } = viewOf(jobs);
  const data = { jobs: writes, members: { list: () => Promise.resolve([]) } } as unknown as DataLayer;
  shown = await renderInApp(
    () => <JobsScreen data={data} slug="acme" view={view} isAll={false} members={[]} canRunTest={false} />,
    { data, pattern: '/w/$slug/settings/jobs', at: '/w/acme/settings/jobs' },
  );
  return { change };
}

const confirmButton = () => page.getByRole('button', { name: 'Review', exact: true });
const alert = () => openDialog('alertdialog');
const dialog = () => openDialog();

describe('Review on a counted change', () => {
  it('closes its confirm when the job stops waiting for one elsewhere', async () => {
    const job = jobOf({});
    const confirm = vi.fn();
    const { change } = await renderJobs([job], { confirm, cancel: vi.fn() });
    await userEvent.click(confirmButton());
    await expect.poll(alert).not.toBeNull();
    change([{ ...job, status: 'queued' }]);
    await expect.poll(dialog).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks first, in the change’s own words, and Esc or Not now change nothing', async () => {
    const confirm = vi.fn(() => Promise.resolve(true));
    await renderJobs([jobOf({})], { confirm, cancel: vi.fn() });
    await userEvent.click(confirmButton());
    await expect.poll(alert).not.toBeNull();
    const asked = alert();
    expect(asked?.getAttribute('aria-labelledby')).not.toBeNull();
    expect(asked?.textContent).toContain('Delete 12,345 records?');
    expect(asked?.textContent).toContain('They stay in the trash for 30 days.');
    const buttons = [...(asked?.querySelectorAll('button') ?? [])].map((button) => button.textContent);
    expect(buttons[0]).toMatch(/^Not now/);
    expect(buttons.at(-1)).toBe('Delete 12,345 records');

    await userEvent.keyboard('{Escape}');
    await expect.poll(dialog).toBeNull();
    await expect.poll(() => document.activeElement?.textContent).toBe('Review');
    await userEvent.click(confirmButton());
    await expect.poll(alert).not.toBeNull();
    await userEvent.click(page.getByRole('button', { name: /^Not now/ }));
    await expect.poll(dialog).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('runs once, busy until the answer, then leaves focus in its row as the row moves on', async () => {
    const answer = deferred<boolean>();
    const confirm = vi.fn(() => answer.promise);
    const job = jobOf({});
    const { change } = await renderJobs([job], { confirm, cancel: vi.fn() });
    await userEvent.click(confirmButton());
    await expect.poll(alert).not.toBeNull();
    const commit = page.getByRole('button', { name: 'Delete 12,345 records' });
    await userEvent.click(commit);
    // Busy: its label says so and a second press sends nothing.
    await expect.poll(() => alert()?.textContent).toContain('Starting');
    await userEvent.click(page.getByRole('button', { name: /Starting/ }), { force: true });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('acme', job.id);
    // The store shows it queued at once, so the row's Confirm goes; then the server agrees.
    change([{ ...job, status: 'queued' }]);
    answer.resolve(true);
    await expect.poll(dialog).toBeNull();
    // Confirm went with the change: focus never falls to the page. It lands on what the row offers now when the
    // table hands it on, else on the jobs table.
    await expect
      .poll(focusedName)
      .toSatisfy((text: string | undefined) => text === 'Cancel' || text === 'Background jobs');
  });

  it('closes on a refusal too: the jobs store says why and puts the row back', async () => {
    const job = jobOf({});
    const answer = deferred<boolean>();
    const confirm = vi.fn(() => answer.promise);
    const { change } = await renderJobs([job], { confirm, cancel: vi.fn() });
    await userEvent.click(confirmButton());
    await userEvent.click(page.getByRole('button', { name: 'Delete 12,345 records' }));
    // As the store does: queued at once, then put back when the server refuses.
    change([{ ...job, status: 'queued' }]);
    await expect.poll(() => alert()?.textContent).toContain('Starting');
    change([job]);
    answer.resolve(false);
    await expect.poll(dialog).toBeNull();
    expect(confirm).toHaveBeenCalledTimes(1);
    // The row offers Review again; focus never falls to the page: back on Review when the table hands it on, else
    // on the jobs table (the Review that opened the confirm went and came back as a new button).
    await expect
      .poll(focusedName)
      .toSatisfy((text: string | undefined) => text === 'Review' || text === 'Background jobs');
    expect(page.getByRole('button', { name: 'Review', exact: true }).element()).toBeTruthy();
  });

  it('asks a restore plainly, with a primary commit', async () => {
    const confirm = vi.fn(() => Promise.resolve(true));
    await renderJobs([jobOf({ kind: 'records.bulk_restore', label: 'Restore from trash', total: 1 })], {
      confirm,
      cancel: vi.fn(),
    });
    await userEvent.click(confirmButton());
    await expect.poll(dialog).not.toBeNull();
    expect(alert()).toBeNull();
    expect(dialog()?.textContent).toContain('Restore 1 record?');
    await userEvent.click(page.getByRole('button', { name: 'Restore 1 record' }));
    await expect.poll(dialog).toBeNull();
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});

describe('Cancel on a job', () => {
  it('asks first; Keep job changes nothing; Cancel job cancels once', async () => {
    const cancel = vi.fn(() => Promise.resolve(true));
    const job = jobOf({ kind: 'dev.simulate', label: 'Test job', status: 'running', total: 20_000, done: 500 });
    await renderJobs([job], { confirm: vi.fn(), cancel });
    await userEvent.click(page.getByRole('button', { name: 'Cancel', exact: true }));
    await expect.poll(alert).not.toBeNull();
    expect(alert()?.textContent).toContain('Cancel “Test job”?');
    expect(alert()?.textContent).toContain('It stops before its next batch. What it already did stays done.');
    await userEvent.click(page.getByRole('button', { name: /^Keep job/ }));
    await expect.poll(dialog).toBeNull();
    expect(cancel).not.toHaveBeenCalled();
    await expect.poll(() => document.activeElement?.textContent).toBe('Cancel');

    await userEvent.keyboard('{Enter}');
    await expect.poll(alert).not.toBeNull();
    await userEvent.click(page.getByRole('button', { name: 'Cancel job' }));
    await expect.poll(dialog).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith('acme', job.id);
  });

  it('never drops focus to the page when the cancelled row has nothing left to press', async () => {
    const answer = deferred<boolean>();
    const cancel = vi.fn(() => answer.promise);
    const job = jobOf({ kind: 'dev.simulate', label: 'Test job', status: 'queued' });
    const { change } = await renderJobs([job], { confirm: vi.fn(), cancel });
    await userEvent.click(page.getByRole('button', { name: 'Cancel', exact: true }));
    await userEvent.click(page.getByRole('button', { name: 'Cancel job' }));
    await expect.poll(() => alert()?.textContent).toContain('Cancelling');
    change([{ ...job, status: 'cancelled', cancellable: false }]);
    answer.resolve(true);
    await expect.poll(dialog).toBeNull();
    await expect.poll(() => document.activeElement === document.body).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('the status and progress cells', () => {
  it('marks each state with its dot and leaves a finished empty job’s progress blank', async () => {
    await renderJobs(
      [
        jobOf({ id: '0199f0a0-0000-7000-8000-000000000011', status: 'succeeded', total: undefined }),
        jobOf({ id: '0199f0a0-0000-7000-8000-000000000012', status: 'failed', total: undefined, done: 4 }),
      ],
      { confirm: vi.fn(), cancel: vi.fn() },
    );
    await expect.element(page.getByText('Done', { exact: true })).toBeVisible();
    const dots = [...document.querySelectorAll('[data-hue]')].map((dot) => dot.getAttribute('data-hue'));
    expect(dots).toEqual(['green', 'red']);
    // The failed job handled 4, so it says so; the done one handled nothing and says nothing.
    expect(document.body.textContent).toContain('4 so far');
    expect(document.body.textContent).not.toContain('0 so far');
  });
});
