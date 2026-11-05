// The Members page with the library's styles, in Chromium (owner ask T12, 5 November 2026): no axe violations in either
// theme with someone asking to join, someone invited and a row's details open, and the Role picker's chevron beside
// its word, in the table and in the details, however wide the slot.
import '@crm/ui/styles.css';
import type {
  DataLayer,
  InvitationView,
  JoinRequestView,
  MemberView,
  MyAccess,
  RolesList,
  RolesOverview,
} from '@crm/data';
import { createToasts } from '@crm/ui';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { MembersScreen } from './MembersScreen.tsx';

const ADA: MemberView = {
  id: '0199a6f2-0000-7000-8000-000000000001',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'owner',
  joinedAt: '2026-10-01T09:00:00.000Z',
};
const LINUS: MemberView = {
  id: '0199a6f2-0000-7000-8000-000000000002',
  name: 'Linus Torvalds',
  email: 'linus@example.com',
  role: 'member',
  joinedAt: '2026-10-02T09:00:00.000Z',
};
const GRACE: InvitationView = {
  id: '0199a6f2-0000-7000-8000-0000000000a1',
  kind: 'email',
  email: 'grace@example.com',
  role: 'member',
  invitedBy: 'Ada Lovelace',
  invitedAt: '2026-10-20T09:00:00.000Z',
  expiresAt: '2026-10-27T09:00:00.000Z',
  isExpired: false,
};
const MARY: JoinRequestView = {
  id: '0199a6f2-0000-7000-8000-0000000000b1',
  name: 'Mary Shelley',
  email: 'mary@acme.com',
  requestedAt: '2026-10-22T09:00:00.000Z',
};
const ROLES: RolesList = {
  roles: [
    { id: 'owner', label: 'Owner', description: 'Everything.', builtIn: 'owner' },
    { id: 'admin', label: 'Admin', description: 'Members and settings.', builtIn: 'admin' },
    { id: 'member', label: 'Member', description: 'Records.', builtIn: 'member' },
  ],
  defaultRole: 'member',
};
const OVERVIEW = { roles: [], defaultRole: 'member' } as unknown as RolesOverview;
const ACCESS: MyAccess = {
  memberId: ADA.id,
  role: 'owner',
  roleLabel: 'Owner',
  permissions: ['members.invite', 'members.manage'],
};

const READY = { status: 'ready', delegations: [] } as const;
const delegations = {
  subscribe: () => () => undefined,
  getSnapshot: () => READY,
  retain: () => () => undefined,
  ready: () => Promise.resolve(),
  reload: () => undefined,
};
const healthState = { status: 'loading' } as const;
const health = {
  held: () => ({ subscribe: () => () => undefined, getSnapshot: () => healthState, retain: () => () => undefined }),
  ask: () => Promise.resolve(true),
};

let shown: InApp | undefined;

beforeAll(async () => {
  await page.viewport(1280, 800);
});

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

async function render() {
  const toasts = createToasts();
  const data = {
    scheduling: { loaded: () => ({ delegations: () => delegations, health }) },
    members: { watch: () => () => undefined, list: () => Promise.resolve([ADA, LINUS]) },
  } as unknown as Partial<DataLayer>;
  shown = await renderInApp(
    () => (
      <MembersScreen
        data={data as DataLayer}
        toasts={toasts}
        slug="acme"
        workspaceName="Acme"
        page={{ members: [ADA, LINUS], total: 2 }}
        search=""
        onSearch={() => undefined}
        invitations={[GRACE]}
        requests={[MARY]}
        access={ACCESS}
        roles={ROLES}
        overview={OVERVIEW}
      />
    ),
    { data, toasts, pattern: '/w/$slug/settings/members', at: '/w/acme/settings/members' },
  );
}

/** The space between a Select's trigger start and its chevron, against what the slot around it offers. */
function hugs(trigger: Element) {
  const slot = trigger.closest('td, dd');
  if (slot === null) throw new Error('expected the picker in a cell or a description');
  return trigger.getBoundingClientRect().width < slot.getBoundingClientRect().width / 2;
}

describe('Members, styled', () => {
  it.each(THEMES)('has no axe violations in %s, with the table and a row’s details', async (theme) => {
    await render();
    await page.getByRole('rowheader', { name: /Linus Torvalds/ }).click();
    await expect.element(page.getByRole('dialog', { name: 'Linus Torvalds' })).toBeVisible();
    applyTheme(theme);
    expect(await axeViolations()).toEqual([]);
  });

  it('keeps the Role picker’s chevron beside its word, in the table and in the details', async () => {
    await render();
    expect(hugs(page.getByRole('button', { name: /Role for Linus Torvalds/ }).element())).toBe(true);
    await page.getByRole('rowheader', { name: /Linus Torvalds/ }).click();
    const details = page.getByRole('dialog', { name: 'Linus Torvalds' });
    await expect.element(details).toBeVisible();
    expect(hugs(details.getByRole('button', { name: /Role/ }).element())).toBe(true);
  });
});
