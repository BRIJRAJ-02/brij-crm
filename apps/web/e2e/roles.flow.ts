// What each role can do (flow walks, phase 5, 29 October 2026): the owner opens the guide from Members and it starts
// on their own role, every area All; switching to Member shows less, an area opened says what the role can't do; the
// Invite dialog holds the same guide folded, on Member, since that is the role an invitation gives. Both widths: a
// phone reads the same guide in the same order.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newWorkspace } from './people.ts';

test('the role guide starts on your role, switches, opens an area, and sits folded in Invite', async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
  const slug = `roles-${tag}`;
  await newWorkspace(page, `roles-${tag}@example.com`, slug);
  await page.goto(`/w/${slug}/settings/members`);
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();

  await page.getByRole('button', { name: 'What each role can do' }).click();
  const guide = page.getByRole('dialog', { name: 'What each role can do' });
  const roles = guide.getByRole('radiogroup', { name: 'Role' });
  // The owner's own role first: every area is All.
  await expect(roles.getByRole('radio', { name: 'Owner' })).toBeChecked();
  await expect(guide.getByRole('button', { name: 'All, Forms and booking' })).toBeVisible();
  await expect(guide.getByRole('button', { name: /^(Some|None), / })).toHaveCount(0);

  // Member holds less, said in words beside each area, not by the icon alone.
  await roles.getByRole('radio', { name: 'Member' }).click({ force: true });
  await expect(roles.getByRole('radio', { name: 'Member' })).toBeChecked();
  const access = guide.getByRole('button', { name: /^None, Workspace/ });
  await expect(access).toBeVisible();
  await expect(access).toHaveAttribute('aria-expanded', 'false');
  await access.click();
  await expect(access).toHaveAttribute('aria-expanded', 'true');
  await expect(guide.getByText(/^Can’t: /).first()).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(guide).toBeHidden();

  // The Invite dialog: the same guide, folded, on Member.
  await page.getByRole('button', { name: 'Invite people' }).first().click();
  const invite = page.getByRole('dialog', { name: 'Invite people' });
  const fold = invite.getByRole('button', { name: 'What each role can do' });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await fold.click();
  await expect(invite.getByRole('radiogroup', { name: 'Role' }).getByRole('radio', { name: 'Member' })).toBeChecked();
  // Nothing in it is sent: the invite's own primary is unchanged and the dialog still asks for an address.
  await expect(invite.getByRole('textbox', { name: 'Email' })).toBeVisible();
});
