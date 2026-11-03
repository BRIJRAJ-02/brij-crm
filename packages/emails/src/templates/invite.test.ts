// The invitation email (spec 0031): its words, the accept link on the app's
// origin, the shared footer, light and dark, and a refusal for params the
// template doesn't know.
import { describe, expect, it } from 'vitest';
import { renderMemberInvite } from '../index.ts';

const ORIGIN = 'https://app.example.com';
const PARAMS = {
  inviterName: 'Ada Lovelace',
  role: 'admin',
  acceptPath: '/invite/0123456789abcdefghijklmnopqrstuv',
  expiresAt: '2026-10-28T13:05:00.000Z',
} as const;

describe('the invitation email', () => {
  it('names who invited, the workspace and the role, with the accept link and until when it works', async () => {
    const email = await renderMemberInvite(PARAMS, { appOrigin: ORIGIN, workspaceName: 'Acme' });
    expect(email.subject).toBe('Ada Lovelace invited you to Acme on Timefix');
    expect(email.html).toContain('Join Acme as an admin. The invitation works until 28 October.');
    expect(email.html).toContain(`href="${ORIGIN}/invite/0123456789abcdefghijklmnopqrstuv"`);
    expect(email.html).toContain('@media (prefers-color-scheme: dark)');
    expect(email.text).toBe(
      [
        'Acme',
        '',
        'Join Acme on Timefix',
        '',
        'Ada Lovelace invited you to join Acme as an admin.',
        '',
        `Accept invitation: ${ORIGIN}/invite/0123456789abcdefghijklmnopqrstuv`,
        '',
        'The invitation works until 28 October, and only for this address. If you weren’t expecting it, you can ignore this email.',
        '',
        'Powered by Timefix: https://www.timefix.com/?utm_source=timefix&utm_medium=email_invite&utm_campaign=powered_by&utm_content=footer_logo',
        'You got this email because Ada Lovelace invited this address to Acme.',
      ].join('\n'),
    );
  });

  it('names a custom role by its own name (spec 0037)', async () => {
    const email = await renderMemberInvite(
      { ...PARAMS, role: 'member', roleName: 'Receptionist' },
      { appOrigin: ORIGIN, workspaceName: 'Acme' },
    );
    expect(email.text).toContain('Ada Lovelace invited you to join Acme as a Receptionist.');
    const analyst = await renderMemberInvite(
      { ...PARAMS, role: 'member', roleName: 'Analyst' },
      { appOrigin: ORIGIN, workspaceName: 'Acme' },
    );
    expect(analyst.text).toContain('as an Analyst.');
  });

  it('refuses an accept link off the app, and params it doesn’t know', async () => {
    const context = { appOrigin: ORIGIN, workspaceName: 'Acme' };
    await expect(renderMemberInvite({ ...PARAMS, acceptPath: '//evil.example/invite' }, context)).rejects.toThrow();
    await expect(
      renderMemberInvite({ ...PARAMS, acceptPath: 'https://evil.example/invite' }, context),
    ).rejects.toThrow();
    await expect(renderMemberInvite({ ...PARAMS, extra: 'x' } as unknown as typeof PARAMS, context)).rejects.toThrow();
  });
});
