// The Members page in Chromium. Its confirms (the owner, 21 October 2026: anything that ends something asks first):
// Cancel invite on an invitation (Keep invitation, never a second Cancel), Remove from workspace and Transfer ownership on a
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
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { linkStillReads } from './InviteLinkRows.tsx';
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

/** The workspace's delegations, read and empty (the Scheduling access column). */
const NO_DELEGATIONS = { status: 'ready', delegations: [] } as const;
/** Calendar health as the store holds it (spec 0037, AC-1308): Linus's calendar needs reconnecting, Ada's works. */
const healthAsks: string[] = [];
const healthOf = (memberId: string) => {
  const state =
    memberId === LINUS.id
      ? {
          status: 'ready' as const,
          health: { memberId, status: 'reconnect' as const, since: '2026-10-29T09:00:00.000Z' },
          asked: false,
        }
      : { status: 'ready' as const, health: { memberId, status: 'connected' as const }, asked: false };
  return { subscribe: () => () => undefined, getSnapshot: () => state, retain: () => () => undefined };
};
const health = {
  held: (_workspace: string, memberId: string) => healthOf(memberId),
  ask: (_workspace: string, memberId: string) => {
    healthAsks.push(memberId);
    return Promise.resolve(true);
  },
};

const noDelegations = {
  subscribe: () => () => undefined,
  getSnapshot: () => NO_DELEGATIONS,
  retain: () => () => undefined,
  ready: () => Promise.resolve(),
  reload: () => undefined,
};

/** A link change as the data layer takes it. */
type LinkChange = Parameters<DataLayer['invitations']['setLink']>[1];

/** The link after `change`, as the server would answer: what the route reads again after a save. */
function linkAfter(link: InviteLinkView, change: LinkChange): InviteLinkView {
  const { maxUses: _maxUses, expiresAt: _expiresAt, ...rest } = link;
  const maxUses = change.maxUses === undefined ? link.maxUses : (change.maxUses ?? undefined);
  const expiresAt =
    change.expiresInDays === undefined
      ? link.expiresAt
      : change.expiresInDays === null
        ? undefined
        : '2026-10-30T09:00:00.000Z';
  return {
    ...rest,
    enabled: change.enabled,
    ...(maxUses === undefined ? {} : { maxUses }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

/**
 * A data layer whose revoke, remove, role, invite link and join request changes are counted, each answering with
 * `answer`. The link it holds follows each setLink, as the server's would, for a page reading it with `liveLink`.
 */
function layerWith(answer: () => Promise<void>, startLink: InviteLinkView = LINK) {
  const calls = {
    revoke: 0,
    remove: 0,
    setRole: 0,
    transfer: 0,
    setLink: [] as LinkChange[],
    decide: [] as boolean[],
  };
  const state = { link: startLink };
  const layer = {
    calendar: { view: () => calendarView },
    // The frame's sidebar and Tasks badge (spec 0034), still loading.
    nav: { source: () => stillLoading, change: () => undefined },
    tasks: { due: () => stillLoading },
    // The Scheduling access column (spec 0037, AC-1267): nobody holds a delegation.
    scheduling: { loaded: () => ({ delegations: () => noDelegations, health }) },
    members: {
      watch: () => () => undefined,
      // The remove dialog reads what the removal does and who could take over (spec 0031, slice 5).
      removalPreview: () =>
        Promise.resolve({
          pausedPages: 0,
          calendars: 0,
          openTasks: 1,
          records: 2,
          defaults: 0,
          requiredDefaults: 0,
          invitations: 0,
          ownedForms: 0,
        }),
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
      setLink: async (_workspace: string, change: LinkChange) => {
        calls.setLink.push(change);
        await answer();
        state.link = linkAfter(state.link, change);
        return state.link;
      },
    },
    joinRequests: {
      decide: async (_workspace: string, _id: string, approve: boolean) => {
        calls.decide.push(approve);
        await answer();
      },
    },
  } as unknown as DataLayer;
  return {
    layer,
    revokes: () => calls.revoke,
    calls,
    /** The link as the server holds it now: hand it to the page as `liveLink`. */
    link: () => state.link,
    /** Another admin's change, straight to the server's copy. */
    elsewhere: (change: LinkChange) => {
      state.link = linkAfter(state.link, change);
    },
  };
}

/** A refusal as the data layer throws it. */
function refusal(code: string, message: string): Error {
  return Object.assign(new Error(message), { name: 'DataError', code });
}

/** What a test changes about the page: the joining lists, the link and domains, and the reader's access. */
interface Extras {
  readonly requests?: readonly JoinRequestView[];
  readonly link?: InviteLinkView;
  /** The link as the server holds it, read again on each load of the route, as the real loader reads it. */
  readonly liveLink?: () => InviteLinkView;
  readonly domains?: WorkspaceDomainsView;
  readonly access?: MyAccess;
  /** `none` for someone who can't invite (no tabs at all). */
  readonly invitations?: readonly InvitationView[] | 'none';
  /** The page's members, Ada and Linus by default. */
  readonly members?: readonly MemberView[];
}

/** Renders the Members page at its address inside a memory router, as an owner with one open invitation. */
async function renderMembers(
  layer: DataLayer,
  extras: Extras = {},
): Promise<{ readonly toasts: Toasts; readonly reload: () => Promise<void> }> {
  const toasts = createToasts();
  // Each load of the route (the first, and every invalidate: the page's own reload after a change, or a live
  // event) counts one read, so the page shows `liveLink` as of its last read, as the real route's loader does.
  const reads = { count: 0, listeners: new Set<() => void>() };
  const subscribe = (listener: () => void) => {
    reads.listeners.add(listener);
    return () => {
      reads.listeners.delete(listener);
    };
  };
  const rootRoute = createRootRouteWithContext<{ data: DataLayer; toasts: Toasts }>()();
  const Members = () => {
    useSyncExternalStore(subscribe, () => reads.count);
    return (
      <MembersScreen
        data={layer}
        toasts={toasts}
        slug="acme"
        workspaceName="Acme"
        page={{ members: [...(extras.members ?? [ADA, LINUS])], total: 2 }}
        search=""
        onSearch={() => undefined}
        invitations={extras.invitations === 'none' ? undefined : (extras.invitations ?? [GRACE])}
        {...(extras.requests === undefined ? {} : { requests: extras.requests })}
        {...(extras.liveLink === undefined ? {} : { link: extras.liveLink() })}
        {...(extras.link === undefined ? {} : { link: extras.link })}
        {...(extras.domains === undefined ? {} : { domains: extras.domains })}
        access={extras.access ?? ACCESS}
        roles={ROLES_LIST}
      />
    );
  };
  const members = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$slug/settings/members',
    loader: () => {
      reads.count += 1;
      for (const listener of reads.listeners) listener();
    },
    component: Members,
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
  return {
    toasts,
    // The live members event: the route reads the page again.
    reload: async () => {
      await act(async () => {
        await router.invalidate();
      });
    },
  };
}

/** Opens the Joining tab and picks Cancel invite on Grace's row. */
async function pickCancelInvite(): Promise<void> {
  await page.getByRole('tab', { name: /Joining/ }).click();
  await page.getByRole('button', { name: 'Actions for the invitation to grace@example.com' }).click();
  await page.getByRole('menuitem', { name: 'Cancel invite' }).click();
}

describe('cancelling an invitation asks first', () => {
  it('names the address, and Keep invitation cancels nothing', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await pickCancelInvite();
    const dialog = page.getByRole('alertdialog', { name: 'Cancel the invitation to grace@example.com?' });
    await expect.element(dialog).toBeVisible();
    expect(dialog.element().textContent).toContain('The link in their email stops working at once.');
    // Never two buttons called Cancel: the way out is Keep invitation, the verb Cancel invitation.
    expect(dialog.getByRole('button', { name: 'Cancel', exact: true }).elements()).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Keep invitation' }).click();
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
    await expect.element(dialog.getByText('They lose access now.')).toBeVisible();
    await expect.element(dialog.getByText('Open tasks')).toBeVisible();
    await expect.element(dialog.getByText('Records they own')).toBeVisible();
    await dialog.getByRole('button', { name: /Hand over to/ }).click();
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

describe('calendar health (spec 0037, AC-1308, AC-1309)', () => {
  it('shows each person’s status in words, and asks a broken calendar’s owner to reconnect from their menu', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await expect.element(page.getByRole('columnheader', { name: 'Calendar' })).toBeVisible();
    await expect.element(page.getByText('Reconnect needed')).toBeVisible();
    await expect.element(page.getByText('Connected')).toBeVisible();
    await page.getByRole('button', { name: 'Actions for Linus Torvalds' }).click();
    await page.getByRole('menuitem', { name: 'Ask to reconnect' }).click();
    expect(healthAsks).toEqual([LINUS.id]);
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

  it('says how many invitations the change cancelled, and offers Invite people to send them again', async () => {
    const counted = layerWith(() => Promise.resolve());
    const layer = {
      ...counted.layer,
      members: {
        ...counted.layer.members,
        setRole: async () => {
          await Promise.resolve();
          return { ...LINUS, cancelledInvitations: 2 };
        },
      },
    };
    // Linus is an admin, made a member: what he sent as an admin opens nothing now.
    await renderMembers(layer, { members: [ADA, { ...LINUS, role: 'admin' }] });
    await page.getByRole('button', { name: /Role for Linus Torvalds/ }).click();
    await page.getByRole('option', { name: 'Member' }).click();
    await expect
      .element(
        page.getByText(
          'Linus Torvalds is now a Member. 2 invitations they sent were cancelled, since their new role can’t send them.',
        ),
      )
      .toBeVisible();
    await page.getByRole('button', { name: 'Invite people' }).last().click();
    await expect.element(page.getByRole('dialog', { name: /Invite/ })).toBeVisible();
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
    // The invite link's limits sit folded under Link settings, whose trigger is a heading of its own.
    expect(
      panel
        .getByRole('heading')
        .elements()
        .map((heading) => heading.textContent),
    ).toEqual(['Asking to join', 'Pending invitations', 'Other ways to join', 'Link settings']);
    await expect.element(panel.getByRole('rowheader', { name: /Mary Shelley/ })).toBeVisible();
    await expect.element(panel.getByRole('rowheader', { name: 'grace@example.com' })).toBeVisible();
    // The invite link first, then Company email, with what Company email does.
    const link = panel.getByRole('switch', { name: 'Invite link' }).element();
    const email = panel.getByRole('switch', { name: 'Let @acme.com ask to join' }).element();
    expect(link.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.element().textContent).toContain('Let @acme.com ask to join');
  });

  it('leaves Asking to join out while nobody waits', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer, { link: LINK });
    await page.getByRole('tab', { name: /Joining/ }).click();
    await expect.element(page.getByRole('heading', { name: 'Pending invitations' })).toBeVisible();
    expect(page.getByRole('heading', { name: 'Asking to join' }).elements()).toHaveLength(0);
  });

  it('says the invite link saved, and Undo puts the old limit back', async () => {
    const counted = layerWith(() => Promise.resolve(), { ...LINK, maxUses: 25 });
    await renderMembers(counted.layer, { liveLink: counted.link });
    await page.getByRole('tab', { name: /Joining/ }).click();
    await page.getByRole('button', { name: 'Link settings' }).click();
    await page.getByRole('button', { name: /people Most uses/ }).click();
    await page.getByRole('option', { name: '50 people' }).click();
    await expect.element(page.getByText('Invite link saved.')).toBeVisible();
    expect(counted.calls.setLink).toEqual([{ enabled: true, maxUses: 50 }]);
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(counted.calls.setLink).toEqual([
      { enabled: true, maxUses: 50 },
      { enabled: true, maxUses: 25 },
    ]);
  });

  it('never turns the link back on: turning it off closes the open Undo', async () => {
    const counted = layerWith(() => Promise.resolve(), { ...LINK, maxUses: 25 });
    await renderMembers(counted.layer, { liveLink: counted.link });
    await page.getByRole('tab', { name: /Joining/ }).click();
    await page.getByRole('button', { name: 'Link settings' }).click();
    await page.getByRole('button', { name: /people Most uses/ }).click();
    await page.getByRole('option', { name: '50 people' }).click();
    await expect.element(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    // A click on the switch's own input, which the row's text covers in this unstyled page.
    (page.getByRole('switch', { name: 'Invite link' }).element() as HTMLElement).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Turn off link' }).click();
    await expect.element(page.getByText('The invite link is off.')).toBeVisible();
    // The old toast went with its Undo, so nothing can turn the link back on.
    await expect.element(page.getByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(counted.calls.setLink).toEqual([{ enabled: true, maxUses: 50 }, { enabled: false }]);
    expect(counted.link().enabled).toBe(false);
  });

  it('closes the open Undo when the tab is left, so a remount can’t act on an old one', async () => {
    const counted = layerWith(() => Promise.resolve(), { ...LINK, maxUses: 25 });
    await renderMembers(counted.layer, { liveLink: counted.link });
    await page.getByRole('tab', { name: /Joining/ }).click();
    await page.getByRole('button', { name: 'Link settings' }).click();
    await page.getByRole('button', { name: /people Most uses/ }).click();
    await page.getByRole('option', { name: '50 people' }).click();
    await expect.element(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await page.getByRole('tab', { name: /^Members/ }).click();
    await expect.element(page.getByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(counted.calls.setLink).toEqual([{ enabled: true, maxUses: 50 }]);
  });

  it('leaves another admin’s newer value alone, and says so', async () => {
    const counted = layerWith(() => Promise.resolve(), { ...LINK, maxUses: 25 });
    const { reload } = await renderMembers(counted.layer, { liveLink: counted.link });
    await page.getByRole('tab', { name: /Joining/ }).click();
    await page.getByRole('button', { name: 'Link settings' }).click();
    await page.getByRole('button', { name: /people Most uses/ }).click();
    await page.getByRole('option', { name: '50 people' }).click();
    await expect.element(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    // Another admin turns the link off; the live event reads the page again.
    counted.elsewhere({ enabled: false });
    await reload();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.element(page.getByText('The invite link changed again since, so nothing was undone.')).toBeVisible();
    expect(counted.calls.setLink).toEqual([{ enabled: true, maxUses: 50 }]);
    expect(counted.link().enabled).toBe(false);
  });

  it('says the link saved when it is turned on, with no Undo', async () => {
    const counted = layerWith(() => Promise.resolve(), { enabled: false, uses: 0, isSpent: false });
    await renderMembers(counted.layer, { liveLink: counted.link });
    await page.getByRole('tab', { name: /Joining/ }).click();
    // A click on the switch's own input, which the row's text covers in this unstyled page.
    (page.getByRole('switch', { name: 'Invite link' }).element() as HTMLElement).click();
    await expect.element(page.getByText('Invite link saved.')).toBeVisible();
    expect(page.getByRole('button', { name: 'Undo' }).elements()).toHaveLength(0);
    expect(counted.calls.setLink).toEqual([{ enabled: true }]);
  });

  it('opens on Joining while someone asks to join', async () => {
    const waiting = layerWith(() => Promise.resolve());
    await renderMembers(waiting.layer, { requests: [REQUEST] });
    await expect.element(page.getByRole('tab', { name: /Joining/ })).toHaveAttribute('aria-selected', 'true');
    await expect.element(page.getByRole('heading', { name: 'Asking to join' })).toBeVisible();
  });

  it('opens on Members while nobody asks', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await expect.element(page.getByRole('tab', { name: /^Members/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves focus off the page body once the last request is approved', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer, { requests: [REQUEST] });
    await page.getByRole('button', { name: /Approve/ }).click();
    await expect.element(page.getByText('Mary Shelley joined the workspace.')).toBeVisible();
    expect(counted.calls.decide).toEqual([true]);
    await expect.poll(() => document.activeElement === document.body).toBe(false);
  });
});

describe('linkStillReads', () => {
  it('is true only while the link is on and the limit the change set still holds', () => {
    const on: InviteLinkView = { ...LINK, maxUses: 50 };
    expect(linkStillReads(on, { enabled: true, maxUses: 50 })).toBe(true);
    expect(linkStillReads({ ...on, enabled: false }, { enabled: true, maxUses: 50 })).toBe(false);
    expect(linkStillReads({ ...on, maxUses: 10 }, { enabled: true, maxUses: 50 })).toBe(false);
    expect(linkStillReads(LINK, { enabled: true, maxUses: null })).toBe(true);
    expect(linkStillReads(LINK, { enabled: true, expiresInDays: 7 })).toBe(false);
    expect(
      linkStillReads({ ...LINK, expiresAt: '2026-10-30T09:00:00.000Z' }, { enabled: true, expiresInDays: 7 }),
    ).toBe(true);
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
