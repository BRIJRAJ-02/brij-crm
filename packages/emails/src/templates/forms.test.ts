// The form emails (forms fixes 2): the visitor's copy wears the workspace's own logo when it has one (critique b3),
// and the dates read short (critique N2).
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog.ts';
import { formatShortMoment } from '../format.ts';
import { renderEmail } from '../index.ts';

const ORIGIN = 'https://app.example.com';
const context = { appOrigin: ORIGIN, workspaceName: 'Acme' };

describe('the visitor’s copy of a form', () => {
  it('heads the email with the workspace’s logo, named by the workspace, when it has one', async () => {
    const logoPath = '/api/public/forms/talk-to-us/logo?v=abc123';
    const email = await renderEmail('form_confirmation', { ...CATALOG.form_confirmation.sample, logoPath }, context);
    expect(email.html).toContain(`src="${ORIGIN}${logoPath.replace('&', '&amp;')}"`);
    expect(email.html).toContain('alt="Acme"');
  });

  it('has no logo of the workspace’s when it has none', async () => {
    const email = await renderEmail('form_confirmation', CATALOG.form_confirmation.sample, context);
    expect(email.html).not.toContain('/logo?v=');
  });
});

describe('short dates (critique N2)', () => {
  it('reads a moment as a weekday, a day and a month, its time and the zone as a person says it', () => {
    expect(formatShortMoment('2026-11-02T09:00:00.000Z', 'Europe/London')).toBe('Mon 2 Nov, 9:00 AM, London time');
    expect(formatShortMoment('2025-11-03T09:00:00.000Z', 'UTC', new Date('2026-11-02T00:00:00.000Z'))).toBe(
      'Mon 3 Nov 2025, 9:00 AM, UTC',
    );
  });

  it('dates a new submission short', async () => {
    const email = await renderEmail('form_submission', CATALOG.form_submission.sample, {
      ...context,
      preferencesUrl: `${ORIGIN}/settings/notifications`,
    });
    expect(email.text).not.toMatch(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \d/);
  });
});
