// The invitation page signed in, in Chromium (QA N14): Your name sits over Join workspace, prefilled as first run
// makes it (the account's name, else one made from the address), and what is there, edited or emptied, goes with
// the join; Enter in it joins too. axe passes in light and dark.
import '@crm/ui/styles.css';
import type { DataLayer, InvitePeek, SignedInUser } from '@crm/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { InviteScreen } from './InviteScreen.tsx';

const TOKEN = 't'.repeat(43);

const INVITATION: InvitePeek = { workspaceName: 'Acme', inviterName: 'Ada', role: 'member' };

const userOf = (name: string, email: string): SignedInUser => ({
  id: '00000000-0000-4000-8000-000000000001',
  name,
  email,
});

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

/** The page for `user`, with an accept that answers once the test says (never, by default). */
async function renderInvite(user: SignedInUser) {
  const accept = vi.fn((_token: string, _name?: string) => new Promise<{ slug: string }>(() => undefined));
  const data = { invitations: { accept } } as unknown as DataLayer;
  shown = await renderInApp(() => <InviteScreen data={data} token={TOKEN} invitation={INVITATION} user={user} />, {
    data,
    pattern: '/invite/$token',
    at: `/invite/${TOKEN}`,
  });
  return accept;
}

const nameField = () => page.getByRole('textbox', { name: 'Your name' });

describe('the signed in invite card asks Your name (QA N14)', () => {
  it('prefills the name made from the address, and joins with it as edited', async () => {
    const accept = await renderInvite(userOf('', 'jo.smith-1722@example.com'));
    await expect.element(nameField()).toHaveValue('Jo Smith');
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Joanna Smith');
    await userEvent.click(page.getByRole('button', { name: 'Join workspace' }));
    expect(accept).toHaveBeenCalledExactlyOnceWith(TOKEN, 'Joanna Smith');
    // Joining: the button waits, and a second press sends nothing.
    await expect.element(page.getByRole('button', { name: /Join/ })).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Enter}');
    expect(accept).toHaveBeenCalledOnce();
  });

  it('prefills the account’s own name, and joins on Enter in the field', async () => {
    const accept = await renderInvite(userOf('Grace Hopper', 'grace@example.com'));
    await expect.element(nameField()).toHaveValue('Grace Hopper');
    await userEvent.click(nameField());
    await userEvent.keyboard('{Enter}');
    expect(accept).toHaveBeenCalledExactlyOnceWith(TOKEN, 'Grace Hopper');
  });

  it('is optional: emptied, it still joins, and the server names them', async () => {
    const accept = await renderInvite(userOf('', 'sam@example.com'));
    await userEvent.clear(nameField());
    await userEvent.click(page.getByRole('button', { name: 'Join workspace' }));
    expect(accept).toHaveBeenCalledExactlyOnceWith(TOKEN, '');
  });

  it('passes axe in light and dark', async () => {
    await renderInvite(userOf('', 'jo.smith@example.com'));
    await expect.element(nameField()).toBeVisible();
    for (const theme of THEMES) {
      applyTheme(theme);
      expect(await axeViolations(), theme).toEqual([]);
    }
    resetTheme();
  });
});

describe('an invitation that opens nothing (expired, revoked, used) has a way on that fits who is here', () => {
  const renderExpired = async (user: SignedInUser | undefined, hasWorkspace: boolean) => {
    const data = {} as unknown as DataLayer;
    shown = await renderInApp(
      () => (
        <InviteScreen data={data} token={TOKEN} invitation={undefined} user={user} hasWorkspace={hasWorkspace} />
      ),
      { data, pattern: '/invite/$token', at: `/invite/${TOKEN}` },
    );
  };

  it('asks for a new invitation, and offers their workspaces to someone who has one', async () => {
    await renderExpired(userOf('Ada', 'ada@acme.dev'), true);
    await expect.element(page.getByRole('heading', { level: 1, name: 'This invitation is no longer valid' })).toBeVisible();
    await expect.element(page.getByText('Ask whoever invited you to send a new one.')).toBeVisible();
    await expect.element(page.getByRole('link', { name: 'Go to your workspaces' })).toHaveAttribute('href', '/');
  });

  it('offers making a workspace to someone signed in with none, never "your workspaces"', async () => {
    await renderExpired(userOf('Ada', 'ada@acme.dev'), false);
    await expect.element(page.getByRole('link', { name: 'Create a workspace' })).toHaveAttribute('href', '/welcome');
    expect(page.getByRole('link', { name: 'Go to your workspaces' }).query()).toBeNull();
  });

  it('offers Sign in to someone signed out', async () => {
    await renderExpired(undefined, false);
    await expect.element(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  });
});
