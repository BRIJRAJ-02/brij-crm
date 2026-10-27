// Welcome to a workspace (26 Oct 2026): the link page every membership gets, said and linked on the app's origin.
import { describe, expect, it } from 'vitest';
import { renderEmail } from '../index.ts';

const ORIGIN = 'https://app.example.com';

describe('the welcome email', () => {
  it('says the link page is live and unlisted, and links to it and to its editor', async () => {
    const email = await renderEmail(
      'workspace_welcome',
      { openPath: '/w/acme', linkPage: { handle: 'ada-lovelace', editPath: '/w/acme/link-page' } },
      { appOrigin: ORIGIN, workspaceName: 'Acme', publicOrigin: 'https://timefix.com' },
    );
    expect(email.subject).toBe('Welcome to Acme on Timefix');
    expect(email.text).toContain(
      'Your link page is live. Anyone with its address can open it; search engines aren’t told about it until you say so.',
    );
    expect(email.text).toContain('timefix.com/ada-lovelace');
    expect(email.html).toContain(`href="${ORIGIN}/w/acme"`);
    // Private until they act: a link to it would open nothing, for them or for anyone they forward it to.
    // Its address is linked now that the page answers from the moment it exists (27 October 2026).
    expect(email.html).toContain(`href="${ORIGIN}/ada-lovelace"`);
    expect(email.html).toContain(`href="${ORIGIN}/w/acme/link-page"`);
    expect(email.html).not.toContain('href="https://timefix.com');
  });

  it('writes the app’s host when the public pages have no origin of their own', async () => {
    const email = await renderEmail(
      'workspace_welcome',
      { openPath: '/w/acme', linkPage: { handle: 'ada', editPath: '/w/acme/link-page' } },
      { appOrigin: ORIGIN, workspaceName: 'Acme' },
    );
    expect(email.text).toContain('app.example.com/ada');
  });

  it('tells the person who made the workspace that it is ready, not that they joined', async () => {
    const email = await renderEmail(
      'workspace_welcome',
      { openPath: '/w/acme', created: true },
      { appOrigin: ORIGIN, workspaceName: 'Acme' },
    );
    expect(email.text).toContain('Your workspace Acme is ready.');
    expect(email.text).toContain('because you created Acme');
  });

  it('welcomes without a link page when none was made yet', async () => {
    const email = await renderEmail('workspace_welcome', { openPath: '/w/acme' }, { appOrigin: ORIGIN });
    expect(email.text).not.toContain('link page');
  });

  it('refuses a handle that is not one', async () => {
    await expect(
      renderEmail(
        'workspace_welcome',
        { openPath: '/w/acme', linkPage: { handle: '../evil', editPath: '/w/acme/link-page' } },
        { appOrigin: ORIGIN },
      ),
    ).rejects.toThrow();
  });
});
