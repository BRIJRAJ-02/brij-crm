// The one invite form in Chromium (owner, 22 October 2026): Settings › Members' Invite dialog with InviteRows
// (focus in the first email, Enter and "+ Add another" adding rows, a member or a live invitation refused in its
// row, one call per role), and InviteTeamDialog, which every other Invite button opens: it reads the team once it
// opens, then shows the same form, and offers Try again when that read fails.
import type { DataLayer, RoleOption } from '@crm/data';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { InviteDialog } from './InviteDialog.tsx';
import { InviteTeamDialog } from './InviteTeamDialog.tsx';

const ROLES: readonly RoleOption[] = [
  { id: 'r-admin', label: 'Admin', description: 'Manages people and settings.', builtIn: 'admin' },
  { id: 'r-member', label: 'Member', description: 'Works with records.', builtIn: 'member' },
];

/** A data layer holding the invite calls, counted. */
function fakeData(options: { readonly failTeam?: boolean; readonly refuseAll?: boolean } = {}) {
  const invites: { readonly emails: readonly string[]; readonly role: string }[] = [];
  let teamReads = 0;
  const data = {
    invitations: {
      create: (_slug: string, emails: readonly string[], role: string) => {
        invites.push({ emails, role });
        return Promise.resolve(
          options.refuseAll === true
            ? { invited: [], refused: emails.map((email) => ({ email })), unsent: [] }
            : { invited: emails.map((email) => ({ email })), refused: [], unsent: [] },
        );
      },
      list: () => Promise.resolve([{ email: 'pending@acme.com', isExpired: false }]),
    },
    access: {
      mine: () => {
        teamReads += 1;
        return options.failTeam === true && teamReads === 1
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({ role: 'admin', permissions: ['members.invite'], memberId: 'm1' });
      },
    },
    roles: { list: () => Promise.resolve({ roles: ROLES, defaultRole: 'r-member' }) },
    members: { list: () => Promise.resolve([{ email: 'Ada@acme.com' }]) },
  } as unknown as DataLayer;
  return { data, invites, teamReads: () => teamReads };
}

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
});

describe('the Invite dialog', () => {
  it('starts in the first email, adds rows by Enter and the plus, refuses who is in, and sends one call per role', async () => {
    const fake = fakeData();
    const closed = vi.fn();
    shown = await renderInApp(
      () => (
        <InviteDialog
          data={fake.data}
          slug="acme"
          isOpen
          onClose={closed}
          roles={ROLES}
          defaultRole="r-member"
          memberEmails={new Set(['ada@acme.com'])}
          invitedEmails={new Set(['pending@acme.com'])}
        />
      ),
      { data: fake.data, pattern: '/w/$slug/settings/members', at: '/w/acme/settings/members' },
    );
    const dialog = page.getByRole('dialog', { name: 'Invite people' });
    await expect.element(dialog.getByRole('textbox', { name: 'Email' })).toHaveFocus();
    // What each role can do sits by the Role column, not in the title bar.
    await expect.element(dialog.getByRole('button', { name: 'About Role' })).toBeVisible();

    await userEvent.keyboard('ada@acme.com{Enter}');
    await expect.element(dialog.getByRole('textbox', { name: 'Email 2' })).toHaveFocus();
    await userEvent.keyboard('pending@acme.com');
    await dialog.getByRole('button', { name: 'Add another person' }).click();
    await expect.element(dialog.getByRole('textbox', { name: 'Email 3' })).toHaveFocus();
    await userEvent.keyboard('grace@acme.com');
    await dialog.getByRole('button', { name: /Role for grace@acme.com/ }).click();
    await page.getByRole('option', { name: 'Admin' }).click();

    // Two rows are refused before anything is sent, and focus goes to the first.
    await dialog.getByRole('button', { name: 'Invite 1 person' }).click();
    await expect.element(dialog.getByRole('textbox', { name: 'Email', exact: true })).toHaveFocus();
    await expect.element(dialog.getByText('Already a member.')).toBeVisible();
    await expect.element(dialog.getByText('Already invited.')).toBeVisible();
    expect(fake.invites).toEqual([]);

    // Removed, the rest go out: one call per role.
    await dialog.getByRole('button', { name: 'Remove ada@acme.com' }).click();
    await dialog.getByRole('button', { name: 'Remove pending@acme.com' }).click();
    await expect.element(dialog.getByRole('button', { name: 'Remove grace@acme.com' })).not.toBeInTheDocument();
    await dialog.getByRole('button', { name: 'Invite 1 person' }).click();
    // A clean send closes the dialog and says how many in a toast (31 October 2026).
    await expect.element(page.getByText('Invited 1 person')).toBeVisible();
    expect(fake.invites).toEqual([{ emails: ['grace@acme.com'], role: 'admin' }]);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('keeps the summary when someone was refused: focus on Done, and Invite more starts again', async () => {
    const fake = fakeData({ refuseAll: true });
    shown = await renderInApp(
      () => (
        <InviteDialog
          data={fake.data}
          slug="acme"
          isOpen
          onClose={() => undefined}
          roles={ROLES}
          defaultRole="r-member"
          memberEmails={new Set()}
          invitedEmails={new Set()}
        />
      ),
      { data: fake.data, pattern: '/w/$slug/settings/members', at: '/w/acme/settings/members' },
    );
    const dialog = page.getByRole('dialog', { name: 'Invite people' });
    await userEvent.keyboard('grace@acme.com');
    await dialog.getByRole('button', { name: 'Invite 1 person' }).click();
    await expect.element(dialog.getByText('Already members: grace@acme.com.')).toBeVisible();
    await expect.element(dialog.getByRole('button', { name: 'Done' })).toHaveFocus();
    await dialog.getByRole('button', { name: 'Invite more' }).click();
    await expect.element(dialog.getByRole('textbox', { name: 'Email' })).toBeVisible();
  });
});

describe('InviteTeamDialog, for Invite buttons outside Members', () => {
  it('reads the team once it opens, then shows the same form with the roles this person may invite as', async () => {
    const fake = fakeData();
    shown = await renderInApp(
      () => <InviteTeamDialog data={fake.data} slug="acme" isOpen onClose={() => undefined} />,
      { data: fake.data, pattern: '/w/$slug/home', at: '/w/acme/home' },
    );
    const dialog = page.getByRole('dialog', { name: 'Invite people' });
    await expect.element(dialog.getByRole('textbox', { name: 'Email' })).toHaveFocus();
    await userEvent.keyboard('Ada@acme.com');
    await userEvent.tab();
    await expect.element(dialog.getByText('Already a member.')).toBeVisible();
    // An admin invites as Admin or Member, never Owner; rows start as Member.
    await expect.element(dialog.getByRole('button', { name: /Role for Ada@acme.com/ })).toHaveTextContent('Member');
  });

  it('says when the team couldn’t be read, and Try again reads it again', async () => {
    const fake = fakeData({ failTeam: true });
    shown = await renderInApp(
      () => <InviteTeamDialog data={fake.data} slug="acme" isOpen onClose={() => undefined} />,
      { data: fake.data, pattern: '/w/$slug/home', at: '/w/acme/home' },
    );
    const dialog = page.getByRole('dialog', { name: 'Invite people' });
    await expect.element(dialog.getByText(/Couldn’t load your team/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Try again' }).click();
    await expect.element(dialog.getByRole('textbox', { name: 'Email' })).toBeVisible();
    expect(fake.teamReads()).toBe(2);
  });
});
