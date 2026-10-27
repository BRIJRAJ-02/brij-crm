// Domain join's emails (spec 0031): their words, the one link on the app's origin, and a refusal for params the
// template doesn't know.
import { describe, expect, it } from 'vitest';
import { renderJoinApproved, renderJoinRequest } from '../index.ts';

const ORIGIN = 'https://app.example.com';

describe('the join emails', () => {
  it('tells an admin who asked, with the link to review it', async () => {
    const email = await renderJoinRequest(
      { requesterName: 'Grace Hopper', requesterEmail: 'grace@acme.com', reviewPath: '/w/acme/settings/members' },
      { appOrigin: ORIGIN, workspaceName: 'Acme' },
    );
    expect(email.subject).toBe('Grace Hopper (grace@acme.com) asked to join Acme');
    expect(email.html).toContain(`href="${ORIGIN}/w/acme/settings/members"`);
    expect(email.text).toContain('Grace Hopper (grace@acme.com) would like to join Acme.');
  });

  it('tells the person they are in, with the link into the workspace', async () => {
    const email = await renderJoinApproved({ openPath: '/w/acme' }, { appOrigin: ORIGIN, workspaceName: 'Acme' });
    expect(email.subject).toBe('You’ve joined Acme on Timefix');
    expect(email.html).toContain(`href="${ORIGIN}/w/acme"`);
  });

  it('says their link page is ready, written on the public host, with only its editor linked', async () => {
    const email = await renderJoinApproved(
      { openPath: '/w/acme', linkPage: { handle: 'grace-hopper', editPath: '/w/acme/link-page' } },
      { appOrigin: ORIGIN, workspaceName: 'Acme', publicOrigin: 'https://timefix.com' },
    );
    expect(email.text).toContain('timefix.com/grace-hopper');
    expect(email.html).not.toContain(`href="${ORIGIN}/grace-hopper"`);
    expect(email.html).toContain(`href="${ORIGIN}/w/acme/link-page"`);
    expect(email.html).not.toContain('href="https://timefix.com');
  });

  it('refuses a requester name that breaks the line', async () => {
    await expect(
      renderJoinRequest(
        { requesterName: 'Grace\r\nBcc: x@evil.example', requesterEmail: 'grace@acme.com', reviewPath: '/w/acme' },
        { appOrigin: ORIGIN, workspaceName: 'Acme' },
      ),
    ).rejects.toThrow();
  });

  it('refuses a link to another site', async () => {
    await expect(
      renderJoinApproved({ openPath: '//evil.example' }, { appOrigin: ORIGIN, workspaceName: 'Acme' }),
    ).rejects.toThrow();
  });
});
