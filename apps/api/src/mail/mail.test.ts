// The code email and the Mailpit transport.
import { describe, expect, it } from 'vitest';
import { createMailer } from './mailer.ts';
import { createMailpitMailer, parseSender } from './mailpit.ts';
import { SIGN_IN_CODE_SUBJECT, signInCodeEmail } from './sign-in-code.ts';

describe('the sign in code email', () => {
  it('carries the code in both parts, and keeps it out of the subject', async () => {
    const email = await signInCodeEmail('482913');
    expect(email.subject).toBe(SIGN_IN_CODE_SUBJECT);
    expect(email.subject).not.toContain('482913');
    expect(email.html).toContain('482913');
    expect(email.html).toMatch(/<html[^>]* lang="en"/);
    expect(email.text).toContain('482913');
    expect(email.text).toContain('10 minutes');
  });
});

describe('the mail transport', () => {
  it('splits a sender into its name and address', () => {
    expect(parseSender('CRM <sign-in@crm.localhost>')).toEqual({ name: 'CRM', email: 'sign-in@crm.localhost' });
    expect(parseSender('onboarding@resend.dev')).toEqual({ name: undefined, email: 'onboarding@resend.dev' });
  });

  it("posts to Mailpit's send API, and throws when it refuses", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const answers = [new Response('{}', { status: 200 }), new Response('no', { status: 400 })];
    const mailer = createMailpitMailer({
      url: 'http://mailpit.test:8025',
      from: 'CRM <sign-in@crm.localhost>',
      fetch: (url, init) => {
        const body = typeof init?.body === 'string' ? init.body : '';
        const href = url instanceof Request ? url.url : url instanceof URL ? url.href : url;
        calls.push({ url: href, body: JSON.parse(body) as unknown });
        return Promise.resolve(answers.shift() ?? new Response(null, { status: 500 }));
      },
    });
    const message = { to: 'ada@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' };
    await mailer.send(message);
    expect(calls[0]).toEqual({
      url: 'http://mailpit.test:8025/api/v1/send',
      body: {
        From: { Email: 'sign-in@crm.localhost', Name: 'CRM' },
        To: [{ Email: 'ada@example.com' }],
        Subject: 'Hi',
        HTML: '<p>Hi</p>',
        Text: 'Hi',
      },
    });
    await expect(mailer.send(message)).rejects.toThrow('Mailpit refused the message with 400.');
  });

  it('picks Resend when its key is set, else Mailpit', () => {
    const from = 'onboarding@resend.dev';
    expect(createMailer({ RESEND_API_KEY: 're_test', MAIL_FROM: from, MAILPIT_URL: undefined }).transport).toBe(
      'resend',
    );
    expect(
      createMailer({ RESEND_API_KEY: undefined, MAIL_FROM: from, MAILPIT_URL: 'http://localhost:8025' }).transport,
    ).toBe('mailpit');
    expect(() => createMailer({ RESEND_API_KEY: undefined, MAIL_FROM: from, MAILPIT_URL: undefined })).toThrow();
  });
});
