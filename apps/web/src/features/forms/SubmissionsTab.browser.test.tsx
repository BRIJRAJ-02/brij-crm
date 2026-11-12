import '@crm/ui/app.css';
// The Submissions tab in Chromium (forms fixes a4, a8, a10): a returning person's row is tagged and opens one way,
// spam waits behind its own chip, and an open submission says why it is spam, names the answers filing kept off
// the record with Use new, and steps to the next one with J.
import type { DataLayer, ObjectSummary, SubmissionSummary, SubmissionView } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { SubmissionsTab } from './SubmissionsTab.tsx';

const PEOPLE = '0199f0a0-0000-7000-8000-00000000000b';
const FORM = '0199f0a0-0000-7000-8000-0000000000f1';
const OBJECTS = [
  {
    id: PEOPLE,
    apiSlug: 'people',
    singularName: 'Person',
    pluralName: 'People',
    icon: 'user',
    hue: 'blue',
    standardKey: 'people',
    access: 'write',
    position: 0,
    isStandard: true,
    isArchived: false,
  },
] as unknown as readonly ObjectSummary[];
const QUESTIONS = [
  { id: 'name', key: 'name', label: 'Your name' },
  { id: 'email', key: 'email', label: 'Work email' },
  { id: 'title', key: 'title', label: 'Job title' },
];
const id = (n: number) => `0199f0a0-0000-7000-8000-00000000010${String(n)}`;
const record = (n: number, name: string) => ({
  objectId: PEOPLE,
  recordId: `0199f0a0-0000-7000-8000-00000000020${String(n)}`,
  name,
});

function row(n: number, name: string, extra: Partial<SubmissionSummary> = {}): SubmissionSummary {
  return {
    id: id(n),
    formId: FORM,
    state: 'processed',
    receivedAt: new Date(Date.now() - n * 3_600_000).toISOString(),
    verdict: 'passed',
    mainRecord: record(n, name),
    email: `${name.toLowerCase().replace(/\s/g, '.')}@acme.com`,
    firstAnswers: [{ questionId: 'name', key: 'name', label: 'Your name', answerType: 'short_text', value: name }],
    crm: { state: 'linked', record: record(n, name) },
    ...extra,
  } as SubmissionSummary;
}

const ROWS = [row(1, 'Grace Hopper', { isReturning: true }), row(2, 'Ada Lovelace'), row(3, 'Alan Turing')];

const OPEN: SubmissionView = {
  ...ROWS[0],
  versionNumber: 1,
  answers: [
    { questionId: 'name', key: 'name', label: 'Your name', answerType: 'short_text', value: 'Grace Hopper' },
    {
      questionId: 'title',
      key: 'title',
      label: 'Job title',
      answerType: 'short_text',
      value: 'Rear admiral',
      attributeId: id(9),
    },
  ],
  hidden: {},
  signals: [],
  records: [{ role: 'main', action: 'updated', record: record(1, 'Grace Hopper') }],
  refused: [],
  kept: [{ questionId: 'title' }],
} as unknown as SubmissionView;

let shown: InApp | undefined;
const used: string[] = [];
/** What Delete and Undo asked the server for, in order. */
const calls: string[] = [];
/** Whether a bulk delete is refused, so the rows come back. */
let deleteRefused = false;
/** Holds a bulk delete's answer until the test lets it land, so the rows can be seen gone meanwhile. */
let landDelete: (() => void) | undefined;
/** Whether the small export is refused as too large, so the job takes it. */
let exportTooLarge = false;

beforeAll(async () => {
  await page.viewport(1280, 900);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  used.length = 0;
  calls.length = 0;
  exportTooLarge = false;
  deleteRefused = false;
  landDelete = undefined;
});

async function show(open: SubmissionView | undefined, spamCount = 2) {
  const data = {
    submissions: {
      useNewAnswer: (_slug: string, _submissionId: string, questionId: string) => {
        used.push(questionId);
        return Promise.resolve(open);
      },
      undoUseNewAnswer: (_slug: string, _submissionId: string, questionId: string) => {
        used.push(`undo ${questionId}`);
        return Promise.resolve(open);
      },
      delete: (_slug: string, submissionId: string) => {
        calls.push(`delete ${submissionId}`);
        return Promise.resolve({ deleted: true });
      },
      deleteMany: (_slug: string, _formId: string, ids: readonly string[]) => {
        calls.push(`deleteMany ${ids.join(',')}`);
        if (deleteRefused) {
          return Promise.reject(Object.assign(new Error('Try again.'), { name: 'DataError', code: 'INTERNAL' }));
        }
        return new Promise((resolve) => {
          landDelete = () => {
            resolve({ deletedIds: [...ids], stillFiling: 0, skipped: 0 });
          };
        });
      },
      restoreMany: (_slug: string, _formId: string, ids: readonly string[]) => {
        calls.push(`restoreMany ${ids.join(',')}`);
        return Promise.resolve({ restoredIds: [...ids], skipped: 0 });
      },
      exportNow: () => {
        calls.push('exportNow');
        if (exportTooLarge) {
          const error = Object.assign(new Error('More than 1,000 submissions export in the background.'), {
            name: 'DataError',
            code: 'JOB_TOO_LARGE',
          });
          return Promise.reject(error);
        }
        return Promise.resolve({ fileName: 'Talk to us - submissions.csv', csv: 'a,b\r\n' });
      },
      export: () => {
        calls.push('export');
        return new Promise(() => undefined);
      },
      newId: () => '0199f0a0-0000-7000-8000-0000000000ee',
      restore: (_slug: string, submissionId: string) => {
        calls.push(`restore ${submissionId}`);
        return Promise.resolve(open);
      },
    },
  } as unknown as Partial<DataLayer>;
  shown = await renderInApp(
    () => (
      <SubmissionsTab
        slug="acme"
        formId={FORM}
        objects={OBJECTS}
        page={{ items: ROWS }}
        state={undefined}
        open={open}
        canManage
        questions={QUESTIONS}
        link="https://app.example.com/f/talk"
        formName="Talk to us"
        followJob={() => undefined}
        isFiling
        hasSubmissions
        spamCount={spamCount}
      />
    ),
    { data, pattern: '/w/$slug/captures/forms/$formId', at: `/w/acme/captures/forms/${FORM}?tab=submissions` },
  );
  return shown;
}

describe('the Submissions tab (forms fixes a4, a8, a10)', () => {
  it('tags a returning person, keeps spam behind its chip, and has one click target per row', async () => {
    await show(undefined);
    await expect.element(page.getByText('Returning')).toBeVisible();
    await expect.element(page.getByRole('button', { name: '2 spam' })).toBeVisible();
    // The person's chip shows who, never links away: the row opens the panel.
    expect(page.getByRole('row').filter({ hasText: 'Ada Lovelace' }).getByRole('link').query()).toBeNull();
  });

  it('names an answer filing kept off the record, with Use new, and steps on with J', async () => {
    const app = await show(OPEN);
    await expect.element(page.getByText('Grace Hopper already had a different answer here')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Use the new answer for Job title' }));
    expect(used).toEqual(['title']);
    // Undo puts the record's value before back (forms fixes 2).
    await userEvent.click(page.getByRole('button', { name: 'Undo' }));
    await expect.poll(() => used).toEqual(['title', 'undo title']);
    await expect.element(page.getByRole('button', { name: 'Previous submission' })).toBeDisabled();
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard('j');
    await expect.poll(() => app.router.state.location.href).toContain(`submission=${id(2)}`);
  });

  it('deletes from ⋯ asking nothing, and Undo puts it back and opens it again (forms fixes 2, lane 3c)', async () => {
    const app = await show(OPEN);
    // Delete sits in the footer's ⋯ (lane 3c): the footer's end holds the one primary.
    await userEvent.click(page.getByRole('dialog').getByRole('button', { name: 'More actions' }));
    await userEvent.click(page.getByRole('menuitem', { name: 'Delete' }));
    expect(page.getByRole('button', { name: 'Delete submission' }).query()).toBeNull();
    expect(calls).toEqual([`delete ${id(1)}`]);
    await expect.element(page.getByText('Submission deleted.')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Undo' }));
    await expect.poll(() => calls).toEqual([`delete ${id(1)}`, `restore ${id(1)}`]);
    await expect.element(page.getByText('Submission restored.')).toBeVisible();
    await expect.poll(() => app.router.state.location.href).toContain(`submission=${id(1)}`);
  });

  it('floats the bulk bar at the foot, after the rows, and lets it sink out once cleared (owner, 5 November 2026)', async () => {
    await show(undefined);
    await userEvent.click(page.getByRole('checkbox', { name: 'Select Ada Lovelace' }), { force: true });
    const bar = page.getByRole('toolbar', { name: 'Selected records' });
    await expect.element(bar).toBeVisible();
    await expect.element(bar.getByText('1 selected')).toBeVisible();
    // Last in the body, after the table: at the view's foot, never above the rows.
    const table = page.getByRole('grid').element();
    expect(table.compareDocumentPosition(bar.element()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(bar.getByRole('button', { name: 'Clear the selection' }));
    await expect.poll(() => bar.query()).toBeNull();
  });

  it('deletes the picked ones in one request, gone at once, and one Undo brings them back (forms fixes 3)', async () => {
    await show(undefined);
    await userEvent.click(page.getByRole('checkbox', { name: 'Select All' }), { force: true });
    await userEvent.click(page.getByRole('button', { name: 'Delete', exact: true }));
    expect(calls.filter((call) => call.startsWith('deleteMany'))).toHaveLength(1);
    // Gone at once, while the request is still out.
    await expect.element(page.getByRole('row').filter({ hasText: 'Ada Lovelace' })).not.toBeInTheDocument();
    landDelete?.();
    await userEvent.click(page.getByRole('button', { name: 'Undo' }));
    await expect.poll(() => calls.filter((call) => call.startsWith('restoreMany'))).toHaveLength(1);
    await expect.element(page.getByRole('row').filter({ hasText: 'Ada Lovelace' })).toBeVisible();
  });

  it('brings the rows back, still picked, when a bulk delete is refused (forms fixes 3)', async () => {
    deleteRefused = true;
    await show(undefined);
    await userEvent.click(page.getByRole('checkbox', { name: 'Select All' }), { force: true });
    await userEvent.click(page.getByRole('button', { name: 'Delete', exact: true }));
    await expect.element(page.getByText('Try again.')).toBeVisible();
    await expect.element(page.getByRole('row').filter({ hasText: 'Ada Lovelace' })).toBeVisible();
    await expect.element(page.getByRole('checkbox', { name: 'Select All' })).toBeChecked();
  });

  it('reads each row as two lines on a phone, with nothing to scroll sideways (forms fixes 2)', async () => {
    await page.viewport(390, 844);
    try {
      await show(undefined);
      const row = page.getByRole('row').filter({ hasText: 'Ada Lovelace' });
      await expect.element(row).toBeVisible();
      // The header's labels are clipped out of sight but still read, select all stays in view, and the table fits.
      const person = page.getByRole('columnheader', { name: 'Person' }).element().getBoundingClientRect();
      expect(person.width).toBeLessThanOrEqual(1);
      const selectAll = document.querySelector('thead [data-handle]')?.getBoundingClientRect();
      expect(selectAll?.width ?? 0).toBeGreaterThan(1);
      // The table's own frame (its rows run out to the tab's edges, so the frame, not its parent, is the box to check).
      const frame = document.querySelector('[data-phone="rows"]');
      expect(frame === null ? 0 : frame.scrollWidth - frame.clientWidth).toBeLessThanOrEqual(0);
      // The person on the first line, when under it.
      const name = row.getByRole('rowheader').element().getBoundingClientRect();
      const when = row.getByRole('gridcell').nth(2).element().getBoundingClientRect();
      expect(when.top).toBeGreaterThanOrEqual(name.bottom - 1);
    } finally {
      await page.viewport(1280, 900);
    }
  });

  it('saves a small export at once, and sends a large one to the background (forms fixes 2)', async () => {
    await show(undefined);
    await userEvent.click(page.getByRole('button', { name: /Export/ }));
    await expect.element(page.getByText('Saved Talk to us - submissions.csv.')).toBeVisible();
    expect(calls).toEqual(['exportNow']);
    exportTooLarge = true;
    await userEvent.click(page.getByRole('button', { name: /Export/ }));
    await expect.poll(() => calls).toEqual(['exportNow', 'exportNow', 'export']);
  });
});
