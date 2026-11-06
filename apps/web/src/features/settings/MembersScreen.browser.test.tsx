// The Members page in Chromium (owner ask T12, 5 November 2026: one table). Everyone on their way in sits in the
// members' own table, first: someone asking to join (Approve, Decline), then each invitation (Invited, with Resend and
// Revoke invitation in its menu), then the members, each row's role and status in its columns and the rest in its
// details beside the list. Its confirms (the owner, 21 October 2026: anything that ends something asks first): Revoke
// invite (Keep invitation, never a second Cancel), Remove from workspace and Transfer ownership each open a danger
// confirm; the way out changes nothing, and the verb runs once, busy while the server works, with the server's
// refusal inside the dialog, which stays open. Someone else's role changes at once, no confirm. Other ways to join
// follows the list (the invite link, whose limits save with a toast and Undo, then Company email). A member reads
// no note and no controls.
import type {
  RolesOverview,
  DataLayer,
  InvitationView,
  InviteLinkView,
  JoinRequestView,
  MemberView,
  MyAccess,
  RolesList,
  WorkspaceDomainsView,
} from '@crm/data';
import { createToasts, sharedStrings, UiProvider, type Toasts } from '@crm/ui';
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
/** A second person the reader may change, which is when a bulk change means anything. */
const BARBARA: MemberView = {
  id: '0199a6f2-0000-7000-8000-000000000003',
  name: 'Barbara Liskov',
  email: 'barbara@example.com',
  role: 'member',
  joinedAt: '2026-10-03T09:00:00.000Z',
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
    { id: 'guest', label: 'Guest', description: 'What is shared.', builtIn: 'guest' },
  ],
  defaultRole: 'member',
};
// What each built in role holds (spec 0037, `roles.overview`): a step down asks first by it.
const OVERVIEW: RolesOverview = {
  roles: [
    {
      id: 'owner',
      label: 'Owner',
      description: '',
      builtIn: 'owner',
      permissions: ['workspace.delete', 'members.manage', 'records.export'],
      dataAccess: 'write',
      isDefault: false,
    },
    {
      id: 'admin',
      label: 'Admin',
      description: '',
      builtIn: 'admin',
      permissions: ['members.manage', 'records.export'],
      dataAccess: 'write',
      isDefault: false,
    },
    {
      id: 'member',
      label: 'Member',
      description: '',
      builtIn: 'member',
      permissions: ['records.export'],
      dataAccess: 'write',
      isDefault: true,
    },
    {
      id: 'guest',
      label: 'Guest',
      description: '',
      builtIn: 'guest',
      permissions: [],
      dataAccess: 'read',
      isDefault: false,
    },
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
    workspaceLogo: { subscribe: () => () => undefined, src: () => undefined },
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
      // What making someone a guest stops (spec 0031, slice 9).
      guestPreview: () =>
        Promise.resolve({ pausedPages: 1, rotations: 2, upcomingBookings: 3, delegations: 0, hidesLinkPage: true }),
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
        overview={OVERVIEW}
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

/** Picks Revoke invitation in the menu on Grace's row, in the members' own table. */
async function pickRevokeInvite(): Promise<void> {
  await page.getByRole('button', { name: 'Actions for the invitation to grace@example.com' }).click();
  await page.getByRole('menuitem', { name: 'Revoke invitation' }).click();
}

describe('revoking an invitation asks first', () => {
  it('names the address, and Keep invitation revokes nothing', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await pickRevokeInvite();
    const dialog = page.getByRole('alertdialog', { name: 'Revoke the invitation to grace@example.com?' });
    await expect.element(dialog).toBeVisible();
    expect(dialog.element().textContent).toContain('The link in their email stops working at once.');
    // The way out is Keep invitation, the verb Revoke invitation.
    expect(dialog.getByRole('button', { name: 'Cancel', exact: true }).elements()).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Keep invitation' }).click();
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
    await pickRevokeInvite();
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
    await pickRevokeInvite();
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

  it('offers only Details and "What can Ada do" on the reader’s own row: leaving is the workspace menu’s', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await expect.element(page.getByRole('button', { name: 'Actions for Linus Torvalds' })).toBeVisible();
    await page.getByRole('button', { name: 'Actions for Ada Lovelace' }).click();
    expect(
      page
        .getByRole('menuitem')
        .elements()
        .map((item) => item.textContent),
    ).toEqual(['Details', 'What can Ada do']);
    await userEvent.keyboard('{Escape}');
  });
});

describe('a row’s details (owner ask T12: the secondary columns left the table)', () => {
  it('keeps the table to the person, their role, when they joined and the row’s actions', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    // With one person to change, Change role for several means nothing, so there is no selection column.
    expect(
      page
        .getByRole('columnheader')
        .elements()
        .map((header) => header.textContent),
    ).toEqual(['Name', 'Role', 'Joined', 'Actions']);
    expect(page.getByRole('checkbox').elements()).toHaveLength(0);
    // The person's email sits under their name, in the one cell.
    await expect.element(page.getByRole('rowheader', { name: /Linus Torvalds.*linus@example\.com/ })).toBeVisible();
  });

  it('shows two factor, calendar health and scheduling access beside the list, Remove at its foot', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await page.getByRole('rowheader', { name: /Linus Torvalds/ }).click();
    const details = page.getByRole('dialog', { name: 'Linus Torvalds' });
    await expect.element(details).toBeVisible();
    for (const term of ['Email', 'Role', 'Joined', 'Two factor', 'Calendar', 'Scheduling access']) {
      await expect.element(details.getByText(term, { exact: true })).toBeVisible();
    }
    // Every member is active: only someone on their way in has a status to read.
    expect(details.getByText('Status', { exact: true }).elements()).toHaveLength(0);
    await expect.element(details.getByText('Reconnect needed')).toBeVisible();
    // Removing still asks first, in its own dialog.
    await details.getByRole('button', { name: 'Remove from workspace' }).click();
    await expect.element(page.getByRole('alertdialog', { name: 'Remove Linus Torvalds from Acme?' })).toBeVisible();
    expect(counted.calls.remove).toBe(0);
  });

  it('tells a reader without members.manage none of it, and shows them nobody on their way in', async () => {
    const counted = layerWith(() => Promise.resolve());
    // What the loader wouldn't hand this reader, passed anyway: the page's own gates are what is under test.
    await renderMembers(counted.layer, {
      requests: [REQUEST],
      access: { memberId: LINUS.id, role: 'member', roleLabel: 'Member', permissions: [] },
    });
    expect(page.getByText('Asks to join').elements()).toHaveLength(0);
    expect(page.getByRole('row', { name: /grace@example\.com/ }).elements()).toHaveLength(0);
    await page.getByRole('rowheader', { name: /Ada Lovelace/ }).click();
    const details = page.getByRole('dialog', { name: 'Ada Lovelace' });
    await expect.element(details.getByText('Joined', { exact: true })).toBeVisible();
    for (const term of ['Two factor', 'Calendar', 'Scheduling access']) {
      expect(details.getByText(term, { exact: true }).elements()).toHaveLength(0);
    }
  });

  it('opens from the row’s menu too, and forgets a row that went', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await page.getByRole('button', { name: 'Actions for Linus Torvalds' }).click();
    await page.getByRole('menuitem', { name: 'Details' }).click();
    const details = page.getByRole('dialog', { name: 'Linus Torvalds' });
    await expect.element(details).toBeVisible();
    // Everything the row's menu holds is in its head, with Details itself left out.
    await details.getByRole('button', { name: 'Actions for Linus Torvalds' }).click();
    await expect.element(page.getByRole('menuitem', { name: 'Transfer ownership' })).toBeVisible();
    expect(page.getByRole('menuitem', { name: 'Details' }).elements()).toHaveLength(0);
    await userEvent.keyboard('{Escape}');
  });

  it('asks a broken calendar’s owner to reconnect from their menu (spec 0037, AC-1309)', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await page.getByRole('button', { name: 'Actions for Linus Torvalds' }).click();
    await page.getByRole('menuitem', { name: 'Ask to reconnect' }).click();
    expect(healthAsks).toContain(LINUS.id);
  });

  it('opens an invitation’s details with Resend, and Revoke invitation there asks first', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await page.getByRole('rowheader', { name: /grace@example\.com/ }).click();
    const details = page.getByRole('dialog', { name: 'grace@example.com' });
    await expect.element(details.getByText('Invited by', { exact: true })).toBeVisible();
    await expect.element(details.getByRole('button', { name: 'Resend' })).toBeVisible();
    await details.getByRole('button', { name: 'Revoke invitation' }).click();
    await expect
      .element(page.getByRole('alertdialog', { name: 'Revoke the invitation to grace@example.com?' }))
      .toBeVisible();
    expect(counted.revokes()).toBe(0);
  });
});

describe('changing roles', () => {
  it('changes someone else’s role at once, with no confirm', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await page.getByRole('button', { name: /Role for Linus Torvalds/ }).click();
    await page.getByRole('option', { name: /^Admin/ }).click();
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
    await page.getByRole('option', { name: /^Member/ }).click();
    // A step down asks first (Admin to Member), then says it as a change made at once does.
    const confirm = page.getByRole('alertdialog', { name: 'Make Linus Torvalds a Member?' });
    await expect.element(confirm.getByText('Linus Torvalds can no longer manage members or settings.')).toBeVisible();
    await confirm.getByRole('button', { name: 'Make Member' }).click();
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

  it('asks before making someone a guest, listing what stops (slice 9)', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await page.getByRole('button', { name: /Role for Linus Torvalds/ }).click();
    await page.getByRole('option', { name: /^Guest/ }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Make Linus Torvalds a Guest?' });
    await expect.element(confirm.getByText('1 page paused')).toBeVisible();
    await expect.element(confirm.getByText('Leaves 2 round robins')).toBeVisible();
    await expect.element(confirm.getByText('3 bookings need a host')).toBeVisible();
    await expect.element(confirm.getByText('Link page hidden')).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    expect(counted.calls.setRole).toBe(0);
  });

  it('still asks when the count fails, and says it couldn’t count (slice 9)', async () => {
    const counted = layerWith(() => Promise.resolve());
    const confirm = page.getByRole('alertdialog', { name: 'Make Linus Torvalds a Guest?' });
    const failing = {
      ...counted.layer,
      members: { ...counted.layer.members, guestPreview: () => Promise.reject(new Error('down')) },
    };
    await renderMembers(failing);
    await page.getByRole('button', { name: /Role for Linus Torvalds/ }).click();
    await page.getByRole('option', { name: /^Guest/ }).click();
    await expect.element(confirm.getByText('Couldn’t count what changes')).toBeVisible();
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

describe('everyone on their way in, in the one table (owner ask T12)', () => {
  it('lists the requests, then the invitations, then the members, with a status only for those on their way in; Other ways to join follows', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer, { requests: [REQUEST], link: LINK, domains: DOMAINS });
    // No tab of their own: the entry's strip is Members and Teams.
    expect(
      page
        .getByRole('tab')
        .elements()
        .map((tab) => tab.textContent.replaceAll(/\d/g, '')),
    ).toEqual(['Members', 'Teams']);
    // Each name over its quiet line (after the picture's initials).
    expect(
      page
        .getByRole('rowheader')
        .elements()
        .map((header) => header.textContent),
    ).toEqual([
      'MSMary Shelleymary@acme.com',
      'Ggrace@example.comInvited by Ada Lovelace',
      'ALAda LovelaceYou · ada@example.com',
      'LTLinus Torvaldslinus@example.com',
    ]);
    await expect.element(page.getByRole('row', { name: /Mary Shelley/ }).getByText('Asks to join')).toBeVisible();
    await expect.element(page.getByRole('row', { name: /grace@example\.com/ }).getByText('Invited')).toBeVisible();
    expect(page.getByText('Active', { exact: true }).elements()).toHaveLength(0);
    // No "Just you so far" while anyone is on their way in, and one Invite button, in the bar (here, none: the harness
    // mounts no bar).
    expect(page.getByText('Just you so far').elements()).toHaveLength(0);
    // Other ways to join follows the table for a screen reader and the keyboard, set once, so last.
    const table = page.getByRole('grid', { name: 'Members and invitations' }).element();
    const otherWays = page.getByRole('heading', { name: 'Other ways to join' }).element();
    expect(table.compareDocumentPosition(otherWays) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The invite link first, then Company email, with what Company email does.
    const link = page.getByRole('switch', { name: 'Invite link' }).element();
    const email = page.getByRole('switch', { name: 'Let @acme.com ask to join' }).element();
    expect(link.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('gives only members a checkbox for Change role: never the reader, nor anyone on their way in', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer, { requests: [REQUEST], members: [ADA, LINUS, BARBARA] });
    // Each checkbox is named by its row's person (their email too, from the row's header).
    await expect.element(page.getByRole('checkbox', { name: /^Select Linus Torvalds/ })).toBeInTheDocument();
    for (const name of [/^Select Ada Lovelace/, /^Select Mary Shelley/, /^Select grace@example\.com/]) {
      expect(page.getByRole('checkbox', { name }).elements()).toHaveLength(0);
    }
    // Select all picks the two people who may take a new role. A click on the box's own input, which the header's text
    // covers in this unstyled page.
    (page.getByRole('checkbox', { name: /Select all/i }).element() as HTMLElement).click();
    await expect.element(page.getByRole('toolbar', { name: /selected/i })).toBeVisible();
    await expect.element(page.getByText('2 selected')).toBeVisible();
  });

  it('keeps each role’s help in the role picker, one line under its name', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer);
    await page.getByRole('button', { name: /Role for Linus Torvalds/ }).click();
    await expect.element(page.getByRole('listbox').getByText('Members and settings.')).toBeVisible();
    await userEvent.keyboard('{Escape}');
  });

  it('asks before Change role for several, even one that only gives more', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer, { members: [ADA, LINUS, BARBARA] });
    (page.getByRole('checkbox', { name: /^Select Linus Torvalds/ }).element() as HTMLElement).click();
    await page.getByRole('button', { name: /Change role for 1 person/ }).click();
    await page.getByRole('option', { name: /^Admin/ }).click();
    await expect.element(page.getByRole('heading', { name: 'Make 1 person Admin?' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
  });

  it('puts someone asking to join first, with the role they’ll join as, answered on their row', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer, { requests: [REQUEST] });
    const row = page.getByRole('row', { name: /Mary Shelley/ });
    await expect.element(row.getByText('Member', { exact: true })).toBeVisible();
    await expect.element(row.getByRole('button', { name: 'Approve Mary Shelley' })).toBeVisible();
    await row.getByRole('button', { name: 'Decline Mary Shelley' }).click();
    // Declining ends their request, so it asks first.
    await expect.element(page.getByRole('alertdialog', { name: 'Decline Mary Shelley’s request?' })).toBeVisible();
    expect(counted.calls.decide).toEqual([]);
  });

  it('says the invite link saved, and Undo puts the old limit back', async () => {
    const counted = layerWith(() => Promise.resolve(), { ...LINK, maxUses: 25 });
    await renderMembers(counted.layer, { liveLink: counted.link });
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

  it('leaves another admin’s newer value alone, and says so', async () => {
    const counted = layerWith(() => Promise.resolve(), { ...LINK, maxUses: 25 });
    const { reload } = await renderMembers(counted.layer, { liveLink: counted.link });
    await page.getByRole('button', { name: 'Link settings' }).click();
    await page.getByRole('button', { name: /people Most uses/ }).click();
    await page.getByRole('option', { name: '50 people' }).click();
    await expect.element(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    // Another admin turns the link off; the live event reads the page again.
    counted.elsewhere({ enabled: false });
    await reload();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.element(page.getByText(sharedStrings.undoStale)).toBeVisible();
    expect(counted.calls.setLink).toEqual([{ enabled: true, maxUses: 50 }]);
    expect(counted.link().enabled).toBe(false);
  });

  it('says the link saved when it is turned on, with no Undo', async () => {
    const counted = layerWith(() => Promise.resolve(), { enabled: false, uses: 0, isSpent: false });
    await renderMembers(counted.layer, { liveLink: counted.link });
    // A click on the switch's own input, which the row's text covers in this unstyled page.
    (page.getByRole('switch', { name: 'Invite link' }).element() as HTMLElement).click();
    await expect.element(page.getByText('Invite link saved.')).toBeVisible();
    expect(page.getByRole('button', { name: 'Undo' }).elements()).toHaveLength(0);
    expect(counted.calls.setLink).toEqual([{ enabled: true }]);
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
  it('reads no note over the list, and no controls', async () => {
    const counted = layerWith(() => Promise.resolve());
    await renderMembers(counted.layer, {
      invitations: 'none',
      access: { memberId: LINUS.id, role: 'member', roleLabel: 'Member', permissions: [] },
    });
    // No note over the list: who changes it is a lock in the page's header bar (the owner's less-text rule), which
    // this harness doesn't mount.
    await expect.element(page.getByRole('row', { name: /Linus Torvalds/ })).toBeVisible();
    expect(page.getByText('Only owners and admins can change this.').elements()).toHaveLength(0);
    // Members and Teams, and no status for anyone: they see members alone, all of them active.
    expect(
      page
        .getByRole('tab')
        .elements()
        .map((tab) => tab.textContent.replaceAll(/\d/g, '')),
    ).toEqual(['Members', 'Teams']);
    expect(page.getByText('Active', { exact: true }).elements()).toHaveLength(0);
    expect(page.getByRole('heading', { name: 'Other ways to join' }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: /Role for/ }).elements()).toHaveLength(0);
    // Their own row's menu says what they can do (spec 0037, AC-1243); nobody else's has one.
    expect(page.getByRole('button', { name: /Actions for/ }).elements()).toHaveLength(1);
    expect(page.getByRole('button', { name: 'Actions for Linus Torvalds' }).elements()).toHaveLength(1);
    expect(page.getByRole('button', { name: 'Invite people' }).elements()).toHaveLength(0);
  });
});
