// The Members page in Chromium. Its confirms (the owner, 21 October 2026: anything that ends something asks first):
// Cancel invite on an invitation (Keep it, never a second Cancel), Remove from workspace and Transfer ownership on a
// member each open a danger confirm; the way out changes nothing, and the verb runs once, busy while the server
// works, with the server's refusal inside the dialog, which stays open. Someone else's role changes at once, no
// confirm. The Joining tab: Asking to join, Pending invitations, then Other ways to join (the invite link, whose
// limits save with a toast and Undo, then Company email). A member reads one note and no controls.
import type {
  DataLayer,
  InvitationView,
  InviteLinkView,
  JoinRequestView,
  MemberView,
  MyAccess,
  RolesList,
  WorkspaceDomainsView,
} from '@crm/data';
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
const LINK: InviteLinkView = {
  enabled: true,
  token: 'tok-0123456789abcdef0123456789abcdef',
  uses: 0,
  isSpent: false,
};
const REQUEST: JoinRequestView = {
  id: '0199a6f2-0000-7000-8000-0000000000b1',
  name: 'Mary Shelley',
  email: 'mary@acme.com',
  requestedAt: '2026-10-22T09:00:00.000Z',
};
const DOMAINS: WorkspaceDomainsView = { domains: [], yourDomain: 'acme.com', isPublic: false };
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

/** A data layer whose revoke, remove, role and invite link changes are counted, each answering with `answer`. */
function layerWith(answer: () => Promise<void>) {
  const calls = { revoke: 0, remove: 0, setRole: 0, transfer: 0, setLink: [] as unknown[] };
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
      setLink: async (_workspace: string, change: unknown) => {
        calls.setLink.push(change);
        await answer();
        return LINK;
      },
    },
  } as unknown as DataLayer;
  return { layer, revokes: () => calls.revoke, calls };
}

/** A refusal as the data layer throws it. */
function refusal(code: string, message: string): Error {
  return Object.assign(new Error(message), { name: 'DataError', code });
}

/** What a test changes about the page: the joining lists, the link and domains, and the reader's access. */
interface Extras {
  readonly requests?: readonly JoinRequestView[];
  readonly link?: InviteLinkView;
  readonly domains?: WorkspaceDomainsView;
  readonly access?: MyAccess;
  /** `none` for someone who can't invite (no tabs at all). */
  readonly invitations?: readonly InvitationView[] | 'none';
}

/** Renders the Members page at its address inside a memory router, as an owner with one open invitation. */
async function renderMembers(layer: DataLayer, extras: Extras = {}): Promise<Toasts> {
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
        invitations={extras.invitations === 'none' ? undefined : (extras.invitations ?? [GRACE])}
        {...(extras.requests === undefined ? {} : { requests: extras.requests })}
        {...(extras.link === undefined ? {} : { link: extras.link })}
        {...(extras.domains === undefined ? {} : { domains: extras.domains })}
        access={extras.access ?? ACCESS}
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

/** Opens the Joining tab and picks Cancel invite on Grace's row. */
async function pickCancelInvite(): Promise<void> {
  await page.getByRole('tab', { name: /Joining/ }).click();
  await page.getByRole('button', { name: 'Actions for the invitation to grace@example.com' }).click();
  await page.getByRole('menuitem', { name: 'Cancel invite' }).click();
}

describe('cancelling an invitation asks first', () => {
  it('names the address, and Keep it cancels nothing', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await pickCancelInvite();
    const dialog = page.getByRole('alertdialog', { name: 'Cancel the invitation to grace@example.com?' });
    await expect.element(dialog).toBeVisible();
    expect(dialog.element().textContent).toContain('The link in their email stops working at once.');
    // Never two buttons called Cancel: the way out is Keep it, the verb Cancel invitation.
    expect(dialog.getByRole('button', { name: 'Cancel', exact: true }).elements()).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Keep it' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(counted.revokes()).toBe(0);
  });

  it('cancels once on the verb, busy while the server works', async () => {
    let release: () => void = () => undefined;
    const counted = layerWith(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await renderMembers(counted.layer);
    await pickCancelInvite();
    const dialog = page.getByRole('alertdialog', { name: 'Cancel the invitation to grace@example.com?' });
    const commit = dialog.getByRole('button', { name: 'Cancel invitation' });
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
    await pickCancelInvite();
    const dialog = page.getByRole('alertdialog', { name: 'Cancel the invitation to grace@example.com?' });
    await dialog.getByRole('button', { name: 'Cancel invitation' }).click();
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

  it('shows your own role as text, with no picker: an owner hands on through Transfer (owner, 22 October 2026)', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await expect.element(page.getByRole('button', { name: /Role for Linus Torvalds/ })).toBeVisible();
    expect(page.getByRole('button', { name: /Role for Ada Lovelace/ }).elements()).toHaveLength(0);
    expect(counted.calls.setRole).toBe(0);
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

describe('the Joining tab', () => {
  it('counts invitations and requests, and holds Asking to join, Pending invitations, then Other ways to join', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer, { requests: [REQUEST], link: LINK, domains: DOMAINS });
    // One tab for everyone on their way in: no Invitations or Join requests tab any more.
    expect(page.getByRole('tab').elements()).toHaveLength(2);
    // Its count is the pending invitations plus the requests waiting: 1 and 1.
    expect(
      page
        .getByRole('tab', { name: /Joining/ })
        .element()
        .textContent.replaceAll(/\s/g, ''),
    ).toBe('Joining2');
    await page.getByRole('tab', { name: /Joining/ }).click();
    const panel = page.getByRole('tabpanel');
    await expect.element(panel.getByRole('heading', { name: 'Asking to join' })).toBeVisible();
    expect(
      panel
        .getByRole('heading')
        .elements()
        .map((heading) => heading.textContent),
    ).toEqual(['Asking to join', 'Pending invitations', 'Other ways to join']);
    await expect.element(panel.getByRole('rowheader', { name: /Mary Shelley/ })).toBeVisible();
    await expect.element(panel.getByRole('rowheader', { name: 'grace@example.com' })).toBeVisible();
    // The invite link first, then Company email, with what Company email does.
    const link = panel.getByRole('switch', { name: 'Invite link' }).element();
    const email = panel.getByRole('switch', { name: 'Company email' }).element();
    expect(link.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.element().textContent).toContain(
      'Anyone with an @acme.com email can ask to join. You approve each one.',
    );
  });

  it('leaves Asking to join out while nobody waits', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer, { link: LINK });
    await page.getByRole('tab', { name: /Joining/ }).click();
    await expect.element(page.getByRole('heading', { name: 'Pending invitations' })).toBeVisible();
    expect(page.getByRole('heading', { name: 'Asking to join' }).elements()).toHaveLength(0);
  });

  it('says the invite link saved, and Undo puts the old limit back', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer, { link: { ...LINK, maxUses: 25 } });
    await page.getByRole('tab', { name: /Joining/ }).click();
    await page.getByRole('button', { name: /people Most uses/ }).click();
    await page.getByRole('option', { name: '50 people' }).click();
    await expect.element(page.getByText('Invite link saved.')).toBeVisible();
    expect(counted.calls.setLink).toEqual([{ enabled: true, maxUses: 50 }]);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.element(page.getByText('Change undone.')).toBeVisible();
    expect(counted.calls.setLink).toEqual([
      { enabled: true, maxUses: 50 },
      { enabled: true, maxUses: 25 },
    ]);
  });
});

describe('a member who can’t invite', () => {
  it('reads one note in the shared words, and no controls', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer, {
      invitations: 'none',
      access: { memberId: LINUS.id, role: 'member', roleLabel: 'Member', permissions: [] },
    });
    await expect.element(page.getByText('Only owners and admins can change this.')).toBeVisible();
    expect(page.getByText('Only owners and admins can change this.').elements()).toHaveLength(1);
    expect(page.getByRole('tab').elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: /Role for/ }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: /Actions for/ }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: 'Invite people' }).elements()).toHaveLength(0);
  });
});
