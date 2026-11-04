// What each role can do (flow walks, phase 5, 29 October 2026): the guide sits folded in the Invite dialog, on Member,
// since that is the role an invitation gives; switching to Member shows less, an area opened says what the role can't
// do. Members' header lost its own guide button on 4 November 2026: Roles is the tab beside Members now (the dashboard
// IA brief, approved by the owner). Both widths: a phone reads the same guide in the same order.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newWorkspace } from './people.ts';

test('the role guide sits folded in Invite on Member, switches, and opens an area', async ({ page }, info) => {
  test.setTimeout(150_000);
  const tag = `${randomUUID().slice(0, 8)}-${info.project.name}`;
  const slug = `roles-${tag}`;
  await newWorkspace(page, `roles-${tag}@example.com`, slug);
  await page.goto(`/w/${slug}/settings/members`);
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();

  // One header action: Invite. Roles is a tab beside Members.
  await expect(page.getByRole('button', { name: 'What each role can do' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Roles' })).toBeVisible();

  // The Invite dialog: the same guide, folded, on Member.
  await page.getByRole('button', { name: 'Invite people' }).first().click();
  const invite = page.getByRole('dialog', { name: 'Invite people' });
  const fold = invite.getByRole('button', { name: 'What each role can do' });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await fold.click();
  const roles = invite.getByRole('radiogroup', { name: 'Role' });
  await expect(roles.getByRole('radio', { name: 'Member' })).toBeChecked();
  // Member holds less, said in words beside each area, not by the icon alone.
  const access = invite.getByRole('button', { name: /^None, Workspace/ });
  await expect(access).toBeVisible();
  await access.click();
  await expect(access).toHaveAttribute('aria-expanded', 'true');
  await expect(invite.getByText(/^Can’t: /).first()).toBeAttached();
  // The owner's role holds every area.
  await roles.getByRole('radio', { name: 'Owner' }).click({ force: true });
  await expect(invite.getByRole('button', { name: 'All, Forms and booking' })).toBeVisible();
  // Nothing in it is sent: the invite's own primary is unchanged and the dialog still asks for an address.
  await expect(invite.getByRole('textbox', { name: 'Email' })).toBeVisible();
});
