// The Mailpit transport, the mailer's choice of transport, a refusal's code
// read back, and the worker's paced sends. The templates are packages/emails'
// own tests.
import { describe, expect, it } from 'vitest';
import { createMailer, mailRefused, pacedMailer, refusalOf, type Mailer, type MailMessage } from './mailer.ts';
import { createMailpitMailer, parseSender } from './mailpit.ts';

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

  it('reads back a refusal’s code and whether trying again can’t help, and nothing from any other error', () => {
    const refused = mailRefused('Resend', { code: 'invalid_parameter', permanent: true });
    expect(refused.message).toBe('Resend refused the message (invalid_parameter).');
    expect(refusalOf(refused)).toEqual({ code: 'invalid_parameter', permanent: true });
    expect(refusalOf(new Error('Unable to fetch data.'))).toBeUndefined();
    expect(refusalOf('refused')).toBeUndefined();
  });

  it('paces sends one at a time, each starting the gap after the one before', async () => {
    const events: string[] = [];
    const waits: number[] = [];
    let release: () => void = () => undefined;
    const inner: Mailer = {
      transport: 'mailpit',
      send: (message: MailMessage) => {
        events.push(`start ${message.subject}`);
        return Promise.resolve();
      },
    };
    const paced = pacedMailer(inner, 600, (ms) => {
      waits.push(ms);
      events.push('wait');
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const message = (subject: string) => ({ to: 'ada@example.com', subject, html: '', text: '' });
    const first = paced.send(message('1'));
    const second = paced.send(message('2'));
    await first;
    // The gap starts with the first send; the second waits for it.
    expect(events).toEqual(['wait', 'start 1']);
    release();
    await second;
    expect(events).toEqual(['wait', 'start 1', 'wait', 'start 2']);
    expect(waits).toEqual([600, 600]);
    expect(paced.transport).toBe('mailpit');
  });
});
