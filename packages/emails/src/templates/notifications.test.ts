// The notifications email (spec 0038): the count and workspace in the subject,
// each notification linked on the app's origin, the inbox button, the
// settings link in the footer, and a refusal for a link off the app.
import { describe, expect, it } from 'vitest';
import { renderNotificationsEmail } from '../index.ts';

const ORIGIN = 'https://app.example.com';
const PARAMS = {
  items: [
    {
      sentence: 'Ada Lovelace mentioned you',
      recordName: 'Acme Corp',
      excerpt: 'Over to @Grace Hopper for the contract.',
      path: '/w/acme/objects/companies/abc/comments?thread=def',
    },
  ],
  more: 2,
  inboxPath: '/w/acme/inbox',
  settingsPath: '/w/acme/settings/account/notifications',
};

describe('the notifications email', () => {
  it('counts what waits, links each one and the inbox, and carries the settings link', async () => {
    const email = await renderNotificationsEmail(PARAMS, { appOrigin: ORIGIN, workspaceName: 'Acme' });
    expect(email.subject).toBe('3 new notifications in Acme');
    expect(email.html).toContain(`href="${ORIGIN}/w/acme/objects/companies/abc/comments?thread=def"`);
    expect(email.text).toContain('Ada Lovelace mentioned you on Acme Corp');
    expect(email.text).toContain('Over to @Grace Hopper for the contract.');
    expect(email.text).toContain('And 2 more in your inbox.');
    expect(email.text).toContain(`Open your inbox: ${ORIGIN}/w/acme/inbox`);
    expect(email.text).toContain(`Email preferences: ${ORIGIN}/w/acme/settings/account/notifications`);
  });

  it('says one notification in the singular', async () => {
    const email = await renderNotificationsEmail({ ...PARAMS, more: 0 }, { appOrigin: ORIGIN, workspaceName: 'Acme' });
    expect(email.subject).toBe('1 new notification in Acme');
  });

  it('names the daily digest in its subject and heading', async () => {
    const email = await renderNotificationsEmail(
      { ...PARAMS, digest: true },
      { appOrigin: ORIGIN, workspaceName: 'Acme' },
    );
    expect(email.subject).toBe('Your daily digest: 3 new notifications in Acme');
    expect(email.text).toContain('Your daily digest');
  });

  it('refuses a link off the app', async () => {
    const context = { appOrigin: ORIGIN, workspaceName: 'Acme' };
    await expect(renderNotificationsEmail({ ...PARAMS, inboxPath: '//evil.example/x' }, context)).rejects.toThrow();
  });
});
