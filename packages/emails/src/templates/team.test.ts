// A member's own background work (late traps #19, #20, #74): a job that didn't finish, an import's result, and a
// form submission that couldn't be added to the CRM, each saying what happened and where to go.
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog.ts';
import { renderEmail } from '../index.ts';

const ORIGIN = 'https://app.example.com';
const context = { appOrigin: ORIGIN, workspaceName: 'Acme' };

describe('the job that didn’t finish', () => {
  it('names the job, says why, and opens Background jobs', async () => {
    const email = await renderEmail('job_failed', CATALOG.job_failed.sample, context);
    expect(email.subject).toBe('Didn’t finish: Bulk edit');
    expect(email.text).toContain('This job stopped after repeated errors. What it finished is kept.');
    expect(email.html).toContain(`href="${ORIGIN}/w/acme/settings/jobs`);
    expect(email.text).toContain('Open Background jobs');
  });
});

describe('an import’s result', () => {
  it('says up front when a finished import left rows out', async () => {
    const email = await renderEmail('import_finished', { ...CATALOG.import_finished.sample, failed: 12 }, context);
    expect(email.subject).toBe('Import finished, 12 rows not imported: People');
    expect(email.text).toContain('Not imported');
    expect(email.text).toContain('1,204');
  });

  it('tells a failed one what to do next', async () => {
    const email = await renderEmail(
      'import_finished',
      { ...CATALOG.import_finished.sample, outcome: 'failed' },
      context,
    );
    expect(email.subject).toBe('Import failed: People');
    expect(email.text).toContain('import the rest again or undo it');
  });
});

describe('a submission’s notice', () => {
  const preferences = { ...context, preferencesUrl: `${ORIGIN}/email-preferences#t=x` };

  it('says why this member got it', async () => {
    const lead = await renderEmail('form_submission', CATALOG.form_submission.sample, preferences);
    expect(lead.text).toContain('because this lead was given to you in Acme');
    const maker = await renderEmail(
      'form_submission',
      { ...CATALOG.form_submission.sample, reason: 'maker' },
      preferences,
    );
    expect(maker.text).toContain('because you made the form Contact us in Acme');
  });

  it('says when it couldn’t be added to the CRM', async () => {
    const email = await renderEmail(
      'form_submission',
      { ...CATALOG.form_submission.sample, filed: false },
      preferences,
    );
    expect(email.subject).toBe('Asha Rao filled in Contact us');
    expect(email.text).toContain('This submission couldn’t be added to the CRM. Open it to add it with Add to CRM.');
    expect(email.text).toContain('not added to the CRM');
  });
});
