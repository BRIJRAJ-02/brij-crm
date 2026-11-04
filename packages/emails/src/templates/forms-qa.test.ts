// The forms QA lane (5 November 2026): what a visitor types reaches the team's notice and their own copy as text.
// Markup in a name, an answer or a form's name is drawn as its characters in the HTML (never a tag a mail client
// runs or shows as a link), kept as typed in the plain text, and a line break never reaches the subject.
import { describe, expect, it } from 'vitest';
import { renderEmail } from '../index.ts';

const ORIGIN = 'https://app.example.com';
const AT = '2026-11-05T10:00:00.000Z';
const SCRIPT = '<script>alert("x")</script>';
const IMG = '<img src=x onerror=alert(1)>';
const LINK = '<a href="https://evil.example">Reset your password</a>';

describe('a form’s emails draw what a visitor typed as text', () => {
  it('escapes markup in the notice’s sender, answers and form name, and keeps it as typed in the text part', async () => {
    const email = await renderEmail(
      'form_submission',
      {
        formName: `Contact ${IMG}`,
        submitter: { name: `Ada ${SCRIPT}`, email: 'ada@example.com' },
        answers: [
          { label: 'About you', value: `${LINK}\n${SCRIPT}` },
          { label: `Label ${IMG}`, value: '=HYPERLINK("http://evil.example")' },
        ],
        submittedAt: AT,
        submissionPath: '/w/acme/captures/forms/0199f1d2-7c3a-7cc1-9a51-0d5f1e2a3b4c',
        reason: 'listed',
      },
      { appOrigin: ORIGIN, workspaceName: 'Acme', preferencesUrl: `${ORIGIN}/preferences` },
    );
    for (const raw of [SCRIPT, IMG, LINK]) expect(email.html).not.toContain(raw);
    expect(email.html).not.toMatch(/<script\b/i);
    expect(email.html).not.toMatch(/<img[^>]+onerror/i);
    expect(email.html).not.toContain('href="https://evil.example"');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.text).toContain(SCRIPT);
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it('keeps a line break a visitor’s name smuggles out of the subject', async () => {
    const email = await renderEmail(
      'form_submission',
      {
        formName: 'Contact us',
        submitter: { name: 'Ada\r\nBcc: everyone@example.com' },
        answers: [],
        submittedAt: AT,
        submissionPath: '/w/acme/captures/forms/0199f1d2-7c3a-7cc1-9a51-0d5f1e2a3b4c',
      },
      { appOrigin: ORIGIN, preferencesUrl: `${ORIGIN}/preferences` },
    );
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject.startsWith('Ada Bcc')).toBe(true);
  });

  it('escapes markup in the visitor’s own copy', async () => {
    const email = await renderEmail(
      'form_confirmation',
      {
        formName: 'Contact us',
        answers: [{ label: 'Name', value: `${IMG} ${LINK}` }],
        submittedAt: AT,
      },
      { appOrigin: ORIGIN, workspaceName: 'Acme' },
    );
    expect(email.html).not.toMatch(/<img[^>]+onerror/i);
    expect(email.html).not.toContain('href="https://evil.example"');
  });
});
