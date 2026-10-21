// The Members page's confirms in Chromium (the owner, 21 October 2026: anything that ends something asks first):
// Revoke on an invitation, Remove from workspace on a member, and lowering one's own role each open a danger
// confirm; Cancel changes nothing, and the verb runs once, busy while the server works, with the server's refusal
// (LAST_OWNER's sentence too) inside the dialog, which stays open. Someone else's role changes at once, no confirm.
import type { DataLayer, InvitationView, MemberView, MyAccess, RolesList } from '@crm/data';
import { createToasts, UiProvider, type Toasts } from '@crm/ui';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
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
const ROLES_LIST: RolesList = {
  roles: [
    { id: 'owner', label: 'Owner', description: 'Everything.', builtIn: 'owner' },
    { id: 'admin', label: 'Admin', description: 'Members and settings.', builtIn: 'admin' },
    { id: 'member', label: 'Member', description: 'Records.', builtIn: 'member' },
  ],
  defaultRole: 'member',
};
const ACCESS: MyAccess = {
  memberId: ADA.id,
  role: 'owner',
  roleLabel: 'Owner',
  permissions: ['members.invite', 'members.manage'],
};

// The frame reads the member's calendars for its banner: here none, still loading, so no banner shows.
const loading = { status: 'loading' as const };
const calendarView = {
  subscribe: () => () => undefined,
  getSnapshot: () => loading,
  retain: () => () => undefined,
  ready: () => Promise.resolve(),
  reload: () => undefined,
};

beforeAll(async () => {
  await page.viewport(1280, 800);
});

let mounted: { readonly root: Root; readonly host: HTMLElement } | undefined;

afterEach(() => {
  if (mounted === undefined) return;
  const { root, host } = mounted;
  act(() => {
    root.unmount();
  });
  host.remove();
  mounted = undefined;
});

const LOADING = { status: 'loading' as const };
const stillLoading = {
  subscribe: () => () => undefined,
  getSnapshot: () => LOADING,
  retain: () => () => undefined,
};

/** A data layer whose revoke, remove and role changes are counted, each answering with `answer`. */
function layerWith(answer: () => Promise<void>) {
  const calls = { revoke: 0, remove: 0, setRole: 0, transfer: 0 };
  const layer = {
    calendar: { view: () => calendarView },
    // The frame's sidebar and Tasks badge (spec 0034), still loading.
    nav: { source: () => stillLoading, change: () => undefined },
    tasks: { due: () => stillLoading },
    members: {
      watch: () => () => undefined,
      // The remove dialog reads what the removal does and who could take over (spec 0031, slice 5).
      removalPreview: () => Promise.resolve({ pausedPages: 0, calendars: 0, openTasks: 1, records: 2 }),
      list: () => Promise.resolve([ADA, LINUS]),
      remove: async () => {
        calls.remove += 1;
        await answer();
        return {};
      },
      transferOwnership: () => {
        calls.transfer += 1;
        return answer();
      },
      setRole: async (_workspace: string, memberId: string, role: string) => {
        calls.setRole += 1;
        await answer();
        return { ...(memberId === ADA.id ? ADA : LINUS), role };
      },
    },
    invitations: {
      revoke: () => {
        calls.revoke += 1;
        return answer();
      },
    },
  } as unknown as DataLayer;
  return { layer, revokes: () => calls.revoke, calls };
}

/** A refusal as the data layer throws it. */
function refusal(code: string, message: string): Error {
  return Object.assign(new Error(message), { name: 'DataError', code });
}

/** Renders the Members page at its address inside a memory router, as an owner with one open invitation. */
async function renderMembers(layer: DataLayer): Promise<Toasts> {
  const toasts = createToasts();
  const rootRoute = createRootRouteWithContext<{ data: DataLayer; toasts: Toasts }>()();
  const members = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$slug/settings/members',
    component: () => (
      <MembersScreen
        data={layer}
        toasts={toasts}
        slug="acme"
        workspaceName="Acme"
        page={{ members: [ADA, LINUS], total: 2 }}
        search=""
        onSearch={() => undefined}
        invitations={[GRACE]}
        access={ACCESS}
        roles={ROLES_LIST}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([members]),
    history: createMemoryHistory({ initialEntries: ['/w/acme/settings/members'] }),
    context: { data: layer, toasts },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  await act(async () => {
    root.render(
      <UiProvider
        locale="en-GB"
        timeZone="UTC"
        toasts={toasts}
        navigate={(href) => {
          router.history.push(href);
        }}
        useHref={(href) => router.history.createHref(href)}
      >
        <RouterProvider router={router} />
      </UiProvider>,
    );
    await router.load();
  });
  return toasts;
}

/** Opens the Invitations tab and picks Revoke on Grace's row. */
async function pickRevoke(): Promise<void> {
  await page.getByRole('tab', { name: /Invitations/ }).click();
  await page.getByRole('button', { name: 'Actions for the invitation to grace@example.com' }).click();
  await page.getByRole('menuitem', { name: 'Revoke' }).click();
}

describe('revoking an invitation asks first', () => {
  it('names the address, and Cancel revokes nothing', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await pickRevoke();
    const dialog = page.getByRole('alertdialog', { name: 'Revoke the invitation to grace@example.com?' });
    await expect.element(dialog).toBeVisible();
    expect(dialog.element().textContent).toContain('The link in their email stops working at once.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(counted.revokes()).toBe(0);
  });

  it('revokes once on the verb, busy while the server works', async () => {
    let release: () => void = () => undefined;
    const counted = layerWith(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await renderMembers(counted.layer);
    await pickRevoke();
    const dialog = page.getByRole('alertdialog', { name: 'Revoke the invitation to grace@example.com?' });
    const commit = dialog.getByRole('button', { name: 'Revoke invitation' });
    await commit.click();
    await commit.click({ force: true });
    expect(counted.revokes()).toBe(1);
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await expect.element(dialog).not.toBeInTheDocument();
    expect(counted.revokes()).toBe(1);
  });

  it('shows a refusal inside the dialog, which stays open', async () => {
    const counted = layerWith(() => Promise.reject(refusal('NOT_FOUND', 'That invitation doesn’t exist.')));
    await renderMembers(counted.layer);
    await pickRevoke();
    const dialog = page.getByRole('alertdialog', { name: 'Revoke the invitation to grace@example.com?' });
    await dialog.getByRole('button', { name: 'Revoke invitation' }).click();
    await expect.element(dialog.getByRole('alert')).toBeVisible();
    await expect.element(dialog).toBeVisible();
    expect(counted.revokes()).toBe(1);
  });
});

describe('removing a member asks first', () => {
  /** Opens Linus's row menu and picks Remove from workspace. */
  async function pickRemove(): Promise<void> {
    await page.getByRole('button', { name: 'Actions for Linus Torvalds' }).click();
    await page.getByRole('menuitem', { name: 'Remove from workspace' }).click();
  }

  it('names them and the workspace; Cancel removes nobody, and Remove member removes once', async () => {
    let release: () => void = () => undefined;
    const counted = layerWith(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await renderMembers(counted.layer);
    await pickRemove();
    const dialog = page.getByRole('alertdialog', { name: 'Remove Linus Torvalds from Acme?' });
    await expect.element(dialog).toBeVisible();
    // What the removal does, read as it opens, and who could take their work (never Linus himself).
    await expect
      .element(dialog.getByText('1 open task is assigned to them. 2 records name them as owner.'))
      .toBeVisible();
    await dialog.getByRole('button', { name: /Hand their open tasks and records to/ }).click();
    await expect.element(page.getByRole('option', { name: /Ada Lovelace/ })).toBeVisible();
    await expect.element(page.getByRole('option', { name: /Linus Torvalds/ })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(counted.calls.remove).toBe(0);
    await pickRemove();
    const commit = dialog.getByRole('button', { name: 'Remove member' });
    await commit.click();
    await commit.click({ force: true });
    expect(counted.calls.remove).toBe(1);
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await expect.element(dialog).not.toBeInTheDocument();
  });

  it('offers no menu on the reader’s own row: leaving is the workspace menu’s', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await expect.element(page.getByRole('button', { name: 'Actions for Linus Torvalds' })).toBeVisible();
    expect(page.getByRole('button', { name: 'Actions for Ada Lovelace' }).elements()).toHaveLength(0);
  });
});

describe('changing roles', () => {
  it('changes someone else’s role at once, with no confirm', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await page.getByRole('button', { name: /Role for Linus Torvalds/ }).click();
    await page.getByRole('option', { name: 'Admin' }).click();
    // No confirm asked: the change went at once, and its toast says so.
    expect(document.querySelector('[role="alertdialog"][aria-modal="true"]')).toBeNull();
    expect(counted.calls.setRole).toBe(1);
    await expect.element(page.getByText('Linus Torvalds is now an Admin.')).toBeVisible();
  });

  it('asks before lowering one’s own role, and shows LAST_OWNER’s sentence inside, staying open', async () => {
    const counted = layerWith(() =>
      Promise.reject(refusal('LAST_OWNER', 'A workspace needs an owner. Make someone else an owner first.')),
    );
    await renderMembers(counted.layer);
    await page.getByRole('button', { name: /Role for Ada Lovelace/ }).click();
    await page.getByRole('option', { name: 'Admin' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Change your own role to Admin?' });
    await expect.element(dialog).toBeVisible();
    expect(counted.calls.setRole).toBe(0);
    await dialog.getByRole('button', { name: 'Change my role' }).click();
    await expect.element(dialog.getByRole('alert')).toBeVisible();
    expect(dialog.element().textContent).toContain('A workspace needs an owner.');
    expect(counted.calls.setRole).toBe(1);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(counted.calls.setRole).toBe(1);
  });
});

describe('transferring ownership asks first (AC-813)', () => {
  it('names them and the workspace; Cancel hands nothing over, and Transfer ownership runs once', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    const pick = async () => {
      await page.getByRole('button', { name: 'Actions for Linus Torvalds' }).click();
      await page.getByRole('menuitem', { name: 'Transfer ownership' }).click();
    };
    await pick();
    const dialog = page.getByRole('alertdialog', { name: 'Make Linus Torvalds the owner of Acme?' });
    await expect.element(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(counted.calls.transfer).toBe(0);
    await pick();
    await dialog.getByRole('button', { name: 'Transfer ownership' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(counted.calls.transfer).toBe(1);
    await expect.element(page.getByText('Linus Torvalds is now an owner. You’re an admin.')).toBeVisible();
  });
});
