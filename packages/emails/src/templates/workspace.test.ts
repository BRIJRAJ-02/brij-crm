// A deleted workspace's notice (spec 0031, AC-823): an owner's has the way back, anyone else's doesn't.
import { describe, expect, it } from 'vitest';
import { renderWorkspaceDeleted } from '../index.ts';

const ORIGIN = 'https://app.example.com';
const context = { appOrigin: ORIGIN, workspaceName: 'Acme' };

describe('the workspace deleted email', () => {
  it('gives an owner the link to restore it', async () => {
    const email = await renderWorkspaceDeleted(
      { deletedBy: 'Ada Lovelace', until: '19 November 2026', restorePath: '/w/acme' },
      context,
    );
    expect(email.subject).toBe('Acme was deleted');
    expect(email.html).toContain(`href="${ORIGIN}/w/acme"`);
    expect(email.text).toContain('As an owner, you can restore it until 19 November 2026.');
  });

  it('tells a member who can restore it, with no button', async () => {
    const email = await renderWorkspaceDeleted({ deletedBy: 'Ada Lovelace', until: '19 November 2026' }, context);
    expect(email.html).not.toContain(`href="${ORIGIN}/w/acme"`);
    expect(email.text).toContain('Its owners can restore it until 19 November 2026.');
  });
});
