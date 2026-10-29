// Settings › Account › Scheduling access in Chromium (spec 0037, AC-1266, AC-1271, AC-1445): owners and admins through
// their role, a delegation over me with its source and level, Remove asking first with the consequence in plain
// words, Add someone giving See or Manage, whose scheduling I reach, and no axe violations in either theme.
import '@crm/ui/styles.css';
import type {
  DelegationGrant,
  DelegationsHeld,
  DelegationsState,
  DelegationView,
  MemberView,
  MyAccess,
  SchedulingAccessStore,
} from '@crm/data';
import { createToasts } from '@crm/ui';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { applyTheme, axeViolations, resetTheme, THEMES } from '../../testing/axe.ts';
import { renderInApp, type InApp } from '../../testing/renderInApp.tsx';
import { SchedulingAccessScreen } from './SchedulingAccessScreen.tsx';

const ME = '00000000-0000-7000-8000-000000000001';
const PRIYA = '00000000-0000-7000-8000-000000000002';
const SAM = '00000000-0000-7000-8000-000000000003';
const BEA = '00000000-0000-7000-8000-000000000004';

const person = (id: string, name: string, role: MemberView['role'] = 'member'): MemberView => ({
  id,
  name,
  email: `${name.toLowerCase()}@acme.test`,
  role,
  joinedAt: '2026-10-01T10:00:00.000Z',
});
const MEMBERS = [
  person(ME, 'Ada'),
  person(PRIYA, 'Priya'),
  person(SAM, 'Sam'),
  person(BEA, 'Bea'),
  person('00000000-0000-7000-8000-000000000005', 'Olu', 'admin'),
];

const ACCESS: MyAccess = {
  memberId: ME,
  role: 'member',
  roleLabel: 'Member',
  permissions: ['booking.manage', 'availability.own', 'records.export'],
};

let shown: InApp | undefined;

afterEach(() => {
  shown?.unmount();
  shown = undefined;
  resetTheme();
});

/** The data layer's held list and writes, kept in memory: a write shows at once, as the real store does. */
function fake(initial: readonly DelegationView[]) {
  let state: DelegationsState = { status: 'ready', delegations: initial };
  const listeners = new Set<() => void>();
  const set = (next: readonly DelegationView[]) => {
    state = { status: 'ready', delegations: next };
    for (const listener of listeners) listener();
  };
  const held: DelegationsHeld = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: () => undefined,
  };
  const granted: DelegationGrant[] = [];
  const revoked: string[] = [];
  const data = {
    store: {
      delegations: () => held,
      visible: () => Promise.resolve([]),
      grant: (_workspace: string, _me: string, grant: DelegationGrant) => {
        granted.push(grant);
        const current = state.status === 'ready' ? state.delegations : [];
        set([
          ...current,
          {
            id: `new-${String(granted.length)}`,
            delegateMemberId: grant.delegateMemberId,
            target: grant.target,
            level: grant.level,
            grantedBySelf: true,
            grantedBy: ME,
            createdAt: '2026-10-29T10:00:00.000Z',
          },
        ]);
        return Promise.resolve(true);
      },
      revoke: (_workspace: string, _me: string, delegation: DelegationView) => {
        revoked.push(delegation.id);
        const current = state.status === 'ready' ? state.delegations : [];
        set(current.filter((each) => each.id !== delegation.id));
        return Promise.resolve(true);
      },
    },
  } as unknown as { readonly store: SchedulingAccessStore };
  return { data, granted, revoked };
}

const OVER_ME: DelegationView = {
  id: 'priya-me',
  delegateMemberId: PRIYA,
  target: { type: 'member', memberId: ME },
  level: 'manage',
  grantedBySelf: true,
  grantedBy: ME,
  createdAt: '2026-10-20T10:00:00.000Z',
};
const MINE: DelegationView = {
  id: 'me-bea',
  delegateMemberId: ME,
  target: { type: 'member', memberId: BEA },
  level: 'view',
  grantedBySelf: true,
  grantedBy: BEA,
  createdAt: '2026-10-21T10:00:00.000Z',
};

async function render(initial: readonly DelegationView[] = [OVER_ME, MINE]) {
  const made = fake(initial);
  const toasts = createToasts();
  shown = await renderInApp(
    () => (
      <SchedulingAccessScreen
        scheduling={made.data.store}
        toasts={toasts}
        slug="acme"
        access={ACCESS}
        members={MEMBERS}
      />
    ),
    {
      data: {},
      toasts,
      pattern: '/w/$slug/settings/account/scheduling',
      at: '/w/acme/settings/account/scheduling',
    },
  );
  return made;
}

describe('Scheduling access', () => {
  it('lists who reaches my scheduling and whose I reach, each with where it came from', async () => {
    await render();
    await expect.element(page.getByText('Workspace owners and admins')).toBeVisible();
    await expect.element(page.getByText('Through their role')).toBeVisible();
    await expect.element(page.getByText('Priya', { exact: true })).toBeVisible();
    await expect.element(page.getByText('You added')).toBeVisible();
    await expect.element(page.getByText('Bea', { exact: true })).toBeVisible();
    await expect.element(page.getByText('They added you')).toBeVisible();
  });

  it('asks before taking access back, saying what ends (AC-1445), then removes it', async () => {
    const made = await render();
    await page.getByRole('button', { name: 'Remove Priya’s access' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Remove Priya’s access?' });
    await expect.element(dialog.getByText('Priya will no longer be able to manage your scheduling.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove access' }).click();
    expect(made.revoked).toEqual(['priya-me']);
    await expect.element(page.getByText('Nobody else yet.', { exact: false })).toBeVisible();
  });

  it('adds a teammate with Manage from the keyboard, and never offers an admin or someone already added', async () => {
    const made = await render([OVER_ME]);
    await page.getByRole('button', { name: 'Add someone' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add someone' });
    await dialog.getByRole('button', { name: /Person/ }).click();
    await expect.element(page.getByRole('option', { name: /Olu/ })).not.toBeInTheDocument();
    await expect.element(page.getByRole('option', { name: /Priya/ })).not.toBeInTheDocument();
    await page.getByRole('option', { name: /Sam/ }).click();
    await dialog.getByText('Manage', { exact: true }).click();
    await userEvent.click(dialog.getByRole('button', { name: 'Add', exact: true }));
    expect(made.granted).toEqual([
      { delegateMemberId: SAM, target: { type: 'member', memberId: ME }, level: 'manage' },
    ]);
    await expect.element(page.getByText('Sam', { exact: true })).toBeVisible();
  });

  it.each(THEMES)('has no axe violations in %s', async (theme) => {
    await render();
    applyTheme(theme);
    expect(await axeViolations()).toEqual([]);
  });
});
